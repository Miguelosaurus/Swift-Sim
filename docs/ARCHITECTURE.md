# Architecture

## Components

### Codex

Codex edits the user's project, builds it, launches it on a selected Mac Simulator, verifies the local preview, and returns the companion link. Swift Sim does not create a second coding agent.

### Mac Helper

`mac-helper/bin/swift-sim-helper.js` is a localhost HTTP service. It:

- discovers the installed `serve-sim` capability through an adapter
- starts, reuses, restarts, and stops scoped simulator streams
- stores pairing and session metadata under `~/.swift-sim`
- proxies authenticated media and device-mask responses
- forwards touch, keyboard, hardware, rotation, and accessibility controls
- builds opaque companion links

The helper binds to `127.0.0.1:47217` unless explicitly configured otherwise.

### iOS Companion

The native SwiftUI app:

- opens HTTPS and `swift-sim://` links
- remembers the paired Mac locally
- decodes the native H.264 stream with `AVSampleBufferDisplayLayer`
- applies Xcode's model-specific CoreSimulator framebuffer mask
- forwards normalized input to the helper
- presents build status, logs, reconnect state, and simulator controls

It never builds or executes the user's project.

## Transport Paths

### Native Companion

This is the default phone path when `serve-sim` 0.1.41 or newer exposes `/stream.avcc`.

```text
CoreSimulator framebuffer
  -> serve-sim VideoToolbox H.264 encoder
  -> helper authenticated stream proxy
  -> Tailscale Serve
  -> native iOS AVSampleBufferDisplayLayer
```

Input travels in the opposite direction through authenticated helper routes and the persistent `serve-sim` WebSocket control channel.

### Codex Preview And Fallback

Codex uses the local MJPEG preview supplied by `serve-sim`. The iPhone may also use this compatibility path when native AVCC support is unavailable, but it has higher bandwidth and lower interaction quality.

`setup-status` reports the selected phone transport at `transport.activeForPhone`.

## Stream Recovery

The iOS decoder never intentionally drops arbitrary H.264 delta frames. It queues samples in order and reconnects when:

- the display layer fails
- the queue exceeds its bounded backlog
- media packets stop arriving

A reconnect obtains a fresh seed, codec configuration, and keyframe.

The helper separately monitors upstream media bytes. If `serve-sim` remains reachable and accepts gestures but stops producing frames, the helper:

1. cancels the stalled upstream reader
2. kills only the stream for the tracked Simulator UDID
3. restarts that stream on its scoped port
4. resumes the existing companion response with fresh media

Concurrent recovery requests for the same simulator share one restart.

## Input

- taps: normalized `x` and `y` coordinates
- drags: `begin`, `move`, and `end` gesture events
- keyboard: USB HID down/up events over one persistent WebSocket
- controls: home, lock, rotation, Siri, side button, Action button, accessibility, appearance, memory warning, and slow animations

Text input supports the US-keyboard ASCII set currently mapped by `serve-sim`. Multi-touch support remains limited by the installed `serve-sim` control protocol.

## Session Model

A session tracks:

- opaque session ID and token
- project presence and scheme
- internal Simulator UDID
- build state
- selected transport and stream lifecycle
- helper logs
- remote base URL

Public session responses omit the project path, Simulator UDID, local stream URL, port, PID, and raw adapter output.

Matching running sessions are reused by project, scheme, and Simulator UDID.

## HTTP Surface

Unauthenticated local health:

```text
GET /health
GET /.well-known/apple-app-site-association
```

Pairing-token routes:

```text
GET  /api/serve-sim
GET  /api/transports
GET  /api/pairing/status
POST /api/pairing/rotate
POST /api/sessions/start
```

Session-token routes:

```text
GET  /api/sessions/<id>
GET  /api/sessions/<id>/logs
GET  /api/sessions/<id>/links
POST /api/sessions/<id>/stop
GET  /api/sessions/<id>/stream
GET  /api/sessions/<id>/frame-mask
POST /api/sessions/<id>/tap
POST /api/sessions/<id>/gesture
POST /api/sessions/<id>/type
POST /api/sessions/<id>/key
POST /api/sessions/<id>/control/<control>
```

Browser fallback and link entry points:

```text
GET /pair
GET /s/<id>
```

## Persistence

The helper stores local state in:

```text
~/.swift-sim/pairing.json
~/.swift-sim/sessions.json
~/.swift-sim/helper.log
```

These files may contain secret tokens or local project metadata. Do not commit or share them.
