# Stock WebDriverAgent wireless qualification — November 2, 2026

## Result

**The physical same-Wi-Fi experiment passed.** Stock WebDriverAgent opened and
inspected existing apps, tapped native controls, entered text with verified
read-back, and scrolled native content. Those actions passed again after a full
runner shutdown and restart with a fresh automation session.

No code, framework, resource, entitlement, dependency, or build-setting change
was added to Swift Sim, Zenics, or the Debug SDK. This qualifies an alternative
backend; it does not mean a production Swift Sim automation command has shipped.

The user authorized a one-hour stock-WebDriverAgent experiment after the
[agent-device wireless input failure](APP_CONTROL_WIRELESS_2026_11_02.md).
The experiment started at 8:10 PM America/Chicago and completed its functional
tests and device cleanup by 8:27 PM. The phone was explicitly available and
unlocked for the test.

## Provider and environment

- `appium-webdriveragent` **16.17.8**, downloaded from npm and verified against
  its registry SHA-512 integrity before extraction.
- All **629 packaged files** matched the archive after the build and test.
  There was no provider source patch or fork.
- macOS 26.5.2, Xcode 26.6, Node 24 for archive verification, Python's standard
  HTTP client for direct REST requests, and a physical iPhone 16 Pro on iOS 27.0.1.
- Existing Swift Sim **build 24** and Zenics **build 40** were the targets.
- Xcode signed a separate, uniquely identified task-owned XCTest runner using
  an external signing configuration. The full Appium server and its npm
  dependency tree were not installed.
- Mac developer-tool permission had already been enabled with explicit user
  approval during the preceding experiment.

## Wireless route

Before and after the experiment, CoreDevice reported `localNetwork` transport
with a connected TCP tunnel. USB inventory reported **zero attached iPhones**
both times. WDA's status response identified the expected phone OS, and its
reported Wi-Fi address matched the paired phone's Bonjour hostname resolution.

Successful requests went directly to the phone's private Wi-Fi IPv4 address
on a task-selected port, using a new HTTP connection for each request. There
was no USB forwarding, cloud provider, public relay, Funnel, or second AI agent.
The current coding agent issued stock WDA REST requests from the Mac.

The first configuration attempted to bind WDA specifically to the address
reported for Apple's CoreDevice tunnel. That address was not bindable inside
the runner: its log reported `Can't assign requested address`, followed by a
listener startup timeout and an aborted test. A retry with the same binding
also failed. Restoring the stock default binding resolved startup. This was a
test configuration error, not evidence that WDA's native input failed.

The successful runner used the stock default network binding, rather than a
tunnel-only binding. It remained available only for this explicit test and was
then shut down and removed. A production integration still needs a reviewed
access boundary for the runner; this experiment does not qualify unattended
or broadly exposed access to WDA's control endpoint.

## Observed functional proof

| Test | Native observation |
| --- | --- |
| Open and read Swift Sim | The app library returned native buttons and the search text field |
| Tap Search | WDA acknowledged the semantic element click; a fresh tree showed the keyboard and the search field moved above it |
| Enter `Zenics` | A separate screen read returned the exact field value and the app list filtered to Zenics |
| Open app detail | Clicking the matching app row produced the `App History` screen |
| Scroll history | A fresh tree showed the build-row positions change; a physical screenshot also captured the scrolled page |
| Restore companion UI | Returned to the library, cleared the temporary filter, and read back its empty-field placeholder |
| Control existing Zenics | Activated the installed app, clicked `Next Month`, and read `December 2026` instead of `November 2026` |
| Restore Zenics UI | Clicked `Previous Month` and verified `November 2026` was restored |

Only navigation, search, and calendar display controls were used. No install,
build, deletion, media-editing, or workout-creation control was invoked. Sessions
used `forceAppLaunch: false` and `shouldTerminateApp: false` to preserve existing
app processes where possible. Existing app data was not reset or uninstalled.

## Reconnect and teardown proof

1. Deleted the first WDA session through its stock REST API.
2. Called stock `/wda/shutdown`; it acknowledged shutdown.
3. The owning `xcodebuild test-without-building` process exited successfully.
4. A new connection to the old endpoint was refused.
5. Started a new stock runner process from the same prepared build.
6. Created a fresh WDA session and repeated search tapping, text read-back,
   app-detail navigation, observed scrolling, and UI restoration successfully.
7. Activated Zenics and confirmed its original month remained selected.
8. Deleted the second session, shut down WDA, and observed another successful
   Xcode exit and a refused connection to the stopped endpoint.
9. Removed only the uniquely identified temporary WDA runner from the phone.
10. Queried the phone inventory to verify runner removal and the unchanged
    installed Swift Sim and Zenics build numbers.

No task-owned Xcode or WDA worker remained on the Mac. The existing Swift Sim
helper remained running and passed its local delivery-health check. Build caches
and private qualification evidence remain on disk for reproducibility; they
are not active workers. Evidence was not uploaded or posted externally.

## Limits and next step

- The reconnect proof is **runner shutdown/restart and fresh HTTP sessions on
  the same Wi-Fi**. It is not a Wi-Fi outage, roaming, cellular, or different-network test.
- Direct Tailscale access, remote Apple runner startup, and cross-network
  recovery remain unqualified.
- This is one phone/OS and two existing native apps. It does not prove universal
  accessibility, custom-rendered controls, every app, or long-term reliability.
- No hot reload edit was injected during this experiment. The complete
  edit/deliver/automate/verify loop remains a separate acceptance check.
- No new production CLI, background service, or agent integration was installed.

The next implementation can remain Mac-only and optional: a small agent-neutral
entry point using stock WDA, explicit device/app selection, on-demand observations,
and bounded start/stop ownership. It must preserve the ordinary hot reload and
notification paths and leave the Debug SDK unchanged.

## Primary references

- [Appium WebDriverAgent package](https://www.npmjs.com/package/appium-webdriveragent)
- [Manage WDA yourself](https://appium.github.io/appium-xcuitest-driver/latest/guides/wda-custom-server/):
  stock REST server backed by XCTest, with independent runner lifecycle.
- [Attach to a running WDA](https://appium.github.io/appium-xcuitest-driver/latest/guides/attach-to-running-wda/):
  real-device access through a reachable device network address.
