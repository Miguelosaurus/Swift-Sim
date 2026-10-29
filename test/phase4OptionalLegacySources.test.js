import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Phase4CutoverCoordinator } from "../mac-helper/src/persistence/phase4CutoverCoordinator.js";
import { withPhase4MaintenanceDatabase } from "../mac-helper/src/persistence/phase4MaintenanceExecutor.js";
import { bindPhase4MaintenanceEvidence } from "../mac-helper/src/persistence/phase4MaintenanceEvidence.js";
import { verifyPhase4PreparationBackups, verifyPhase4RollbackBackups } from "../mac-helper/src/persistence/phase4PreparationBackupProof.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const SHA = "a".repeat(40);
const HELPER_PID = 900000001;
const HELPER_START = "Mon Aug 17 00:00:00 2026";
function json(path, value) { writeFileSync(path, JSON.stringify(value), {mode: 0o600}); chmodSync(path, 0o600); }
function ps(_command, args) { return Number(args[1]) === HELPER_PID ? {status:1,stdout:"",stderr:""} : {status:0,stdout:"Mon Aug 17 00:05:00 2026\n",stderr:""}; }
function evidence() { return {candidateSHA:SHA,verifyRunID:31979347580,exactCandidateSHA:true,hostedVerifyGreen:true,maintenanceAuthorized:true,writersQuiesced:true,
  cleanupDisabledForCutover:true,sqliteProcessAuthorityAbsent:true,unrelatedPhaseWorkAbsent:true,processIdentity:{pid:HELPER_PID,startedAt:HELPER_START}}; }
async function fixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-optional-sources-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, {mode:0o700});
  mkdirSync(join(stateRoot,"runtime"), {mode:0o700});
  json(join(stateRoot,"runtime/helper-process-identity.json"), {version:1,role:"swift-sim-helper",pid:HELPER_PID,startedAt:HELPER_START});
  json(join(stateRoot,"pairing.json"), {token:"legacy-token",installationID:"installation-1",macName:"Fixture Mac",createdAt:"2026-08-17T00:00:00.000Z",updatedAt:"2026-08-17T00:00:00.000Z"});
  json(join(stateRoot,"device-builds.json"), {version:6,apps:{},builds:[],artifactCleanupJobs:{},deliveryReferenceCleanupJobs:{}});
  const databasePath = join(stateRoot,"state.sqlite");
  const db = new SwiftSimSqliteDatabase({path:databasePath,migrations:PHASE4_SQLITE_MIGRATIONS.slice(0,7)}); db.close(); chmodSync(databasePath,0o600);
  const provenancePath = join(directory,"build-provenance.json"); json(provenancePath,{version:1,gitSHA:SHA});
  const options = {stateRoot,stage:"prepare",evidence:evidence(),spawnSync:ps,provenancePath};
  try { return await operation({directory,stateRoot,databasePath,options}); }
  finally { rmSync(directory,{recursive:true,force:true}); }
}

test("valid v7 with absent optional legacy sources migrates/prepares without manufacturing files or backups", async () => {
  await fixture(async ({stateRoot,options}) => {
    const result = await withPhase4MaintenanceDatabase(options, (database,bound) => {
      assert.equal(bound.measured.schemaVersion,9);
      for (const [key,fileName] of [["invitations","pairing-invites.json"],["sessions","sessions.json"]]) {
        assert.deepEqual(bound.measured.sourceHashes[key],{present:false,fileName,byteLength:null,sha256:null});
      }
      const prepared = new Phase4CutoverCoordinator({database,stateRoot,spawnSync:ps}).prepare({expectedRevision:0,preparationID:"b".repeat(64),maintenanceEvidence:bound});
      const proof = verifyPhase4PreparationBackups({stateRoot,domains:prepared.domains,sourceHashes:bound.measured.sourceHashes});
      assert.equal(proof.count,4); assert.equal(proof.backupCount,2); assert.equal(proof.absenceCount,2);
      return {prepared,sourceHashes:bound.measured.sourceHashes};
    });
    assert.equal(existsSync(join(stateRoot,"pairing-invites.json")),false);
    assert.equal(existsSync(join(stateRoot,"sessions.json")),false);
    assert.equal(result.prepared.domains.pairing.backups.length,1);
    assert.equal(result.prepared.domains.sessions.backups.length,0);
    const presence = result.prepared.authority.evidence.sourcePresence;
    assert.deepEqual(presence,result.sourceHashes);
    const verify = () => verifyPhase4RollbackBackups({stateRoot,domains:result.prepared.domains,sourcePresence:presence});
    assert.equal(verify().absenceCount,2);
    assert.throws(() => verifyPhase4RollbackBackups({stateRoot,domains:result.prepared.domains}),/backup|source/i);
    // Current-state rollback can have already published new legacy bytes. It
    // must preserve the old absence witness without requiring current absence.
    json(join(stateRoot,"pairing-invites.json"),[]); json(join(stateRoot,"sessions.json"),{sessions:[]});
    assert.equal(verify().verified,true);
    assert.throws(() => verifyPhase4PreparationBackups({stateRoot,domains:result.prepared.domains,sourceHashes:result.sourceHashes}),/absent to present|source changed/i);
    const malformed = structuredClone(presence); malformed.credential = {present:false,fileName:"pairing.json",byteLength:null,sha256:null};
    assert.throws(() => verifyPhase4RollbackBackups({stateRoot,domains:result.prepared.domains,sourcePresence:malformed}),/credential|source presence/i);
  });
});

for (const fileName of ["pairing.json","device-builds.json"]) {
  test(`missing required ${fileName} fails before a migration-capable open`, async () => {
    await fixture(async ({stateRoot,options}) => {
      unlinkSync(join(stateRoot,fileName)); let opens=0;
      await assert.rejects(withPhase4MaintenanceDatabase({...options,openDatabase(){opens++; throw new Error("unexpected opener");}},()=>null),/ENOENT|privatePermissions|source/i);
      assert.equal(opens,0);
    });
  });
}

for (const fileName of ["pairing-invites.json","sessions.json"]) {
  test(`${fileName} absent-to-present change invalidates post-migration binding`, async () => {
    await fixture(async ({stateRoot,databasePath,options}) => {
      let opens=0, called=false;
      await assert.rejects(withPhase4MaintenanceDatabase({...options,openDatabase(){
        opens++;
        const database = new SwiftSimSqliteDatabase({path:databasePath,migrations:PHASE4_SQLITE_MIGRATIONS});
        if(opens===1) json(join(stateRoot,fileName), fileName === "sessions.json" ? {sessions:[]} : []);
        return database;
      }},()=>{called=true;}),/source bytes changed/i);
      assert.equal(called,false);
    });
  });
  test(`${fileName} dangling symlink never counts as legitimate absence`, async () => {
    await fixture(async ({directory,stateRoot,options}) => {
      symlinkSync(join(directory,"missing.json"),join(stateRoot,fileName));
      assert.throws(()=>bindPhase4MaintenanceEvidence(evidence(),"prepare",{stateRoot,spawnSync:ps,provenancePath:options.provenancePath}),/private regular file/i);
    });
  });
}

for (const present of ["pairing-invites.json","sessions.json"]) {
  test(`one optional source present (${present}) produces its backup and preserves the other absence`, async () => {
    await fixture(async ({stateRoot,options}) => {
      json(join(stateRoot,present), present === "sessions.json" ? {sessions:[]} : []);
      await withPhase4MaintenanceDatabase(options,(database,bound)=>{
        const prepared = new Phase4CutoverCoordinator({database,stateRoot,spawnSync:ps}).prepare({expectedRevision:0,preparationID:"b".repeat(64),maintenanceEvidence:bound});
        const proof = verifyPhase4PreparationBackups({stateRoot,domains:prepared.domains,sourceHashes:bound.measured.sourceHashes});
        assert.equal(proof.backupCount,3); assert.equal(proof.absenceCount,1);
        assert.equal(verifyPhase4RollbackBackups({stateRoot,domains:prepared.domains,sourcePresence:prepared.authority.evidence.sourcePresence}).backupCount,3);
      });
      const absent = present === "sessions.json" ? "pairing-invites.json" : "sessions.json";
      assert.equal(existsSync(join(stateRoot,absent)),false);
    });
  });
  test(`${present} present-to-absent change invalidates post-migration binding`, async () => {
    await fixture(async ({stateRoot,databasePath,options}) => {
      json(join(stateRoot,present),present === "sessions.json" ? {sessions:[]} : []);
      let opens=0, called=false;
      await assert.rejects(withPhase4MaintenanceDatabase({...options,openDatabase(){
        opens++; const db=new SwiftSimSqliteDatabase({path:databasePath,migrations:PHASE4_SQLITE_MIGRATIONS});
        if(opens===1) unlinkSync(join(stateRoot,present)); return db;
      }},()=>{called=true;}),/source bytes changed/i);
      assert.equal(called,false);
    });
  });
}
