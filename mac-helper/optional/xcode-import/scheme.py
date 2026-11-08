#!/usr/bin/env python3
"""Install/remove one post-action in an existing shared or user Xcode scheme."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

TITLE = 'Swift Sim: record Debug build'


def update(project, scheme, executable=None, remove=False, backup_root=None):
    project = project.resolve(strict=True)
    if project.suffix != '.xcodeproj' or not scheme or Path(scheme).name != scheme:
        raise ValueError('XCODE_SCHEME_INVALID')
    invocation = "swift-sim"
    if not remove:
        if executable is None:
            found = shutil.which("swift-sim")
            if not found:
                raise ValueError("SWIFT_SIM_EXECUTABLE_REQUIRED")
            executable = Path(found)
        else:
            invocation = shlex.quote(str(executable.absolute()))
        executable = executable.absolute()
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError('SWIFT_SIM_EXECUTABLE_REQUIRED')
    if any(parent.is_symlink() for parent in [project / 'xcshareddata', project / 'xcshareddata/xcschemes']):
        raise ValueError('XCODE_SCHEME_INVALID')
    shared = project / 'xcshareddata' / 'xcschemes' / (scheme + '.xcscheme')
    candidates = [shared] if shared.exists() else list(project.glob('xcuserdata/*/xcschemes/' + scheme + '.xcscheme'))
    generated = not candidates
    if generated:
        payload = subprocess.run(['/usr/bin/plutil', '-convert', 'json', '-o', '-', str(project / 'project.pbxproj')], capture_output=True, timeout=10, check=True)
        parsed = json.loads(payload.stdout)
        objects = parsed['objects']
        targets = [(key, value) for key, value in objects.items() if value.get('isa') == 'PBXNativeTarget'
                   and value.get('productType') == 'com.apple.product-type.application' and value.get('name') == scheme]
        if len(targets) != 1:
            raise ValueError('XCODE_SHARED_SCHEME_REQUIRED')
        key, target = targets[0]
        def ref(target_id, value):
            return ET.Element('BuildableReference', BuildableIdentifier='primary', BlueprintIdentifier=target_id,
                              BuildableName=objects[value['productReference']]['path'], BlueprintName=value['name'],
                              ReferencedContainer='container:' + project.name)
        root = ET.Element('Scheme', LastUpgradeVersion='1500', version='1.7')
        build = ET.SubElement(root, 'BuildAction', parallelizeBuildables='YES', buildImplicitDependencies='YES')
        entries = ET.SubElement(build, 'BuildActionEntries')
        item = ET.SubElement(entries, 'BuildActionEntry', buildForTesting='YES', buildForRunning='YES', buildForProfiling='YES', buildForArchiving='YES', buildForAnalyzing='YES')
        item.append(ref(key, target))
        test = ET.SubElement(root, 'TestAction', buildConfiguration='Debug', selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB', selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB', shouldUseLaunchSchemeArgsEnv='YES')
        testables = ET.SubElement(test, 'Testables')
        attributes = objects[parsed['rootObject']].get('attributes', {}).get('TargetAttributes', {})
        for test_id, attribute in attributes.items():
            if attribute.get('TestTargetID') == key and test_id in objects:
                item = ET.SubElement(entries, 'BuildActionEntry', buildForTesting='YES', buildForRunning='NO', buildForProfiling='NO', buildForArchiving='NO', buildForAnalyzing='NO')
                item.append(ref(test_id, objects[test_id]))
                testable = ET.SubElement(testables, 'TestableReference', skipped='NO')
                testable.append(ref(test_id, objects[test_id]))
        launch = ET.SubElement(root, 'LaunchAction', buildConfiguration='Debug', selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB', selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB', launchStyle='0', useCustomWorkingDirectory='NO', ignoresPersistentStateOnLaunch='NO', debugDocumentVersioning='YES', debugServiceExtension='internal', allowLocationSimulation='YES')
        ET.SubElement(launch, 'BuildableProductRunnable', runnableDebuggingMode='0').append(ref(key, target))
        profile = ET.SubElement(root, 'ProfileAction', buildConfiguration='Release', shouldUseLaunchSchemeArgsEnv='YES', savedToolIdentifier='', useCustomWorkingDirectory='NO', debugDocumentVersioning='YES')
        ET.SubElement(profile, 'BuildableProductRunnable', runnableDebuggingMode='0').append(ref(key, target))
        ET.SubElement(root, 'AnalyzeAction', buildConfiguration='Debug')
        ET.SubElement(root, 'ArchiveAction', buildConfiguration='Release', revealArchiveInOrganizer='YES')
        if remove:
            return dict(changed=False, installed=False)
        shared.parent.mkdir(parents=True, exist_ok=True)
        with shared.open('xb') as output:
            output.write(ET.tostring(root, encoding='utf-8', xml_declaration=True))
        candidates = [shared]
    if len(candidates) != 1:
        raise ValueError('XCODE_SCHEME_AMBIGUOUS')
    path = candidates[0]
    if path.is_symlink() or path.stat().st_size > 1024 * 1024:
        raise ValueError('XCODE_SCHEME_INVALID')
    path.resolve(strict=True).relative_to(project)
    if any(parent.is_symlink() for parent in path.parents if parent != project and project in parent.parents):
        raise ValueError('XCODE_SCHEME_INVALID')
    original = path.read_bytes()
    tree = ET.fromstring(original)
    action = tree.find('BuildAction')
    if action is None:
        raise ValueError('XCODE_BUILD_ACTION_REQUIRED')
    refs = [r for r in action.findall('./BuildActionEntries/BuildActionEntry/BuildableReference')
            if r.get('BuildableName', '').endswith('.app')]
    if len(refs) != 1:
        raise ValueError('XCODE_APP_TARGET_AMBIGUOUS')
    post = action.find('PostActions')
    if post is None:
        post = ET.SubElement(action, 'PostActions')
    old = [e for e in post.findall('ExecutionAction') if e.find('ActionContent') is not None
           and e.find('ActionContent').get('title') == TITLE]
    if remove:
        pre = action.find('PreActions')
        removed_pre = False
        if pre is not None:
            for entry in list(pre):
                content = entry.find('ActionContent')
                if content is not None and content.get('title') == TITLE + ' inputs':
                    pre.remove(entry)
                    removed_pre = True
        for item in old:
            post.remove(item)
    else:
        prefix = ('# Swift Sim xcode-import v1\n'
                  'if [ "${CONFIGURATION:-}" != "Debug" ] || [ "${PLATFORM_NAME:-}" != "iphoneos" ]; then exit 0; fi\n'
                  'if [ "${SWIFT_SIM_MANAGED_BUILD:-}" = "1" ]; then exit 0; fi\n'
                  'export PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"\n'
                  + invocation)
        script = (prefix + ' import-xcode-build --app "${TARGET_BUILD_DIR}/${FULL_PRODUCT_NAME}"'
                  + ' --project "${PROJECT_FILE_PATH}" --scheme ' + shlex.quote(scheme)
                  + ' >/dev/null 2>&1 || echo "warning: Swift Sim import was skipped; inspect with import-xcode-build."\n')
        start_script = prefix + ' xcode-build-start --project "${PROJECT_FILE_PATH}" --scheme ' + shlex.quote(scheme) + ' >/dev/null 2>&1 || true\n'
        existing_pre = [e for e in action.findall('./PreActions/ExecutionAction/ActionContent') if e.get('title') == TITLE + ' inputs']
        if len(old) == 1 and old[0].find('ActionContent').get('scriptText') == script and len(existing_pre) == 1 and existing_pre[0].get('scriptText') == start_script:
            return dict(changed=False, installed=True)
        for item in old:
            post.remove(item)
        item = ET.SubElement(post, 'ExecutionAction', ActionType='Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction')
        content = ET.SubElement(item, 'ActionContent', title=TITLE, scriptText=script)
        env = ET.SubElement(content, 'EnvironmentBuildable')
        env.append(ET.fromstring(ET.tostring(refs[0])))
        pre = action.find('PreActions')
        if pre is None:
            pre = ET.SubElement(action, 'PreActions')
        for entry in list(pre):
            existing = entry.find('ActionContent')
            if existing is not None and existing.get('title') == TITLE + ' inputs':
                pre.remove(entry)
        before = ET.SubElement(pre, 'ExecutionAction', ActionType='Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction')
        before_content = ET.SubElement(before, 'ActionContent', title=TITLE + ' inputs', scriptText=start_script)
        ET.SubElement(before_content, 'EnvironmentBuildable').append(ET.fromstring(ET.tostring(refs[0])))
    if not old and remove and not removed_pre:
        return dict(changed=False, installed=False)
    # One private original backup per scheme; never a backup per build.
    backup_root = backup_root or Path.home() / '.swift-sim' / 'xcode-import' / 'hooks'
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if backup_root.is_symlink() or backup_root.stat().st_uid != os.getuid() or backup_root.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_HOOK_STATE_REQUIRED')
    key = hashlib.sha256(str(path.resolve()).encode()).hexdigest()
    backup = backup_root / (key + '.original.xcscheme')
    if not backup.exists():
        with backup.open('xb') as output:
            output.write(original)
        backup.chmod(0o600)
    if path.read_bytes() != original:
        raise ValueError('XCODE_SCHEME_CHANGED')
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write(ET.tostring(tree, encoding='utf-8', xml_declaration=True))
        output.flush()
        os.fsync(output.fileno())
    try:
        temporary.chmod(path.stat().st_mode & 0o777)
        if path.read_bytes() != original:
            raise ValueError('XCODE_SCHEME_CHANGED')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return dict(changed=True, installed=not remove)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--scheme', required=True)
    parser.add_argument('--executable', type=Path)
    parser.add_argument('--remove', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(dict(ok=True, **update(args.project, args.scheme, args.executable, args.remove))))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else 'XCODE_HOOK_UNAVAILABLE'
        print(json.dumps(dict(ok=False, code=code)))
        raise SystemExit(1)
