# Troubleshooting

Read only the matching branch:

- **Missing CLI/helper/integration:** install the supported Homebrew release
  and run `swift-sim setup`. Reload the integration or start a new agent
  session only when its instructions or version contract changed.
- **Helper health failure:** follow the typed error. A timeout means the
  bounded probe expired; refusal means no connection was accepted. Neither
  proves missing project setup. HTTP/invalid-data/identity failures require
  inspecting the local listener; version/protocol drift requires aligning
  CLI and helper. Same-version service recovery does not require a new agent
  session. Never expose raw health data or retry a partial live apply.
- **Debug linker incompatibility:** an interposable self-import can make a
  successfully signed app die at launch, including native Rust dependencies.
  Stop before installation. Review a Debug application-target-only linker
  workaround supported by the selected Xcode toolchain, or use an ordinary
  signed build without live integration. Preserve existing workarounds; never
  add a classic-linker override globally or to Release. See the public
  [linker recovery instructions](../../../../../docs/TROUBLESHOOTING.md#live-enabled-debug-build-has-a-linker-compatibility-failure).
- **Live edit absent:** do not screenshot or repeat deep inspection. Confirm
  Debug app, private Tailnet, unlocked device, and same signing team; open the
  signed result from `deliver-change`.
- **Live not ready:** confirm `SwiftSimLive`, one root `.swiftSimLive()`,
  prepared Debug build, and matching development identity. Never publish 8887.
- **Pairing/Tailnet:** use `setup-status`, then `pair` or `pair --qr` for a
  fresh verified invitation. Scan from **Mac Connection → Scan Pairing QR**;
  if camera access is unavailable, use the normal link and **Open or Paste
  Pairing Link**. Resolve backend conflicts first. An expired or used
  invitation requires a new one.
- **Signing/delivery:** inspect exact Xcode error, bundle ID, team, device,
  capabilities, and profile. Use `device-delivery-status` and
  `device-delivery-stop` for stale delivery; device installs do not need
  Tailscale.
- **Simulator stream:** inspect `transport.activeForPhone` and create a fresh
  session only after native decoder reconnect has had a moment.
