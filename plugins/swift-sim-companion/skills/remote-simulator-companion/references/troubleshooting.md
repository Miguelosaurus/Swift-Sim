# Troubleshooting

Read only the matching branch:

- **Missing CLI/helper/integration:** install the signed Homebrew release and
  run `swift-sim setup`. For protocol mismatch say **Update Swift Sim, then
  start a new agent session.**
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
