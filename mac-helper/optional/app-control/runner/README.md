# Optional bounded testing runner

This is a small Apache-2.0 modification of the pinned
[OpenMinis iCTRL](https://github.com/OpenMinis/iCTRL) release recorded in
`provenance.json`. The engine, encrypted protocol, authorization, foreground
handling, native input, and normal Stop action remain upstream implementations.
Upstream attribution/license are packaged in `../vendor/LICENSE` and remain in
the downloaded source. These files do not enter any developer's app or Debug SDK.

`lifetime.patch` starts one ten-minute monotonic timer in the runner when its
test body begins. Repeated launch callbacks and client connections cannot
renew it. A guard also checks the deadline when dispatching RPCs. Expiry exits
the testing process off the UI queue using `_exit`, so it does not wait on a
stalled UI call, log lock, teardown handler, or Mac request. Normal teardown
cancels the timer. This bounds this runner, not other automation software on
the phone. Already-started input is not an atomic app/OS transaction.

The runner advertises a distinct version/capability and remaining lifetime.
The Mac validates the claim and caps its local lease to the remaining phone
lifetime. The stock runner remains supported with explicit shutdown; it does
not acquire an automatic-stop guarantee just because this Mac supports one.

The checked-in Xcode project builds only the upstream testing bundle and a
small, build-only host. The host is never installed. It avoids the optional
upstream management app's Rust framework and extra build-tool dependencies.
The verified release IPA supplies the runner host and compatibility shim;
the rebuilt test bundle replaces its original one, preserving its static client
resources. The pinned upstream signer handles nested signing.

`app-control setup` downloads verified assets, builds once with Xcode, selects
an existing unexpired development profile covering the selected phone/team/app,
and uses the profile's matching keychain identity. It creates no certificate,
Apple account, service, login item, or agent. Temporary source/build directories
are removed; the private signed IPA, setup log and installation receipt remain
under the optional app-control directory. No Python/Ruby package is required.

The initial install needs a working Apple developer connection. This installer
does not restore a missing developer image, change developer permissions,
silently reset pairing, or solve cellular-only recovery after a reboot.
