import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const liveModule = fileURLToPath(new URL("../mac-helper/src/liveReload.js", import.meta.url));
const fileStoreModule = fileURLToPath(new URL("../mac-helper/src/infrastructure/nodeAtomicFileStore.js", import.meta.url));

function scenario(mode) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-queued-artifact-"));
  const bin = join(root, "bin"); mkdirSync(bin);
  const counter = join(root, "compile-count.log"); const sourceLog = join(root, "compiled-source.log");
  writeFileSync(join(bin, "xcrun"), `#!${process.execPath}\n(async()=>{const fs=require('node:fs');const {NodeAtomicFileStore}=await import(${JSON.stringify(fileStoreModule)});const store=new NodeAtomicFileStore();const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_COUNTER,'compiled\\n');fs.appendFileSync(process.env.FIXTURE_SOURCE_LOG,store.readTextSync(args[2]));fs.writeFileSync(args[args.indexOf('-o')+1],Buffer.from('fixture compiled image'));})().catch(()=>process.exit(1));`, { mode: 0o700 });
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join,dirname } from 'node:path';
    import { NodeAtomicFileStore } from ${JSON.stringify(fileStoreModule)};
    const root=${JSON.stringify(root)};const mode=${JSON.stringify(mode)};const store=new NodeAtomicFileStore();
    if(mode==='low-space'){fs.statfsSync=()=>({bavail:1,bsize:4096});syncBuiltinESMExports();}
    const {prepareQueuedLivePatch,cleanupQueuedLiveArtifacts}=await import(${JSON.stringify(liveModule)});
    const live=join(root,'.swift-sim','live');fs.mkdirSync(live,{recursive:true,mode:0o700});
    const source=join(root,'Card.swift');
    const before='import SwiftUI\\nstruct Card: View { var body: some View { Text("old") } }';
    const after=before.replace('"old"','"new"');
    fs.writeFileSync(source,'struct Card { var unrelatedStoredState = 42 }');
    fs.writeFileSync(join(live,'compilations.json'),JSON.stringify({version:1,compilations:[{moduleName:'Fixture',sources:[source],workingDirectory:root,compilerArguments:[]}]}),{mode:0o600});
    const artifactRoot=join(live,'queued-artifacts');fs.mkdirSync(artifactRoot,{recursive:true,mode:0o700});
    const record={requestId:'fixture-request-one',snapshotDigest:'a'.repeat(64),scope:{binaryIdentity:'fixture-binary'},expiresAt:1000,files:[{path:source,beforeSource:before,afterSource:after}]};
    if(mode==='quota'){const fd=fs.openSync(join(artifactRoot,'unrelated-existing-artifact'),'w');fs.ftruncateSync(fd,129*1024*1024);fs.closeSync(fd);}
    const count=()=>fs.existsSync(${JSON.stringify(counter)})?store.readTextSync(${JSON.stringify(counter)}).trim().split('\\n').length:0;
    let result;
    try {
      const first=prepareQueuedLivePatch(record,{artifactRoot});
      if(mode==='reuse'){
        const second=prepareQueuedLivePatch(record,{artifactRoot});
        result={samePath:first.path===second.path,compileCount:count(),artifactCount:fs.readdirSync(artifactRoot).filter(n=>n.endsWith('.dylib')).length,source:store.readTextSync(${JSON.stringify(sourceLog)})};
      } else if(mode==='cleanup') {
        const markerPath=first.path+'.json';const marker=store.readJSONSync(markerPath);
        const outside=join(root,'outside-owned-by-another-lane');fs.mkdirSync(outside);fs.writeFileSync(join(outside,'keep'),'keep');
        marker.compilationDirectory=outside;fs.writeFileSync(markerPath,JSON.stringify(marker),{mode:0o600});
        fs.writeFileSync(join(artifactRoot,'foreign.dylib'),'foreign');fs.writeFileSync(join(artifactRoot,'foreign.dylib.json'),'foreign');
        cleanupQueuedLiveArtifacts([{requestId:record.requestId,expiresAt:10000}],{artifactRoot,now:2000});
        const retained=fs.existsSync(first.path);
        cleanupQueuedLiveArtifacts([],{artifactRoot,now:2000});
        result={retained,artifactRemoved:!fs.existsSync(first.path),markerRemoved:!fs.existsSync(markerPath),derivedRemoved:!fs.existsSync(join(live,'patches','queued_'+marker.key)),outsidePreserved:fs.existsSync(join(outside,'keep')),foreignPreserved:fs.existsSync(join(artifactRoot,'foreign.dylib'))};
      } else if(mode==='symlink') {
        const outside=join(root,'outside.dylib');fs.writeFileSync(outside,'outside');fs.rmSync(first.path);fs.symlinkSync(outside,first.path);
        let code;try{prepareQueuedLivePatch(record,{artifactRoot});}catch(error){code=error.code;}
        cleanupQueuedLiveArtifacts([],{artifactRoot,now:2000});
        result={code,compileCount:count(),outsidePreserved:store.readTextSync(outside)==='outside',symlinkRetained:fs.lstatSync(first.path).isSymbolicLink()};
      } else result={unexpectedSuccess:true};
    } catch(error){result={code:error.code,compileCount:count()};}
    console.log(JSON.stringify(result));
  `;
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: "", FIXTURE_COUNTER: counter, FIXTURE_SOURCE_LOG: sourceLog } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("prepared artifacts reuse deterministic ownership after lost journal publication and compile immutable snapshots", () => {
  const result = scenario("reuse");
  assert.equal(result.samePath, true); assert.equal(result.compileCount, 1); assert.equal(result.artifactCount, 1);
  assert.match(result.source, /Text\("new"\)/); assert.doesNotMatch(result.source, /unrelatedStoredState/);
});

test("expiry cleanup preserves live receipts and unrelated paths while reclaiming only derived ownership", () => {
  assert.deepEqual(scenario("cleanup"), { retained: true, artifactRemoved: true, markerRemoved: true, derivedRemoved: true, outsidePreserved: true, foreignPreserved: true });
});

test("artifact symlinks are neither reused nor followed during cleanup", () => {
  assert.deepEqual(scenario("symlink"), { code: "PATCH_ARTIFACT_INVALID", compileCount: 1, outsidePreserved: true, symlinkRetained: true });
});

test("queued artifact quota rejects allocation before compiler work", () => {
  assert.deepEqual(scenario("quota"), { code: "PATCH_STORAGE_INSUFFICIENT", compileCount: 0 });
});

test("insufficient patch volume headroom rejects allocation before compiler work", () => {
  assert.deepEqual(scenario("low-space"), { code: "PATCH_STORAGE_INSUFFICIENT", compileCount: 0 });
});
