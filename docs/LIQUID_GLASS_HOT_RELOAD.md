# Liquid Glass Hot Reload Coverage

Swift Sim treats Liquid Glass as SwiftUI implementation work, not as a special
transport. Once a live-enabled Debug app is installed, compatible changes use
the same private-Tailnet dynamic-replacement path as other SwiftUI body edits.
The iPhone and Mac do not need to share Wi-Fi.

This document separates three different claims:

1. The general remote replacement mechanism is physically proven by the core
   benchmark.
2. The focused Liquid Glass corpus proves routing, replacement generation, SDK
   availability, and source compilation for the current API surface.
3. A focused physical-device run is still required before claiming that every
   focused case has executed on an iPhone.

## Covered SwiftUI API Surface

The `liquid-glass-1` corpus contains 27 independent hot-edit cases. They cover
the distinct Liquid Glass and adjacent SwiftUI API families present in the
installed iOS 26.5 SDK:

### Custom glass

- `Glass.regular`, `Glass.clear`, and `Glass.identity`
- `Glass.tint(_:)` and `Glass.interactive(_:)`
- `glassEffect(_:in:)`, including default, circle, rounded-rectangle, and
  concentric shapes
- `GlassEffectContainer` spacing
- `glassEffectID(_:in:)`
- `glassEffectUnion(id:namespace:)`
- `glassEffectTransition(_:)`
- `.buttonStyle(.glass)`, `.buttonStyle(.glassProminent)`, and configured
  glass button styles

### System glass and adjacent layout

- `ToolbarSpacer`
- toolbar shared-background and background visibility
- soft/hard and visible/hidden scroll-edge effects
- `backgroundExtensionEffect(isEnabled:)`
- `safeAreaBar`
- tab-bar minimization
- tab-view bottom accessories
- `TabViewBottomAccessoryPlacement`-driven accessory content
- the search tab role and programmatic search presentation
- toolbar title display modes
- control sizing

Apple applies Liquid Glass automatically to standard navigation, toolbar, tab,
sheet, popover, and control surfaces. Swift Sim therefore does not need a
special case for every standard component: edits to their SwiftUI composition
remain ordinary body replacements. See Apple's
[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass),
[custom SwiftUI glass](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views),
and [SwiftUI updates](https://developer.apple.com/documentation/updates/swiftui)
documentation.

The enabled bottom-accessory overload is iOS 26.1 or newer in the installed
SDK, so the focused fixture is explicitly availability-gated at iOS 26.1. The
main benchmark app keeps its existing deployment target and shows the focused
screen only when that availability check passes.

## Changes That Still Require A Build

The focused corpus contains seven safety controls that must select the signed
build lane:

- adding a `@Namespace` or `@State` property;
- changing a stored `Glass` initializer;
- adding a member or declaration attribute;
- changing type conformances; and
- adding an import.

These change declarations, stored layout, or module inputs. A live process
cannot safely reshape that Swift metadata. An existing namespace, binding, or
helper may be used freely from a replacement body; introducing it is a build.

## Adjacent Boundaries

System Liquid Glass automatically responds to Reduce Transparency, Increase
Contrast, and Reduce Motion. No source patch is needed for that adaptation.
Adding a new SwiftUI environment property remains a stored-property change and
therefore requires a build; changing body logic that uses an existing
environment property can hot reload.

UIKit also exposes `UIGlassEffect`, `UIGlassContainerEffect`,
`UIBackgroundExtensionView`, and `UIScrollEdgeElementContainerInteraction`.
Swift implementation bodies that configure these objects can be interposed,
but Swift Sim cannot assume that an already-created UIKit hierarchy reruns its
configuration. UIKit visual refresh therefore remains a separate proof lane
and is not included in the SwiftUI-focused success count. See Apple's
[UIKit appearance customization](https://developer.apple.com/documentation/uikit/appearance-customization).

App icons, Icon Composer assets, resources, deployment targets, compatibility
keys, entitlements, and build settings always require a new signed build.

## Current Evidence

| Gate | Result |
| --- | --- |
| Focused corpus validation | 34/34 valid |
| Static routing, three passes | 27/27 hot and 7/7 rebuild per pass |
| Dangerous false-live decisions | 0 |
| Dynamic body replacement generation | 27/27 |
| Mutated-source iOS 26.5 type-check | 27/27 |
| Full unsigned Simulator fixture build | Passed |
| Focused physical iPhone execution | Pending |

The semantic marker is embedded in every hot mutation. A physical case can pass
only after the running iPhone reports the expected case, value, refresh, and
increasing revision, followed by a confirmed baseline restore. Screenshots are
not used as correctness evidence.

Run the focused local gates with:

```sh
npm run benchmark:generate:liquid-glass
npm run benchmark:validate:liquid-glass
npm run benchmark:static:liquid-glass
```

Run the physical gate with the normal benchmark runner and the focused corpus:

```sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/liquid-glass/corpus.json \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<trusted-device-name>" \
  --build-setting DEVELOPMENT_TEAM=<your-team-id> \
  --smoke
```

Tailscale carries the live patch traffic across different networks. The
initial fixture install and machine-readable device console still depend on
Apple's trusted device channel or an explicit OTA install handoff.
