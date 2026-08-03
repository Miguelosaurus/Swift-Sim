# Native SwiftUI System-Surface Hot Reload

Swift Sim's native-surface corpus checks the system UI that SwiftUI composes
around an app: menus, presentation modifiers, navigation, controls, lists,
forms, toolbars, search, and the iOS 26.1 presentation APIs. It is an
adjacent capability corpus, not a claim that every UIKit or SwiftUI edit is
reloadable.

## Coverage

The native-surfaces-1 corpus has 31 cases:

- 24 implementation-only hot cases, all marked for the physical smoke lane;
- seven declaration/import/type-shape controls that must use a signed build;
- zero authoring-error cases; and
- one CatalogApp fixture, explicitly gated at iOS 26.1.

The hot cases cover:

| Family | Cases |
| --- | --- |
| Menus and actions | Menu, contextMenu, confirmationDialog, ShareLink |
| Presentation | sheet, popover, presentation detents, drag indicator |
| Navigation | NavigationStack, NavigationLink, split-view style |
| Controls | Picker, ControlGroup, Toggle, Stepper, Slider, DatePicker, TextField, ProgressView |
| Containers and search | List, Form, searchable |
| Toolbar surfaces | toolbar role and title display mode |

The benchmark changes the body implementation and embeds a case marker in the
replacement. A passing device result requires the running iPhone to report the
new case/value and revision, followed by a baseline restore. It does not use a
screenshot or infer success from a patch compiler exit code.

## Physical evidence (August 1, 2026)

The complete signed native-surface run passed:

| Metric | Result |
| --- | --- |
| Hot edits observed | 24/24 |
| Baseline restores | 24/24 |
| Fallbacks | 0 |
| Timeouts | 0 |
| Partial applications | 0 |
| Edit latency p50 / p95 | 1,009.6 ms / 1,213.8 ms |

This is evidence for the named fixture, iOS/Xcode toolchain, device, and Swift
Sim engine session. It does not establish a universal SwiftUI percentage.

Run the local gates with:

~~~sh
npm run benchmark:generate:native-surfaces
npm run benchmark:validate:native-surfaces
npm run benchmark:static:native-surfaces
~~~

Run the physical lane with an explicitly selected trusted iPhone:

~~~sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/native-surfaces/corpus.json \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<trusted-device-name>" \
  --build-setting DEVELOPMENT_TEAM=<your-team-id> \
  --smoke
~~~

## Build boundaries

Adding a stored property, namespace, member, declaration attribute, type
conformance, or import changes Swift metadata or module inputs. Those seven
controls are intentionally routed to build-device; the live lane must not
attempt them. Existing state, bindings, namespaces, and helpers can be used by
a replacement body, but introducing them still requires a new signed build.

Native UIKit effect objects and already-created UIKit hierarchy configuration
are outside this SwiftUI corpus. They need a separate UIKit refresh proof even
when the surrounding Swift implementation is otherwise interposable.
