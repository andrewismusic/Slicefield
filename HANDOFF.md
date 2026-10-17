# Slicefield — handoff for the iOS app

This guide and the `prototype/` folder are everything needed to build Slicefield as a native iPhone app. The prototype is a single-page web app (version 15) designed through about fifteen rounds of hands-on testing on a phone. Treat its behaviour as the specification: when this document and the code disagree, the code in `prototype/src/` is what was actually played and approved. Say so in the pull request if you change any behaviour on purpose.

**For Claude Code:** read this whole file first, then `prototype/src/engine.js` (about 580 lines, the heart of it). Section 13 gives the build order. Section 14 lists decisions the owner (Andrew) hasn't made yet. Ask him about those instead of guessing.

---

## Contents

1. What Slicefield is
2. What's in this package
3. Recommended iOS architecture
4. Data model
5. Engine behaviour (the core spec)
6. Effects reference
7. Cells, parameters and effect settings
8. Recording, capture and sequences
9. Session view and song
10. Screen layout and interaction spec
11. Visual design tokens
12. Demo loops and audio import
13. Build plan for Claude Code
14. Open questions for Andrew
15. Known quirks and things to improve natively
16. Parity testing against the prototype
17. Appendix: constants, message protocol, algorithms

---

## 1. What Slicefield is

Slicefield is a four-track touch instrument for one-bar loops.

- Each track (A, B, C, D) plays a one-bar audio loop, cut into a grid of slices (1/16 or 1/8).
- The screen is a grid. **Horizontal position picks the slice; vertical position within a row sets the effect amount.** The middle row (the "loop row") shows the waveform: a tap there loops that slice dry, the top band is a high-pass filter and the bottom band a low-pass.
- Every touch is quantised to the slice grid. Several held cells take turns in the order they were touched.
- A **sequencer** records what you hear, step by step, as "sequences". Each holds 1 or 2 bars of steps, and each step stores a slice plus effect touches.
- A **session view** holds up to 8+ sequences per track (clips) that launch on the bar. A **song** row list chains them.
- **Design rule: what you hear is what you get.** Recording prints exactly what was heard, including smooth finger gestures. Effect settings stay "live": a step stores *where you touched*, not the value that produced. So changing an effect's range or scale later re-maps recorded steps.

The test bench is at https://claude.ai/artifact/E3mmmLLnQFMJXGLG12BYvd (open it on an iPhone to feel the intended behaviour). Its full source is in `prototype/slicefield.html`.

---

## 2. What's in this package

```
HANDOFF.md                     this document
CLAUDE.md                      short project memory to drop into the new repo
prototype/
  slicefield.html              the complete prototype (open in any browser; tap Play)
  build.py                     rebuilds slicefield.html from src/
  src/engine.js                audio engine: tracks, step decisions, effects, recording, song (pure JS, no DOM)
  src/synth.js                 demo-loop synthesiser (9 loops) + resample/normalize helpers
  src/ui.js                    the whole UI: touch handling, drawing, sheets, session, song
  src/shell.html               HTML + CSS
  tests/engine.test.js         behaviour tests (node tests/engine.test.js) — port these to XCTest
  tools/render-reference.js    renders scripted scenarios to WAV + step logs for parity testing
  tools/scenarios/*.json       four scenarios (plain loop, every effect, 4 tracks + swing, record/capture/combine)
```

To regenerate the reference renders (written to `tools/out/`, about 20 MB, not checked in), run `node tools/render-reference.js`. Running it twice gives byte-identical step logs.

How the prototype is put together:

- `engine.js` exports `engineFactory()`. In the browser it runs inside an AudioWorklet and talks to the UI only through messages (`msg()` in, `post()` out). That boundary maps directly onto a real-time audio thread plus a UI thread on iOS.
- `ui.js` keeps all user-facing state: tracks, effect settings, clips, song and prefs. It pushes what the engine needs, and it draws everything on two `<canvas>` elements (the sequencer lane and the effect grid), plus HTML for the header, tabs, sheets and session view.

---

## 3. Recommended iOS architecture

### Stack
- **Swift + SwiftUI** for the app shell, sheets (Preferences, effect settings), session view and song.
- **A UIKit `UIView` subclass for the performance grid and sequencer lane.** It needs raw multi-touch with `touchesBegan/Moved/Ended` (set `isMultipleTouchEnabled = true`, no gesture recognisers on the grid), the lowest possible latency, and precise drawing. Draw with Core Graphics in `draw(_:)` at display rate, or Metal if profiling demands it. SwiftUI gestures aren't suitable for 4+ simultaneous fingers with per-finger identity.
- **DSP core in C++ (recommended) or carefully written Swift**, hosted in an `AVAudioSourceNode` on `AVAudioEngine`. C++ makes the real-time rules (no allocation, no locks, no Objective-C/Swift runtime calls) easy to guarantee. Swift 5.9+ C++ interop, or a thin C API, connects it to the app. An AUv3 is a possible later step; nothing here prevents it.
- **Minimum iOS 17** is a reasonable default, so the app can use the Observation framework. Ask Andrew if older support matters.

### Threads and boundaries (mirror the prototype)
```
UI thread ──(SPSC lock-free queue: Command)──▶ audio thread (Engine.render every buffer)
UI thread ◀──(SPSC queue: EngineEvent)──────── audio thread
UI thread ◀──(atomic double-buffered Status snapshot, ~60 Hz)── audio thread
```
- **Command** = every `msg()` type in Appendix A (touches, cfg, launch, rec, capture, …).
- **EngineEvent** = `clip`, `clipStep`, `overDone`, `grid`, `songRow` (the prototype's `post` events). They carry finished sequences back to the UI's model.
- **Status** = the prototype's `status` message: playing, sample time, loop length, per-track `info()`, and the viewed track's recent step history. Publish it as a fixed-size struct the UI reads each frame. Don't allocate it per buffer.
- **Ownership of sequences (clips):** the UI builds an immutable clip and hands the engine a pointer. The engine never frees memory; it returns replaced clips through a "garbage" queue for the UI to release. The engine edits clip steps in place while recording. On iOS, make the engine own a mutable copy and emit `clipStep` events so the UI model mirrors it, which is exactly what the prototype does.

### Real-time rules the JS engine breaks (fix these in the port)
- `Math.random()` → a fast seedable RNG (use mulberry32 for parity tests; see §16).
- Allocation per step: `mkE()` effect-entry objects, `fx` arrays in `decide()`, rec/hist step objects, freeze grains (`gr.push`/`splice`), `hist.splice`, `info()` objects, `Object.assign` copies. Replace them with fixed-capacity pools:
  - ≤ 8 effect entries per step
  - ≤ 64 grains
  - a hist ring of 96
  - recording buffers sized at the maximum sequence length, 2 bars × 16 steps = 32
- Effect resolution (`resolveInto`) runs per sample when raw changes. It's cheap math; keep it, with no allocation.
- Effect identity is a string key (`'pitch'`). Use an enum.

### Audio session
- `AVAudioSession` category `.playback` (plays with the silent switch on, which the web prototype could never guarantee), mode `.default`, and `setPreferredIOBufferDuration(0.0027)` (~128 frames at 48 kHz). Show the real buffer size in Preferences → Latency, as the prototype does.
- Handle interruptions (calls, Siri), route changes (headphones), media services reset, and sample-rate changes. When the rate changes, rebuild the loops at the new rate (the loop length depends on it, §5.1).
- Enable background audio only if Andrew wants it (§14).

---

## 4. Data model

Use plain `Codable` value types for the UI-side model (also the save format; the prototype has **no persistence**, and the app needs it).

```swift
enum Fx: String, Codable { case stutter, random, pitch, reverse, env, freeze, crush, filter }
// crush is shown to the user as "SRR"; env as "Decay"; filter lives on the loop row.

struct FxTouch: Codable { var fx: Fx; var raw: Float; var auto: [Float]? }  // raw: 0…1, or −1…1 on bipolar rows
                                                                             // auto: 16 points across the step, or nil

struct Step: Codable {          // one sequence step ("slot" in the prototype)
  var on: Bool                  // false = step switched off (silent)
  var a: Float                  // slice start in sixteenths of the loop (0…15.x)
  var off: Int                  // >0 when this step continues a slice that started off earlier steps (long stutter)
  var sid: String               // step identity; continuation logic compares sids
  var slen: Float               // slice length in grid steps (1 normally; more with long stutters)
  var fx: [FxTouch]
}

struct Sequence: Codable {      // "clip" in the prototype
  var id: String                // prototype: "t{track}s{slot}_{n}" — the slot index is parsed from it
  var cols: Int                 // grid when made (16 or 8)
  var n: Int                    // steps per bar for its track (bar length in grid steps)
  var steps: [Step]             // n × bars (bars = 1 or 2)
}

struct ParamRange: Codable { var lo: Float; var hi: Float }

struct EffectConfig: Codable {  // per track, per effect — sent to the engine whenever it changes
  var cells: [String]           // parameters the cell height controls (one or more; may be empty)
  var lo: [String: Float]; var hi: [String: Float]   // cell range per parameter (bottom/top value)
  var x: [String: Float]        // fixed value for parameters not under the cell
  var scale: String?            // pitch & freeze: "chrom" | "major" | … | "custom"
  var mask: [Bool]?             // 12 pitch classes, C = 0
  var mode: String?             // stutter timing: "grid" | "ms"
}

struct Track: Codable {
  var loopKind: String          // demo loop id or "file"
  var cols: Int = 16            // 16 or 8
  var len16: Int = 16           // bar length in sixteenths (multiple of 16/cols)
  var muted = false, solo = false
  var vol: Float = 0.8          // knob position 0…1; gain = 0.85·(vol/0.8)²
  var rows: [String]            // row order, e.g. ["stutter","random","pitch","center","reverse","env","freeze","crush"]
  var cfg: [Fx: EffectConfig]
  var orderV: Float = 1         // play-order strip position (1 = forward)
  var muteV: Float = 0.5        // silence/pattern strip position (0.5 = none)
  var slots: [Sequence?]        // session column (8 by default; rows can be added)
  var edit: Int = 0             // selected slot: where recording and capture go, what the lane shows
}

struct SongRow: Codable { var scene: Int?; var clips: [Int?] }  // a whole session row, or one slot per track
struct Prefs: Codable { seqLen 1|2 (2), silRnd "mute"|"insert", silPat "mute"|"insert", grace 0|20|40|70 (40), shown: Set<Fx> }
struct Project: Codable { bpm 60…200 (124), swing 0…0.5 (0), stepped (true), playMode "replace"|"combine", tracks[4], song [SongRow], prefs, scenes }
```

Default rows per track: `stutter, random, pitch, center (loop/filter row), reverse, env, freeze, crush`. Default loops: A Breakbeat, B Reese bass, C Kalimba, D Vocal chops. Nothing is muted at start.

---

## 5. Engine behaviour (the core spec)

Everything here comes from `src/engine.js`. Port it line for line first, then restructure.

### 5.1 Time and grid
- One loop = one bar at the current tempo. `len = round(sr·240/bpm / 64)·64` samples (rounded to 64 so it splits evenly). The UI resamples or regenerates every loop to exactly `len`. The engine skips a track whose buffer length ≠ `len` (this prevents a NaN crash during tempo changes).
- `u = floor(len/16)` = samples per sixteenth. Positions (`a`) are in **sixteenths**.
- Per track: `cols` ∈ {16, 8}; `sl = floor(len/cols)` = samples per grid step.
- Per-track **bar length**: `s16 = 0`, `e16 = len16` (sixteenths). Steps in the bar: `n = round(e16·cols/16) − round(s16·cols/16)`. The audio loop is always the full bar; bar length only sets where step counting and play order wrap. Columns beyond it still play their slices if touched.
- **Swing**: steps are processed in pairs. `pair = 2·sl`, `split = round(sl·(1+swing))`. Boundaries fall at `t mod pair == 0` (even step) and `== split` (odd step), so odd steps are delayed by `swing·sl`, with no time-stretching. `swing` is 0…0.5.
- Sample time `t` starts at 0 on Play. Each track runs `boundary(t, k)` on its own grid. `k` is the global step index.

### 5.2 `boundary()` — what happens at every step line, in order
1. `finalize()` the previous step's recorded automation (§8.3), and emit any pending `clipStep`.
2. `barPos = (barPos+1) mod n` (−1 → 0 on the first step). When it hits 0, `barN++`.
3. Apply `launchNow` (song row change, which happens at global bar lines).
4. Apply a queued silence setting (`muteQ`).
5. At the track's bar line (`barPos == 0`), apply in this order:
   1. a queued grid change (`applyGrid` resets play order and clears history and capture)
   2. a queued bar-length change (same resets)
   3. recording transitions (§8)
   4. a queued clip launch
   5. a queued capture (§8.4)
6. Snapshot state (for the grace re-decide), then `decide()`.

### 5.3 `decide()` — what plays this step
Inputs: the track's current touches (from the UI), its playing sequence (`clip`), the play order and silence settings, and the global **play mode**.

1. **Classify touches.**
   - In **Combine** mode, every effect touch is *applied* (stacked on whatever plays) and dry waveform taps are ignored.
   - In **Replace** mode, every touch is a *looping* touch. Global touches (globe on) with an effect are also added to every step's effects.
2. **Advance the underlying positions** even if something else plays:
   - the sequence index `cpos` advances by play order (§5.4)
   - the raw-loop slice `tlS` advances by play order within the bar
3. **Pick the base**, in priority order:
   1. If the current step continues (a long stutter or touch spanning more than one step, `left > 0`), keep it.
   2. Else, if there are looping touches: `pickTouch()` takes turns between them in touch order (forward/back/random per the order strip). The step plays that touch's slice with its effect, and lasts `round(touchWidth·u/sl)` steps (1 normally).
   3. Else, during a song row where this track has no sequence: a silent rest.
   4. Else, if a sequence is playing: its step at `cpos`. A step with `off = previous.off+1` and the same `sid` continues the current slice instead of restarting it.
   5. Else: the raw loop slice `tlS`.
4. **Silence** (§5.5) decides whether the step is gated. In "insert" mode, a silenced step also rolls back the position advances, so the sequence waits.
5. **Build the effect list**: the base's effects, then applied/global touches. An effect key appears at most once; later entries replace earlier ones.
   - If an applied stutter or freeze touch is present, the slice is **anchored**: it keeps repeating the slice where that touch began instead of following the sequence.
   - Stutter can stretch the step: if a repeat is longer than the step, the step lasts `ceil(rep/sl)` steps (touch steps only) and `slen` grows.
6. Start the step (`startStep`): random-slice picks its jump, pitch initialises its shifter, crush resets its phase.
7. **Gate** = not inserted ∧ step on ∧ not silenced. Push a history entry (`{bp, bn, ci, on, a, off, sid, slen, fx}`) and feed recording (§8).

**Grace window** (`regrace`): when the set of touches changes (`id:a:fx` signature) within `grace` ms after a step started, the engine rolls back to that step's snapshot and decides again. This makes a slightly late tap sound on time. It doesn't apply when the current step spans more than one step. Default 40 ms; options 0/20/40/70.

### 5.4 Play order (`ord = {mode: fwd|back, r}`)
- `stepOrder(cur, n)`: with probability `r`, jump to a random index; otherwise step forward or back with wraparound. Start: 0 (fwd) or n−1 (back).
- `pickTouch(list)` does the same over held touches, remembering the last one played (by id and order number) so it rotates correctly when touches are added or removed.
- Strip mapping (strip value `v` 0…1, laid out ◀ BACK · RANDOM · FWD ▶):
  - `v ≤ 0.06` → back, r = 0
  - `v ≥ 0.94` → forward, r = 0
  - `v < 0.5` → back, r = (v−0.06)/0.44
  - otherwise → forward, r = (0.94−v)/0.44
  - Default `v = 1`.

### 5.5 Silence and patterns (`mute = {rnd, bits}`)
- Strip value `v`: within ±0.015 of 0.5 → none (snaps to 0.5).
- `v < 0.5` → random silence with probability `(0.5−v)/0.5`.
- `v > 0.5` → pattern index `round((v−0.5)/0.5 · 127)`; index 0 = no pattern.
- **Pattern list** (`patterns()` in ui.js): all 128 eight-step patterns whose first step is on, generated so that bit 0 is always 1 and the remaining 7 bits come from `m` = 0…127, most significant first. Sort by:
  1. number of on-steps, descending
  2. evenness ascending (the sum of squared deviations of the gaps between on-steps from `8/k`)
  3. `m` descending
- A pattern applies by `barPos mod 8`.
- Mute vs insert is a preference, set separately for the random side and the pattern side.
- Silence changes are queued to the next step.

### 5.6 Rendering a sample (`Track.render`)
For each sample `t` in the buffer:
1. Fire `boundary()` on step lines.
2. Resolve each effect's current value (§7) from its *current raw*:
   - recorded automation interpolated across the step, if the step has it
   - otherwise the live finger value, if stepped mode is **off**
   - otherwise the held raw from the start of the step
3. In smooth mode with live fingers, record automation points (§8.3).
4. **Time effects**, composed in reverse list order:
   - stutter folds elapsed time into the repeat length
   - reverse mirrors time within the slice
   - random marks a jump
   - freeze switches to grain synthesis
5. **Read the loop** at `(rPick or a) + tau`, wrapped. If the read position jumps (not the next sample in the current direction), crossfade from the old position over 96 samples (`xf`).
6. **Gain shaping:**
   - after `slen`, fade to zero over 96 samples
   - **slice-edge fades** (1.5 ms, `fd = round(0.0015·sr)`), applied unless the source is the plain loop:
     - fade out into the next step line when the step ends there
     - fade out at the slice end
     - fade the next step in after a faded ending
     - fade each stutter repeat's edges (when the repeat is longer than 4·fd)
7. **Sound effects**, in list order: pitch, env (decay), crush, filter (§6).
8. Gate smoothing `gG += (gate−gG)·0.01`; track mute smoothing `tg += (target−tg)·0.003`.
9. On a new step, a decaying DC-offset patch `dc = last − new` (×0.992 per sample) hides any remaining jump.
10. If the output is NaN, reset that track's DSP state (a safety net).
11. Mix in `out × vol × tg`.

Master: sum → `× g × 0.8` → soft clip (linear below 0.8, then a tanh knee into ±1). `g` ramps over 4 ms on play and stop. Peak is reported to the UI.

---

## 6. Effects reference

Value functions (normalised `v` → real units):
- `stMs(v) = 250·(8/250)^v` ms (stutter, ms mode)
- `DIV = [4, 8, 16, 32, 64, 128]`; stutter grid repeat = `len / DIV[floor(v·6)]`
- `envMs(v) = 3·100^(v/0.985)` ms (decay)
- `hpHz(v) = 25·200^v`; `lpHz(v) = 18000·0.01^v`
- `crHz(v) = 500·32^v` (SRR hold rate)
- `semiQ(v, mask)`: pitch quantised to a scale. With a mask, the cell's travel is spread evenly over just the allowed notes in that direction (up to ±12). Without one, `sign(v)·min(12, floor(|v|·12)+1)`.

| Effect (label) | Row | Cell controls (default) | Other params | DSP |
|---|---|---|---|---|
| Stutter | 1 unit | `len` 0…1 (default range 0→1: 1/4…1/128) | option: Timing grid / ms | Repeat the first `rep` samples of the slice. ms mode re-reads `rep` at each repeat boundary. Ticks drawn at the 6 note values. |
| Random slice | 1 unit | `chance` | `spread` (1 = any slice, else ±1…15) | At step start, with probability `chance`, jump to another slice in the bar (up to 6 tries to differ). |
| Pitch | tall (2.8) bipolar | `semi` (−1…1, centre dead band) | option: scale + 12-key custom mask | Two-tap delay-line pitch shifter: 30 ms window, triangular crossfade between taps, 16k-sample ring. Target semitones glide (`×0.0015`/sample); wet mix fades in and out (`×0.004`). |
| Reverse | thin strip (no cell parameter) | — | — | Mirror time within each slice-length chunk. |
| Decay | 1 unit | `dec` (default range 0→1; ≥ 0.985 = full slice) | — | Amp envelope per slice (restarts on each stutter repeat): `exp(−t/τ)`, τ = envMs, 32-sample attack. |
| Freeze | 1 unit, bipolar | `semi` (grain pitch, same scale system as Pitch) | option: scale | Granular hold at the slice start. Grains of 30.3 ms, Hann window, a new one every glen/12 samples, start jitter up to 20 ms, rate `2^(semi/12)`, sum × 0.28. Size and spray are fixed and hidden. |
| SRR (crush) | 1 unit | `rate` (500 Hz…16 kHz) | — | Sample-and-hold at `crHz(rate)` with a smoothed rate (×0.002). No bit reduction. |
| Filter | loop row bands | `cut` (bipolar: + = HP, − = LP) | `res` 0.7 | TPT state-variable filter, k = 2−1.9·res, cutoff smoothed (×0.002), clamped to 0.45·sr. |

**Removed on purpose; don't bring back without asking:** tape stop, vocoder, delay, wavefold, stutter decay, freeze OTT, crush bit depth, pitch grain size, effect colour choice.

---

## 7. Cells, parameters and effect settings

### 7.1 Raw values and `resolve`
A touch's raw value comes from where the finger is in the cell:
- **Unipolar rows:** `raw = 1 − (y−rowTop)/rowHeight` (bottom 0, top 1).
- **Bipolar rows** (any controlled parameter is bipolar): there's a centre dead band from 42% to 58% of the row height, labelled "NO CHANGE" on tall rows. Above it: `raw = (rel−0.58)/0.42`. Below it: `raw = −(0.42−rel)/0.42`. Inside the band: 0.
- **Loop/filter row:** the top band (above 36% of the row) gives HP `raw = (z1−y)/(z1−top)`, min 0.001. The bottom band (below 64%) gives LP, with the same mapping negated. Between the bands is a dry tap.

`resolve(cfg, fx, raw)` → parameter values:
```
for each parameter p of fx:
  if p ∈ cfg.cells:
     bipolar p:   v = raw>0 ? raw·hi[p] : raw<0 ? −raw·lo[p] : 0        (lo ≤ 0 ≤ hi)
     unipolar p:  v = rowIsBipolar ? lo + (raw+1)/2·(hi−lo) : lo + raw·(hi−lo)   (lo may exceed hi = inverted)
  else:          v = x[p]
```
The engine stores the track's `cfg` and re-resolves whenever raw or cfg changes (it keeps a version counter). **This is why settings edits immediately change recorded sequences.** Keep that property.

### 7.2 Effect settings sheet (tap a row's ≡ handle)
- Title: coloured dot + "Pitch · A". There's no explanation text, by request.
- Options first:
  - stutter: Timing radio buttons
  - pitch and freeze: Scale picker (`Chromatic, Major, Natural minor, Major pentatonic, Minor pentatonic, Octaves and fifths, Octaves, Custom`) plus a one-octave keyboard (root C). Tapping a key toggles that pitch class and switches the picker to Custom.
- Then one **vertical slider per parameter** (40×170 pt track), with name, value above, value below, and a **"Cell" checkbox** underneath.
  - Unticked: one handle sets the fixed value `x`.
  - Ticked: two handles set the cell's top (`hi`) and bottom (`lo`) values. Bipolar parameters are clamped to ≥ +0.02 above and ≤ −0.02 below the centre. Unipolar handles may cross, which inverts the range.
- Every change is sent to the engine immediately (throttled to once per frame), so a playing sequence follows the edit.

### 7.3 Row geometry
- Rows stack below the strips: `TOP` = 66 pt (both strips), or 30 pt when folded (§10.4).
- Row heights use weights: loop/filter row 3.2, pitch 2.8, other rows 1. Any row whose effect has **no** cell parameter (Reverse, or all Cell boxes unticked) becomes a fixed 20 pt thin strip. Rows have a 3 pt gap.
- Rows can be reordered by dragging the ≡ handle more than 8 pt vertically (a ghost row follows the finger; a bar shows the drop point). A tap on the handle opens settings.
- Effects can be hidden in Preferences ("Effects shown"). Hidden effects still play when they're recorded in a sequence.

---

## 8. Recording, capture and sequences

### 8.1 Rules (as approved)
- Recording only ever happens on the **viewed track**. Switching tracks stops it.
- **Starting into an empty slot** creates a new sequence:
  - if Record is pressed in the first half of a bar, that bar's steps so far are taken from history (no lost downbeat)
  - in the second half, recording waits for the next bar line
- **A new recording never stops by itself.** When it reaches the sequence length (Prefs: 1 or 2 bars), it becomes the sequence (`clip` event) and keeps recording over it, looping. From then on it replaces or combines according to the mode.
- **Starting on an existing sequence** records over it in place and keeps its length. It loops until Record is pressed again. If the sequence isn't playing yet, it's launched first and recording begins when it does.
- **Stopping a new recording early:**
  - in the first half of a bar, the current bar is cut off and the sequence ends at the previous bar line
  - otherwise it finishes at the end of the bar (state "closing")
- Recorded data is raw touch data: slice, on/off, and effect touches with raw positions and optional automation.

### 8.2 Replace / Combine (global mode, one button)
- **Replace:** touches take over from the sequence (or loop); recording replaces each step with what played.
- **Combine:** touches never change the slice; effects stack on whatever plays; waveform taps are ignored. Recording keeps each step's slice and on/off state and merges effects in. An effect already on the step is replaced; others are kept. Steps without a touch are left untouched.

### 8.3 Smooth vs stepped, and automation
- **Stepped** (the default, staircase icon): an effect's value is held from the start of each step.
- **Smooth** (curve icon): values follow the finger continuously. While recording in smooth mode, each step with a live finger records **16 automation points** (`AUTO = 16`) spread across the grid step length `sl` (swing doesn't change the mapping).
  - At the end of the step (`finalize`), unfilled points are carried forward. If the points are flat (within 1e-4), the automation is dropped and only `raw` is kept.
  - Playback linearly interpolates the points across the step **regardless of the stepped toggle**. The toggle only affects live playing.

### 8.4 Capture (button left of Record)
Capture prints what you just heard (the history ring) into a sequence. The length is the Prefs sequence length (S = 1 or 2 bars) × `n` steps.
- Window position = `((barN mod S)·n + barPos) / (S·n)`.
  - **≥ 0.75** (last quarter): wait until the window ends, then capture that whole window and start playing it at once.
  - Earlier: capture the most recent whole bars ending at the last bar line (up to S bars). The new sequence starts at the next bar.
- Destination: the selected slot if empty, otherwise the next empty slot of that track (wrapping). If none is empty, add a session row. The captured sequence becomes the selected one.
- The lane's "live" view shows the current S-bar window, so you can see exactly what Capture will print.

### 8.5 Editing sequences in the lane
- **Tap and release a step** to switch it off or on (on release, not on touch).
- **Hold a step and tap a cell:** the cell's slice and the finger's raw position are assigned to that step. Keep sliding to adjust; let go to finish. A held step gets a white outline.
- **Hold a cell, then tap a step:** pastes the held cell into the step (older gesture, kept).
- **Clear** (header) deletes the selected sequence. The first tap arms it ("Sure?") for 2.5 s; the second tap clears.
- **Dice** makes a random sequence of the sequence length in the selected slot:
  - each step picks dry ×3 or one of the shown effects that has a cell, or filter
  - a random slice within the bar
  - bipolar raw = ±(0.15…1)
- Sequences are labelled by track letter and slot number: A1, B3, …

### 8.6 Grid, bar length and sequence length changes (Preferences)
- Per-track **grid** (1/16, 1/8) and **bar length** (− / + in grid steps, 1…16 sixteenths): if the track has sequences, an inline confirm appears first ("This deletes track A's 2 sequences. [Change] [Cancel]"). Then the track's sequences are deleted, its playing sequence stops, and the change lands on the track's next bar line.
- **Sequence length** 1 / 2 bars: if the selected sequence has a different length, confirm first ("Replace A1 with a blank 1-bar sequence?"). It's then replaced with a **blank sequence**: the bar's slices in order (step i → slice i mod n), no effects, same id so it keeps playing. Other sequences keep their length.

---

## 9. Session view and song

- Toggle with the session/track icon (two-columns-of-lines icon ↔ 4×4 dots). Session replaces the tabs, the lane and the grid.
- **Clips grid** (title "CLIPS"): a left column of row-launch ▶ buttons, then 4 track columns.
  - **Header boxes** per track: letter, S, M, a stop button, and a volume knob. The knob sits at 0.8 = 0 dB; drag 150 pt for the full range; double-tap resets to 0 dB. **Its size must not change as the dB readout changes.**
  - The stop-all button sits top-left.
  - **Cells have no text**, only a thumbnail: each step drawn as a short bar at its slice height, coloured by its first effect, with off steps faint.
  - States: selected (white outline), playing (▶ marker), queued (breathing outline), dimmed if not audible.
  - Tap a cell to select and launch it (quantised to the bar). Tap an empty cell to select it for recording. Tap a row ▶ to launch a whole row.
  - "+ Add row" adds a row.
- **Song** (title "SONG", always visible below):
  - Rows hold either a whole session row (drag a row ▶ in) or per-track clips (drag cells in).
  - Each row's length = its longest clip.
  - Tap a row's ▶ to play the song from there; drag the ▶ vertically to reorder; × removes the row.
  - A trailing empty row is always present.
  - During a song, a track with no clip in the current row is silent.
  - Any manual launch ends song playback.
- Drag and drop uses pointer capture plus a floating ghost. Session updates are done in place, so a drag in progress is never destroyed by a re-render. Keep that in SwiftUI (stable identities, no wholesale rebuilds while dragging).

---

## 10. Screen layout and interaction spec

Portrait only; lock the orientation. Side gutter 16 pt. Top to bottom:

### 10.1 Header (8-column grid, 36 pt tall controls, 5 pt gaps, max width 560)
- Row 1: **Gear** (Preferences) · **Tempo** (2 columns) · **Swing** (2 columns) · **Capture** · **Record** · **Play** (1 column, amber)
- Row 2: **Session/Track** · **Globe** · **Stepped/Smooth** · **Dice** · **Replace/Combine** (2 columns) · **Clear** (2 columns)
- Tempo and swing are drag fields: drag up or right to increase, 4 pt per unit; tempo 60–200 (default 124), swing 0–50%. They're the same height as the buttons. A tempo change rebuilds loops after 350 ms of inactivity, and the engine rescales positions without stopping.
- Record states: idle; waiting (breathing); on (red); on + Combine (orange). Capture breathes while it waits for a window end, and is disabled when stopped.
- Replace/Combine shows its current name; Combine is highlighted orange.

### 10.2 Sequencer lane (above the tabs)
- Height: `rows·24 + 6` pt, where rows = min(2, max(sequence length, the selected sequence's bars)).
- The left 34 pt shows the sequence label: "A1", "REC" (red; orange in Combine), or "live".
- One cell per step showing the slice number (+ for half-steps), coloured by its first effect, with up to 3 extra effect dots. Off steps and pattern-silenced steps are dimmed.
- The playing step gets an accent outline. In the live view, the current window fills in as it plays.

### 10.3 Track tabs and loop row
- Four tabs: letter (in the track colour), activity dot, S, M. Solo overrides mute (`audible = solo || (!muted && !anySolo)`). The view dims when the viewed track isn't audible.
- The loop row holds the "Loop" picker (9 demo loops + "Load your own…") and, on the right, the **fold chevron** (§10.4).

### 10.4 Strips and fold
- Two 28 pt strips:
  - **Play order:** ◀ BACK · RANDOM n% · FWD ▶, with an accent marker.
  - **Silence / pattern:** ◀ SILENCE n% on the left half; on the right half, 8 small squares showing the pattern, where the square for the current step **glows softly**; PATTERN ▶.
- A 26 pt ↺ box to the right of each strip turns on "snap back to default on release".
- **Double-tap a strip** to reset it (order → forward, silence → none).
- **Fold chevron:** collapses the lane and both strips into one 24 pt bar showing:
  - the label
  - a mini step strip with the playhead
  - the order and silence summary

  Tapping the bar unfolds it. This recovers about 110 pt for the rows.

### 10.5 Effect grid
- 30 pt handle column (colour bar + ≡), then `cols` cells per row.
- Labels inside the row: the effect name on the left, and the current value on the right while touched (otherwise the range). On tall and bipolar rows, labels sit at the top.
  - pitch and freeze: scale tick marks on the right edge
  - stutter: ticks at the note values
- **Value lines:** for every held finger on a cell-controlled parameter, draw a bright line at its value across the cell, plus a faint dashed guide across the whole row (the finger covers its own cell). This includes the HP/LP bands.
- The cell under a finger is highlighted; a 17 pt ring is drawn at each finger. The playing slice's cell gets a bright outline in rows whose effect is active.
- Columns past the track's bar length are dimmed (they still play).
- The loop row shows the waveform (peaks): the playing slice brighter, with a playhead line in the middle band, dotted band edges, slice numbers, and "HIGH-PASS ↑ / LOW-PASS ↓" labels.

### 10.6 Global mode (globe)
- While the globe is on, **touches and both strips act on all four tracks**. The strips show one shared value. Each track's own values are kept underneath and restored when the globe goes off.
- The accent turns blue and the **whole background tints** (`#0f1a2c`) instead of drawing a frame.

### 10.7 Preferences sheet (gear)
1. Sequence length (1 / 2 bars, with confirm)
2. Grid and bar length per track A–D (with confirm)
3. Silence slider, random side (mute / insert)
4. Pattern slider (mute / insert)
5. Late touches (0 / 20 / 40 / 70 ms)
6. Effects shown (checkboxes)
7. Latency information
8. Reset everything (tap twice)

The sheet has a sticky header with a close button. There are no toast popups anywhere in the app, by request.

### 10.8 Haptics (new for native; confirm with Andrew)
Suggestions:
- a light tick on bar-quantised events (launch landing, capture landing)
- a selection tick on strip detents (FWD, BACK and the pattern centre)

Keep haptics off the performance grid by default; they can mask timing.

---

## 11. Visual design tokens

| Token | Value |
|---|---|
| Background | `#111317` (global mode `#0f1a2c`) |
| Panel / raised / line | `#1a1d23` / `#242831` / `#2f3440` |
| Text / dim | `#ece7dc` / `#8a8f99` |
| Accent (normal / global) | `#ffc65c` / `#7fb2ff` |
| Record / Combine | `#e5484d` / `#ff9a4a` (lane label `#ffb36b`) |
| Solo on / mute on | `#b5f08a` on `#2b3a1f` / `#ff9b9b` on `#3a2020` |
| Track hues (HSL) | A 40, B 170, C 265, D 330 — text `hsl(h 75% 62%)` |
| Effect hues | stutter 8, random 44, pitch 318, reverse 166, decay 90, freeze 190, SRR 262, filter 40 (LP band uses hue+160) |
| Cell fill | `hsl(hue 16% 13%)`; held `hsl(hue 70% 46%)`; value line `hsl(hue 85% 72%)` |
| Font | Martian Mono (Google Fonts, OFL; bundle it), uppercase labels with 0.06em tracking, 9–10 pt in the grid |
| Corner radius | cells 5, panels 7–8, sheets 12 |

The icons are simple 20×20, 1.7 pt-stroke line drawings (see `ICON` in `ui.js`): play, stop, record dot, capture brackets + dot, stepped staircase, smooth curve, globe, dice, two-column lines, 4×4 dot grid, gear, close, fold chevrons. SF Symbols equivalents are fine where they read the same.

---

## 12. Demo loops and audio import

- `src/synth.js` `makeLoop(kind, sr, bpm)` synthesises 9 loops, renders 2 bars and keeps the second, so tails wrap seamlessly. Kinds:
  - `break` (Breakbeat), `boombap`
  - `acid`, `reese`, `dub`
  - `lead`, `keys`, `kalimba`, `vox`

  Loops are regenerated whenever the tempo or sample rate changes.
- **Native recommendation:** port `synth.js` to an offline C++/Swift generator (runs off the audio thread, about 50 ms per loop), so tempo changes keep exact bar lengths. The alternative, bundling pre-rendered loops and resampling, changes their pitch with tempo.
- **Load your own** (Files picker): decode, keep up to 4 s, normalise to a 0.82 peak, then **resample the clip to exactly one bar**. The prototype does this, so it changes the pitch and speed of the sample. Better natively: let the user trim to a bar and time-stretch, or detect the tempo. Ask Andrew (§14).

---

## 13. Build plan for Claude Code

Each milestone ends with something Andrew can run on a phone.

**M0 — Project setup.**
- Xcode project (SwiftUI app, iOS 17+), a C++ `SlicefieldCore` target and an XCTest target.
- Copy `prototype/` into `Reference/` unchanged.
- Add `CLAUDE.md` (included in this package).
- Bundle Martian Mono.

**M1 — Engine port with parity.**
- Port `engine.js` to C++ class for class: `Engine`, `Track`, and the effect DSP.
- Replace allocation with pools (§3) and `Math.random` with an injectable mulberry32.
- Write a small host that runs the JSON scenarios in `Reference/tools/scenarios` and compares the results with the JS renders (§16).
- Port `tests/engine.test.js` to XCTest.
- **Done when:** all tests pass, the step logs match, and the audio matches within tolerance.

**M2 — Audio host.**
- `AVAudioEngine` + `AVAudioSourceNode` calling `Engine::render`.
- The audio session from §3; command, event and status queues.
- A debug screen with Play and four loops.
- **Done when:** it plays on device with the silent switch on, and survives interruptions.

**M3 — Performance grid.**
- The UIKit multi-touch grid view: rows, loop row with waveform, hit-testing, raw values, the touch list sent to the engine (sorted by touch order), the grace window.
- Strips, tabs, header transport, tempo and swing.
- **Done when:** the effects play under the fingers as in the prototype.

**M4 — Settings and preferences.**
- Effect settings sheet with vertical sliders and Cell checkboxes, live cfg updates.
- Scale keyboard, row reorder, effect visibility.
- The Preferences sheet with its confirms.

**M5 — Sequencer.**
- The lane, recording rules (§8), Replace/Combine, stepped/smooth automation, Capture.
- Hold-step-tap-cell, release-to-toggle, Clear, Dice, fold.

**M6 — Session and song.**
- Clip grid, launching, thumbnails, knobs, solo/mute, song rows, drag and drop, song playback.

**M7 — App things.**
- Persistence (autosave the `Project` as JSON; named projects?).
- Audio import, haptics, app icon, TestFlight.

When you are unsure how something should feel, open the prototype on a phone and compare. Andrew has tuned it by hand.

---

## 14. Open questions for Andrew

1. **Recording in global mode.** Today it records only the viewed track (including the global touches you hear on it). The suggested change is that Rec and Capture in global mode record all four tracks at once, each into its own selected slot. *Not decided.*
2. **Effect combining per row / custom "slice field maps."** It was discussed and parked ("not yet"). A suggested design was in the conversation: 1–3 effects per row, each effect at most once per track, a fixed in-row order, plus presets.
3. **Removing a single held value.** Latch mode was removed entirely, so there's no way to keep a value without holding it except by recording or capturing. That's intentional; confirm it stays that way.
4. **Persistence and projects.** One autosaved project, or named projects? Export audio or stems? Share sequences?
5. **Imported audio:** resample to a bar (current behaviour, changes pitch) or trim and time-stretch?
6. **Background audio, Ableton Link and MIDI clock**: wanted?
7. **iPad layout**: the prototype is portrait iPhone only.
8. **Master level:** with all four demo tracks unmuted, the sum hits the soft clipper (the reference renders peak at 1.0). Keep that "hot" character, or add master gain staging or a limiter?

---

## 15. Known quirks and things to improve natively

- **Sequence continuation dip.** A sequence step that continues the previous slice (`off > 0`, from long stutters) gets the 1.5 ms fade-out and fade-in, a tiny dip. It could be fixed by deciding the next step slightly early. Low priority.
- **Clip id encodes the slot** (`t{track}s{slot}_…`, parsed by regex in `storeClip`). Use real fields natively.
- **UI keeps "last heard" gates** (`t.lg`) to dim random-silenced steps from the last pass, since random silence can't be predicted. Pattern silence is predicted exactly (`patDim`).
- **The status cadence** is every 768 samples (~16 ms at 48 kHz). Natively, publish a snapshot every buffer and let the display link read it.
- **The pitch shifter is deliberately simple** (two-tap). A better algorithm (a phase vocoder or PSOLA) is welcome if it keeps latency under about 30 ms, but get Andrew's ear on it.
- **Web-only workarounds to drop:**
  - AudioWorklet/ScriptProcessor fallback, the iOS silent-WAV unlock, the `gen` guard against duplicate engines
  - mouse handling (`buttons === 0` gesture end), the `[hidden]` CSS rule
  - chunked loop generation with `setTimeout`
- **No undo** exists anywhere in the prototype. Consider undo for Clear, grid changes and recording passes, since these are the destructive actions.

---

## 16. Parity testing against the prototype

`prototype/tools/render-reference.js` runs scenario files. Each scenario sets a seed, tempo and loops, and lists timed engine messages (`at` is a sample index or `{bar, step}` in sixteenths of the loop). Messages are applied at 128-sample block boundaries. It writes:
- `out/<name>.wav`: 48 kHz stereo float master output
- `out/<name>.steps.json`: one entry per step decision, `[t, track, src, slice, gate, "fx+fx"]`
- `out/<name>.events.json`: engine events with sample times

The native test host should:
1. Generate the same loops (port `synth.js`, or load loops exported from the JS by extending the script).
2. Seed mulberry32 identically and draw random numbers at the same points in the same order. The draw points are:
   - `stepOrder`, once per sequence/loop advance
   - `pickTouch`
   - `silenced`, random side
   - random-slice pick in `startStep`, up to 6 tries
   - freeze grain jitter

   If the draws match, **the step logs must match exactly.**
3. Compare audio per scenario. The target is RMS difference < −60 dBFS relative to the reference, with no single-sample error above 1e-3 outside freeze sections (float summation order may differ). If exact draw-order parity is impractical, relax this to matching step logs on scenarios 01, 03 and 04, plus perceptual checks.

Add scenarios as you go. Every bug fixed in either implementation should get one.

---

## 17. Appendix

### A. Engine message protocol (UI → engine)
| type | fields | effect |
|---|---|---|
| `load` / `loadAll` | `tr, L, R` / `bufs[4]` | set loop buffers; if the length changed, rescale running positions |
| `play` / `stop` | — | start from t = 0 (resets all tracks) / stop (ends recordings and capture, clears song) |
| `touches` | `tr, list:[{id, a, n, o, fx:{k, raw}|null, glob}]` | the current held touches for a track (a, n in sixteenths; o = touch order); may trigger a grace re-decide |
| `cfg` | `tr, cfg:{fx: EffectConfig}` | replace effect settings; bumps the version counter |
| `grid` | `tr, n, q` | grid 16/8, queued to the bar if `q` and playing |
| `range` | `tr, s16, e16, q` | bar length, queued to the bar if `q` and playing |
| `mode` | `mode: replace|combine` | global play mode |
| `order` | `tr, mode, r` | play order |
| `mute` | `tr, rnd, bits` | silence (queued to the next step) |
| `tmute` / `tvol` | `tr, on` / `tr, v` | effective mute (after solo logic) / track gain |
| `swing` / `stepped` | `s` / `on` | |
| `pref` | `{silRnd, silPat, grace, seqLen}` | |
| `view` | `tr` | which track's history to report |
| `capture` | `tr, id` | §8.4 |
| `rec` | `tr, on, id` / `over: clip` | start new / record over existing / stop |
| `launch` | `tr, clip|null` | queue a sequence (null = raw loop) at the next bar; starts transport if stopped; ends song |
| `clipEdit` | `clip` | replace a sequence everywhere it's referenced (steps edited, blank replacement) |
| `song` / `songRows` / `songStop` | `rows:[{bars, clips[4]}], from` | play the song from a row (next global bar) / update rows live / stop the song |

Engine → UI events: `clip {tr, clip, cap?}` (a recording or capture became a sequence), `clipStep {tr, id, idx, slot}` (recording wrote a step; sent at step start and again with final automation), `overDone`, `grid {tr, n}`, `songRow {idx}`, plus `status`.

### B. Constants
- AUTO = 16 automation points per step
- slice-edge fade = 1.5 ms
- position-jump crossfade = 96 samples
- post-slice fade = 96 samples
- DC patch decay = 0.992 per sample
- gate smoothing = 0.01; mute smoothing = 0.003
- master ×0.8, soft clip knee at 0.8, 4 ms play/stop ramp
- pitch ring = 16384 samples; pitch window = 30 ms
- freeze grain = 30.3 ms
- history ring = 96 steps
- touch grace default 40 ms
- volume curve `0.85·(v/0.8)²`, knob default 0.8 (0 dB)
- strip snap zones: order ±0.06 at the ends; silence ±0.015 around the centre
- bipolar dead band 42–58%; loop-row bands at 36% / 64%
- lane row 24 pt; label column 34 pt; strips 28 pt; folded bar 24 pt; handle column 30 pt; thin row 20 pt; row gap 3 pt
- row weights: loop row 3.2, pitch 2.8, others 1

### C. Where to look in the prototype
| Topic | File · function |
|---|---|
| Step decision | `engine.js` · `Track.decide`, `boundary`, `regrace` |
| Effects DSP | `engine.js` · `Track.render`, `startStep` |
| Cell → value | `engine.js` · `resolveInto`, `rowBip`, `defCfg` |
| Recording / capture | `engine.js` · `msg('rec')`, `finishRec`, `finalize`, `capture`, `doCapture` |
| Hit-testing and raw values | `ui.js` · `hit`, `rawToRel`, `computeLayout` |
| Touch list sent to the engine | `ui.js` · `entriesOf`, `toEngine`, `push` |
| Strips and patterns | `ui.js` · `orderFrom`, `muteFrom`, `patterns`, `drawStrips`, `drawSlim` |
| Lane and step editing | `ui.js` · `laneInfo`, `laneDown`, `assignStep`, `drawLane` |
| Settings sheet | `ui.js` · `openSettings`, `vcol`, `scaleEditor` |
| Preferences and confirms | `ui.js` · the `prefsBtn` click handler, `setShape`, `blankSequence` |
| Session and song | `ui.js` · `renderSession`, `renderSong`, `dragSource`, `rowMover`, `songRowsForEngine` |
