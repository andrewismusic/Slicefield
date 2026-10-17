# Slicefield (iOS)

Native iPhone port of the Slicefield web prototype: a one-channel, slice-grid touch instrument. It may also become the sound/performance engine inside a larger app (HANDOFF §18), so keep the core host-agnostic.

- **Spec:** `HANDOFF.md` (read it first). The prototype in `Reference/` (copied from `prototype/`) is the source of truth for behaviour. Open `Reference/slicefield.html` on a phone to compare feel.
- **Architecture:**
  - SwiftUI shell, sheets and session view.
  - A UIKit multi-touch view for the grid and lane.
  - A C++ real-time engine in an `AVAudioSourceNode`.
  - Lock-free queues between the threads (UI → engine commands, engine → UI events, plus a status snapshot).
- **Real-time rules in the engine:** no allocation, no locks, no Swift/ObjC calls and no logging on the audio thread. Preallocate pools (see HANDOFF §3).
- **Parity:** keep `Reference/tools/render-reference.js` scenarios passing against the native engine (HANDOFF §16). Add a scenario for every engine bug fixed.
- **Behaviour changes need Andrew's sign-off.** Open questions are listed in HANDOFF §14; ask, don't guess.
- **Tests:** `node Reference/tests/engine.test.js` (JS reference) and the XCTest port of the same cases.
