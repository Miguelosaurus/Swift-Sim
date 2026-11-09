# Third-party sources

Swift Sim is licensed under [Apache-2.0](LICENSE). Dependencies retain their
own licenses and attribution. This index points to the actual sources and
version records; it does not replace their license texts.

| Component | Source and record |
| --- | --- |
| Simulator adapter | [serve-sim](https://github.com/EvanBacon/serve-sim), Apache-2.0; `package.json` and `package-lock.json` pin the installed dependency. |
| Terminal QR rendering | [qrcode-terminal](https://github.com/gtanner/qrcode-terminal), Apache-2.0; its license is included in the installed dependency. |
| Live engine and native client | [Swift Sim InjectionNext fork](https://github.com/Miguelosaurus/InjectionNext), based on [johnno1962/InjectionNext](https://github.com/johnno1962/InjectionNext), MIT; `Package.swift` and `mac-helper/compatibility.json` bind the exact tag, source and engine archive. The signed engine retains its license. |
| Optional app-testing provider | [OpenMinis/iCTRL](https://github.com/OpenMinis/iCTRL), Apache-2.0; [vendor provenance](mac-helper/optional/app-control/vendor/provenance.json), [license](mac-helper/optional/app-control/vendor/LICENSE), and [runner changes](mac-helper/optional/app-control/runner/README.md). |
| Optional native-install prototype | [mh-mobile/idevice](https://github.com/mh-mobile/idevice); the isolated [prototype](mac-helper/optional/direct-install/README.md) records its pinned provider and qualification limits. It is not bundled into the Debug SDK. |

Preserve license/provenance files when changing vendored material. Review the
exact upstream revision and its terms before updating a dependency. Document
local modifications and requalify the affected path; an upstream release does
not automatically become a supported Swift Sim component.
