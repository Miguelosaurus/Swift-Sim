# Simulator preview

Use only for an explicitly requested live Simulator preview:

1. Run `swift-sim setup-status` and require an `ok` private route.
2. Build and launch one exact Simulator.
3. Start/reuse that UDID:

`sh
swift-sim start-session \
  --project "<absolute-project-or-workspace-path>" \
  --scheme "<scheme>" \
  --simulator "<simulator-udid>" \
  --remote-base-url "<tailscale-serve-url>" \
  --transport auto
`

In Codex verify `codex.localPreviewUrl` in the in-app browser; other hosts
use local preview tools. Return **Open Simulator in Companion App**. Keep
access private to Tailscale Serve and never use an unscoped `serve-sim --kill`.
`native-companion` is preferred; `serve-sim` is fallback quality. The
companion controls the Mac Simulator and does not execute project code.
