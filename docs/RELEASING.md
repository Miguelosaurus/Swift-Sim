# Releasing Swift Sim

Swift Sim ships a Mac package, shared agent integration, iPhone Companion and
Debug SDK wrapper. The engine fork has its own immutable release. A release is
complete only when the public artifacts actually work together.

## Prepare

1. Start from reviewed `main` and a clean worktree. Keep private signing settings,
   keys, device identifiers and unredacted logs out of Git.
2. Update the package/lockfile, `mac-helper/compatibility.json`, Companion marketing
   version and all explicit agent/plugin versions together. Choose a Companion
   build number above both uploaded and in-flight builds for its App Store app.
   Do not confuse an owner's private OTA build sequence with that public record.
3. Change engine/SDK pins only for an intentionally qualified engine update.
   Bind the stable Swift package tag, source revision, archive checksum and
   negotiated capabilities. Never move an existing tag or replace a release asset.
4. Reconcile the changelog, setup guide, shared skill references, privacy and
   [TestFlight availability](TESTFLIGHT.md#availability). Keep dated evidence
   distinct from the current product instructions.

## Qualify

- Run `npm run check` on Node 24 and `npm run check:engine-publication`.
- Run `SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1 swift test` and the relevant
  Companion tests/builds on a task-owned stock Simulator.
- Run the isolated clean Homebrew gate in CI; it must not replace the owner's
  installed helper just to validate a package.
- Inspect actual UI in light/dark, larger text and long-content/error states.
  Simulator screenshots do not prove phone delivery or device performance.
- For delivery/runtime changes, collect the exact physical-device receipts and
  restore the original app behavior/data. Get the phone owner's availability
  first. Keep install, launch and refresh proof separate.
- Export the Companion for App Store distribution with its existing public
  bundle identity. Verify signing, version/build and production entitlements.
  A signed local IPA is not an uploaded or externally available beta.

## Freeze and Publish

Commit the source before creating the Mac archive so its packaged provenance
matches the reviewed commit. Use `scripts/release/create-archive.sh <version>`;
inspect the packed version, provenance and content, then record its SHA-256.
Prepare the matching Homebrew formula with the same immutable archive hash.

Publishing a tag/release, changing the Homebrew tap, uploading the Companion
and changing beta distribution are explicit release actions. Prepare their
artifacts and notes for review before seeking the maintainer's authorization.
Do not update a user's running helper or phone as a side effect of release prep.

For TestFlight, inspect processing and export-compliance results, external
review status, expiration and actual Public Beta membership after uploading.
An enabled public link with expired builds is unavailable. Apple review is an
external dependency; do not announce availability from a successful upload alone.

## Verify and Recover

Confirm the published archive hash and version, clean package/Homebrew install,
stable Swift package resolution and public beta access. Run a fresh-user smoke
test through setup, Debug bootstrap, a reversible cellular edit and a full update.
Record which gates passed and which remain pending. Background push availability
must match [the current sender design](NOTIFICATIONS.md#public-beta-availability).

If a release fails, stop advertising the broken path and prepare a new version.
Keep the previous assets/tags intact. Reconcile existing install or live requests
before retrying; do not substitute a new request for missing completion proof.
