# Native app-control Simulator qualification — November 2, 2026

## Scope

This is a development-only evaluation of stock `agent-device` 0.21.36 on an
Apple silicon Mac with Xcode 26.6, Swift 6.3.3, Node 24, and an iOS 26.5
Simulator. It is not evidence of physical iPhone, Wi-Fi, or Tailscale automation.
No physical device was contacted or changed during this qualification.

The provider was downloaded to an ignored task directory and its archive
verified against the npm registry's SHA-512 integrity before extraction:

```text
sha512-aG88WlEHjFc/OEBQC7AJg+2LfNoVT/ogxnnzIUYUEgafdiTvBaA+X6uQ2wNmpp2ZrHLy8QIXoEOyc3NEZgJCpQ==
```

The evaluation did not change Swift Sim's dependencies, installed helper,
hot reload engine, companion, Debug SDK, agent integrations, or Zenics code.
The provider uses its own stock XCTest runner; its source was not patched.

## Observed results

The task-owned Simulator used the conservative `simslim` development profile.
Profile verification and checks for push, StoreKit, universal links, iCloud,
keychain sync, Photos, and Health passed. This is functional evidence, not a
stock-device performance measurement.

| Check | Observed evidence |
| --- | --- |
| Open a native app | Settings opened and returned semantic controls with labels, roles, references, and bounds |
| Tap | Search opened; the next tree included its close control and keyboard |
| Enter text | Filling Search with `Accessibility` succeeded; a separate snapshot read back that exact field value |
| Return to the list | Tapping the current close control removed search/keyboard and restored Settings cells |
| Scroll | A downward gesture moved the list; a separate snapshot showed Screen Time, Passcode, Privacy & Security, and changed cell positions |
| Screenshot | The provider wrote a PNG of the resulting screen to the private task directory |
| Close | Session close succeeded; runtime teardown reported platform owners closed, the Simulator runner stopped, and no runner handed off |

No settings were toggled. A first-run keyboard tutorial button was reported as
occluded by the keyboard; the provider refused the attempted tap with
`dispatched: no`. Text entry remained usable. A raw `e16` reference was rejected
in the initial trial; the API requires `@e16`. Current references must be
refreshed after actions, rather than reused across changed screens.

The initial runner build failed while the Mac had roughly 120 MB free. After
clearing verified-unused disposable npm and Go caches under existing cleanup
authorization, the same unmodified runner built successfully. The original
compile diagnostic was not recovered, so this report does not attribute it to
a provider incompatibility. Free space remained low (about 1 GiB); further
builds must recheck capacity. Current hot reload compiler files were preserved.

The extracted package's declared unpacked size is 5,696,615 bytes; its completed
runner DerivedData occupied about 190 MiB. These are disk measurements, not
claims about runtime RAM, idle cost, or warm action latency. No performance
claim is qualified yet.

## Repeatable check

[`qualify-app-control-simulator.mjs`](../../scripts/qualify-app-control-simulator.mjs)
uses the public provider API, with no new application protocol. It refuses any
target absent from the already-booted Simulator inventory, requires an explicit
provider and cache, pins the evaluated version, and refuses an existing output
directory. It performs native reads and actions, asserts text read-back and a
changed list, captures a screenshot, and checks provider teardown in `finally`.
It saves private results and resource ownership under the selected output.

Before running it, check disk space and boot a task-owned Simulator. Apply,
verify, and check the shared `simslim` profile under the repository's AGENTS
instructions. Do not use a device owned by another task.

```sh
node scripts/qualify-app-control-simulator.mjs \
  --provider <verified-agent-device-package-directory> \
  --simulator <task-owned-booted-simulator-id> \
  --runner-cache <task-owned-runner-derived-data> \
  --output <new-private-result-directory>
```

The script does not install or download the provider, boot/shut down a
Simulator, or touch a phone. After the run, shut down the Simulator when its
owning task no longer needs it. Keep generated evidence private: screen trees
and screenshots may contain app data.

The repeatable script passed all six checks: native screen read, semantic tap,
text entry read-back, observed scroll, screenshot, and provider teardown. An
invalid device identifier was separately refused before provider startup or
output creation. The script's Settings fixture uses English control labels.
The task-owned Simulator was shut down afterward. The qualification host and
runner processes exited. The existing hot reload engine remained running.
The final service check found the installed helper stopped, with disk-full
errors in its log. The same installed helper was restored without a rebuild;
its local delivery health check passed. This was service recovery, not part
of the automation implementation.

## Next gate

The [bounded implementation plan](../internal/plans/APP_CONTROL_SPIKE.md)
requires explicit phone availability, observed wireless input, and cleanup
before publishing any physical-device integration. Simulator success does not
qualify wireless support or justify changing the SDK.
