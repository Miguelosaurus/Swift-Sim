# Adjustable phone testing duration

Swift Sim build 31 offers 5, 10, 30 or 60 minutes before Allow Testing and
remembers the preference. Notification Allow uses the saved preference;
ordinary notification taps expose the selector. Ten minutes remains the
initial default. The chosen duration is captured in the launch intent and
exact phone approval, rather than read again from mutable UI state on return.
Reopening testing refreshes the request's current state and approved duration.

The optional runner is now `1.98.16-swiftsim.2`. It keeps its existing single
monotonic timer. The first Swift Sim launch can select a supported duration,
measured from the original process start; repeated launches cannot change that
selection or renew the start time. No selection leaves the ten-minute default.
The phone advertises both selected duration and remaining time, with a one-hour
maximum. The Mac requires the phone's duration to match the approved request
before app activation, rejects an agent's attempt to exceed approval, and caps
the local lease to remaining phone time. Legacy bounded runners remain usable
for agreed manual sessions but require updating for adjustable approval.

The pinned installer rebuilt, signed and installed the updated optional runner
without launching it. The user installed companion build 31 and selected thirty
minutes through a new phone request. Local state reported approval with
`minutes: 30`; opening the exact request admitted one bounded session with
1,772 seconds remaining. The native Swift Sim screen confirmed thirty minutes.
A subsequent authenticated device observation reported:

- Version `1.98.16-swiftsim.2`.
- Selected phone duration: 1,800 seconds.
- Maximum duration: 3,600 seconds.
- Remaining phone time: approximately 1,748 seconds.

No agent taps or edits were sent in this run. Explicit close returned
`session-closed` and `runnerStopped: true`; independent TCP connection refusal
and absence of the local session confirmed cleanup. The test ended immediately;
it does not claim a thirty-minute unattended expiry observation or new cellular
qualification. Earlier cellular startup and default-timer evidence remain
separate.

The full Node 24 suite passed 1,360 tests, with zero failures. Focused tests
cover duration validation, immutable approval, refusal of mismatched phone
duration before activation, lease limits, monotonic selection without renewal,
expiry with a blocked UI thread, legacy runner compatibility and import
isolation. Type, lint, architecture, documentation and package-content checks
passed; both signed phone artifacts built successfully. The helper was
gracefully replaced only after terminal build and stopped simulator checks;
the hot reload engine retained its identity. No new timer, polling loop,
service or target-app library was added to normal hot reload or notifications.
