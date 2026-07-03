# Setup

Swift Sim has one user installation path. Homebrew installs one release containing both the helper and Codex plugin, and `swift-sim setup` activates them together.

## 1. Install Swift Sim

Requirements:

- Apple silicon Mac
- Xcode
- Homebrew
- Codex desktop app

Run:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

Setup prints two independent sections:

- **iPhone app installs (primary)**: Xcode, local helper, and Codex plugin
- **Live Simulator preview (optional)**: Tailscale and its private Serve route

The primary install workflow is ready even when the optional section is not configured.

Check it again at any time:

```sh
swift-sim doctor
```

## 2. Prepare Xcode Signing

Open Xcode once and add your Apple Developer account under **Settings > Accounts**. The app you are building must use a bundle identifier owned by that team.

For development signing, the destination iPhone must be registered with the team. Xcode can normally manage the certificate, App ID, device registration, and provisioning profile when Codex builds with provisioning updates enabled.

Swift Sim never receives your Apple password or account session. It asks Xcode to perform the normal signed archive and export.

## 3. Install Your First App

From the Codex thread working on the iOS project, ask:

```text
Build this app to my iPhone with Swift Sim
```

Codex will:

1. Run `swift-sim doctor --json`.
2. Identify the project or workspace and scheme.
3. Archive and export a development-signed IPA.
4. Start a restricted temporary HTTPS delivery tunnel.
5. Return an **Install on iPhone** link.

Open the link on the iPhone and choose **Install**. The link works over cellular or any other network; Tailscale is not involved.

Install links last two hours by default. The Mac must remain awake and online until installation finishes.

### Updating An Existing App

Ask Codex to build to your phone again after making changes. Keep the same:

- bundle identifier
- Apple Developer team
- compatible keychain and app-group entitlements

iOS then installs the new build over the existing one and preserves its app container. Swift Sim does not uninstall first.

Changing the bundle identifier creates a separate app. Changing the team or access-group entitlements can prevent the update from reading previous keychain or shared-container data.

## 4. Optional Live Simulator Preview

Only configure this when you want to view and control the Mac Simulator from the Swift Sim iOS app.

1. Install Tailscale on the Mac and iPhone.
2. Sign in to the same Tailnet on both devices.
3. On the Mac, run:

   ```sh
   tailscale serve 47217
   swift-sim doctor
   ```

4. Ask Codex:

   ```text
   Open a live Simulator preview in Swift Sim
   ```

Codex checks the private route, builds and launches one exact Simulator, opens that same Simulator in the Codex sidebar, and returns the companion link.

Same Wi-Fi is not required. Do not use Tailscale Funnel; Simulator controls should remain private to the Tailnet.

## Link Behavior

- **Install link**: normal HTTPS page that installs the signed app. No companion app or Tailscale required.
- **Simulator link**: opens the Swift Sim companion and connects through Tailscale.
- **Pairing link**: stores optional Mac-helper diagnostics in the companion app.
- **`swift-sim://` link**: fallback when an arbitrary private host cannot open as an iOS universal link.

## Updating Swift Sim

```sh
swift-sim update
```

This upgrades the Homebrew package and refreshes the bundled Codex plugin from that same installation.

## Next

- [Troubleshooting](TROUBLESHOOTING.md)
- [Security](SECURITY.md)
- [Codex Workflow](CODEX_WORKFLOW.md)
