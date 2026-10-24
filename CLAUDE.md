# Slicefield (iOS)

Native iPhone port of the Slicefield web prototype: a one-channel, slice-grid touch instrument. It may also become the sound/performance engine inside a larger app (HANDOFF §18), so keep the core host-agnostic.

- **Spec:** `HANDOFF.md` (read it first). The prototype in `Reference/` (copied from `prototype/`) is the source of truth for behaviour. Open `Reference/slicefield.html` on a phone to compare feel.
- **Architecture:**
  - SwiftUI shell, sheets and the Clips page.
  - A UIKit multi-touch view for the grid and lane.
  - A C++ real-time engine in an `AVAudioSourceNode`.
  - Lock-free queues between the threads (UI → engine commands, engine → UI events, plus a status snapshot).
- **Record and Capture (v19):** Record overdubs touched steps into the sequence in place; Capture saves the sequence (with its loop, ORDER, SKIP and SKIP/GAP mode) to the Clips page, and only Load puts a clip back on the field. Projects save the whole state to one file (HANDOFF §23). Fields (rows of 1–4 effects; top to bottom is the signal order, a touch drives every effect in its row) are kept in a library shared by projects and copied into each project and clip, and a game round records and captures 16 bars as clips (HANDOFF §25, §26). ORDER and SKIP are fixed patterns (HANDOFF §21, §22).
- **No globals or singletons** anywhere in the core or UI; everything lives in an instance (the web prototype is one `Slicefield` class).
- **Real-time rules in the engine:** no allocation, no locks, no Swift/ObjC calls and no logging on the audio thread. Preallocate pools (see HANDOFF §3).
- **Parity:** keep `Reference/tools/render-reference.js` scenarios passing against the native engine (HANDOFF §16). Add a scenario for every engine bug fixed.
- **Behaviour changes need Andrew's sign-off.** Open questions are listed in HANDOFF §14; ask, don't guess.
- **Tests:** `node Reference/tests/engine.test.js` (JS reference) and the XCTest port of the same cases.
