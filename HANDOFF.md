# Slicefield — handoff for the iOS app

This guide and the `prototype/` folder are everything needed to build Slicefield as a native iPhone app. The prototype is a single-page web app (version 16) designed through about fifteen rounds of hands-on testing on a phone. Treat its behaviour as the specification: when this document and the code disagree, the code in `prototype/src/` is what was actually played and approved. Say so in the pull request if you change any behaviour on purpose.

**For Claude Code:** read this whole file first, then `prototype/src/engine.js` (about 580 lines, the heart of it). Section 13 gives the build order. Section 14 lists decisions the owner (Andrew) hasn't made yet. Ask him about those instead of guessing. Section 18 covers using Slicefield as the sound engine inside a larger app, and section 19 lists what changed in version 16.

---

## Contents

1. What Slicefield is
2. What's in this package
3. Recommended iOS architecture
4. Data model
5. Engine behaviour (the core spec)
6. Effects reference
7. Cells, parameters and effect settings
8. Recording and sequences
9. Clips, song and export
10. Screen layout and interaction spec
11. Visual design tokens
12. Demo loops and audio import
13. Build plan for Claude Code
14. Open questions for Andrew
15. Known quirks and things to improve natively
16. Parity testing against the prototype
17. Appendix: constants, message protocol, algorithms
18. Slicefield as an engine inside a larger app
19. Changes in version 16

---

## 1. What Slicefield is

Slicefield is a one-channel touch instrument for one-bar loops.

- It plays one one-bar audio loop, cut into a grid of slices (1/16 or 1/8).
- The screen is a grid. **Horizontal position picks the slice; vertical position within a row sets the effect amount.** The middle row (the "loop row") shows the waveform: a tap there loops that slice dry, the top band is a high-pass filter and the bottom band a low-pass.
- Every touch is quantised to the slice grid. Several held cells take turns in the order they were touched.
- A **sequencer** records what you hear, step by step, as "sequences". Each holds one bar of steps, and each step stores a slice plus effect touches.
- A **clips view** holds 8+ sequences (clips) in one column; they launch on the bar. A **song** column chains them. Both export as audio.
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
  tools/scenarios/*.json       four scenarios (plain loop, every effect, 4 engine tracks + swing, record/FX only/combine)
```

To regenerate the reference renders (written to `tools/out/`, about 20 MB, not checked in), run `node tools/render-reference.js`. Running it twice gives byte-identical step logs.

How the prototype is put together:

- `engine.js` exports `engineFactory()`. In the browser it runs inside an AudioWorklet and talks to the UI only through messages (`msg()` in, `post()` out). That boundary maps directly onto a real-time audio thread plus a UI thread on iOS.
- `ui.js` keeps all user-facing state: the track, effect settings, clips, song and prefs. It pushes what the engine needs, and it draws everything on two `<canvas>` elements (the sequencer lane and the effect grid), plus HTML for the header, tabs, sheets and session view.

---

## 3. Recommended iOS architecture

### Stack
- **Swift + SwiftUI** for the app shell, sheets (Preferences, effect settings, export), the clips and song view.
- **A UIKit `UIView` subclass for the performance grid and sequencer lane.** It needs raw multi-touch with `touchesBegan/Moved/Ended` (set `isMultipleTouchEnabled = true`, no gesture recognisers on the grid), the lowest possible latency, and precise drawing. Draw with Core Graphics in `draw(_:)` at display rate, or Metal if profiling demands it. SwiftUI gestures aren't suitable for 4+ simultaneous fingers with per-finger identity.
- **DSP core in C++ (recommended) or carefully written Swift**, hosted in an `AVAudioSourceNode` on `AVAudioEngine`. C++ makes the real-time rules (no allocation, no locks, no Objective-C/Swift runtime calls) easy to guarantee. Swift 5.9+ C++ interop, or a thin C API, connects it to the app. An AUv3 is a possible later step; nothing here prevents it.
- **Minimum iOS 17** is a reasonable default, so the app can use the Observation framework. Ask Andrew if older support matters.

### Threads and boundaries (mirror the prototype)
```
UI thread ──(SPSC lock-free queue: Command)──▶ audio thread (Engine.render every buffer)
UI thread ◀──(SPSC queue: EngineEvent)──────── audio thread
UI thread ◀──(atomic double-buffered Status snapshot, ~60 Hz)── audio thread
```
- **Command** = every `msg()` type in Appendix A (touches, cfg, launch, rec, …).
- **EngineEvent** = `clip`, `clipStep`, `overDone`, `grid`, `songRow` (the prototype's `post` events). They carry finished sequences back to the UI's model.
- **Status** = the prototype's `status` message: playing, sample time, loop length, per-track `info()`, and the viewed track's recent step history. Publish it as a fixed-size struct the UI reads each frame. Don't allocate it per buffer.
- **Ownership of sequences (clips):** the UI builds an immutable clip and hands the engine a pointer. The engine never frees memory; it returns replaced clips through a "garbage" queue for the UI to release. The engine edits clip steps in place while recording. On iOS, make the engine own a mutable copy and emit `clipStep` events so the UI model mirrors it, which is exactly what the prototype does.

### Real-time rules the JS engine breaks (fix these in the port)
- `Math.random()` → a fast seedable RNG (use mulberry32 for parity tests; see §16).
- Allocation per step: `mkE()` effect-entry objects, `fx` arrays in `decide()`, rec/hist step objects, freeze grains (`gr.push`/`splice`), `hist.splice`, `info()` objects, `Object.assign` copies. Replace them with fixed-capacity pools:
  - ≤ 8 effect entries per step
  - ≤ 64 grains
  - a hist ring of 96
  - recording buffers sized at the maximum sequence length, 1 bar × 16 steps = 16 (keep 32 if older 2-bar sequences must load)
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
// env is shown to the user as "Decay"; filter lives on the loop row.

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
  var steps: [Step]             // n steps (one bar); the engine still plays longer ones
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
  var rows: [String]            // row order, e.g. ["stutter","random","pitch","center","reverse","env","freeze","crush"]
  var cfg: [Fx: EffectConfig]
  var orderV: Float = 1         // play-order strip position (1 = forward)
  var muteV: Float = 0.5        // silence/pattern strip position (0.5 = none)
  var slots: [Sequence?]        // session column (8 by default; rows can be added)
  var edit: Int = 0             // selected slot: where recording and the randomizer go, what the lane shows
}

struct SongRow: Codable { var clip: Int? }                 // a slot index, or an empty row
struct Prefs: Codable { silRnd "mute"|"insert", silPat "mute"|"insert", grace 0|20|40|70 (40), shown: Set<Fx> }
struct Project: Codable { bpm 60…200 (124), swing 0…0.5 (0), stepped (true), playMode "replace"|"combine", fxOnly (false), track, song [SongRow], prefs, slots }
```

Default rows: `stutter, random, pitch, center (loop/filter row), reverse, env, freeze, crush`. Default loop: Breakbeat.

The engine still takes a track count (`new Engine(sr, nTracks)`, default 1) and the song rows carry a `clips` array per track. The app uses one track; the extra capacity costs nothing and keeps the door open for a host that runs several instances side by side (§18).

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
   1. a queued grid change (`applyGrid` resets play order and clears history)
   2. a queued bar-length change (same resets)
   3. recording transitions (§8)
   4. a queued clip launch
6. Snapshot state (for the grace re-decide), then `decide()`.

### 5.3 `decide()` — what plays this step
Inputs: the track's current touches (from the UI), its playing sequence (`clip`), the play order and silence settings, and two global switches: **Replace / Combine** and **FX only**.

1. **Classify touches.** The two switches are independent:

   | | FX only **off** (touches pick slices) | FX only **on** (slices come from the sequence or loop) |
   |---|---|---|
   | **Replace** | Touched slices take turns; each step plays its touch's own effect. | The step keeps its slice; the touches take turns giving it *their* effect (a dry tap gives none), in place of the step's own effects. |
   | **Combine** | Touched slices take turns; *every* held effect plays on each of them. If one effect is held twice, the most recent touch's value wins. | Every held effect stacks on whatever plays (the step's own effects stay, same effect = replaced). Dry taps are ignored. |

   In code: *looping* touches (`loopT`) are all touches except in FX only + Combine; *applied* touches are all effect touches in Combine.
2. **Advance the underlying positions** even if something else plays:
   - the sequence index `cpos` advances by play order (§5.4)
   - the raw-loop slice `tlS` advances by play order within the bar
3. **Pick the base**, in priority order:
   1. If the current step continues (a long stutter or touch spanning more than one step, `left > 0`), keep it.
   2. Else, if FX only is off and there are looping touches: `pickTouch()` takes turns between them in touch order (forward/back/random per the order strip). The step plays that touch's slice (with its effect in Replace), and lasts `round(touchWidth·u/sl)` steps (1 normally).
   3. Else, during a song row where this track has no sequence: a silent rest.
   4. Else, if a sequence is playing: its step at `cpos`. A step with `off = previous.off+1` and the same `sid` continues the current slice instead of restarting it.
   5. Else: the raw loop slice `tlS`.
   6. FX only + Replace with looping touches: `pickTouch()` picks the touch whose effect this (sequence or loop) step gets.
4. **Silence** (§5.5) decides whether the step is gated. In "insert" mode, a silenced step also rolls back the position advances, so the sequence waits.
5. **Build the effect list**: the base's effects, then applied touches in touch order. An effect key appears at most once; later entries replace earlier ones.
   - FX only + Combine: if an applied stutter or freeze touch is present, the slice is **anchored**: it keeps repeating the slice where that touch began instead of following the sequence.
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
   - past the slice end (`el ≥ slen`): silent when edge fades apply; a plain-loop step without swing fades out over 96 samples instead
   - **slice-edge fades**, applied unless the source is the plain loop *and* swing is 0. All fades use a smoothstep curve `x²(3−2x)` so they have no corner at either end. Lengths: `fd = round(0.0015·sr)` (1.5 ms); with swing `s > 0`, fade-outs last `fd + s·0.012·sr` (up to 7.5 ms) and fade-ins `fd + s·0.006·sr` (up to 4.5 ms):
     - fade out into the next step line when the step ends there (fade-out length)
     - fade out at the slice end (fade-out length)
     - fade the next step in after a faded ending (fade-in length)
     - fade each stutter repeat's edges over `fd` (when the repeat is longer than 4·fd)
   - Why: with swing, a slice ends before the delayed next step starts. In v15 the slice-end fade reached zero one sample early and the post-slice fade then restarted at full gain, leaking a 2 ms burst of the next slice into every swing gap. That was the swing click; the test "swing gap is silent" guards it.
7. **Sound effects**, in list order: pitch, env (decay), crush, filter (§6).
8. Gate smoothing `gG += (gate−gG)·0.01`; track mute smoothing `tg += (target−tg)·0.003` (only used by multi-track hosts).
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
- `crHz(v) = 500·32^v` (Crush hold rate)
- `semiQ(v, mask)`: pitch quantised to a scale. With a mask, the cell's travel is spread evenly over just the allowed notes in that direction (up to ±12). Without one, `sign(v)·min(12, floor(|v|·12)+1)`.

| Effect (label) | Row | Cell controls (default) | Other params | DSP |
|---|---|---|---|---|
| Stutter | 1 unit | `len` 0…1 (default range 0→1: 1/4…1/128) | option: Timing grid / ms | Repeat the first `rep` samples of the slice. ms mode re-reads `rep` at each repeat boundary. Ticks drawn at the 6 note values. |
| Random slice | 1 unit | `chance` | `spread` (1 = any slice, else ±1…15) | At step start, with probability `chance`, jump to another slice in the bar (up to 6 tries to differ). |
| Pitch | tall (2.8) bipolar | `semi` (−1…1, centre dead band) | option: scale + 12-key custom mask | Two-tap delay-line pitch shifter: 30 ms window, triangular crossfade between taps, 16k-sample ring. Target semitones glide (`×0.0015`/sample); wet mix fades in and out (`×0.004`). |
| Reverse | 1 unit (no cell parameter) | — | — | Mirror time within each slice-length chunk. |
| Decay | 1 unit | `dec` (default range 0→1; ≥ 0.985 = full slice) | — | Amp envelope per slice (restarts on each stutter repeat): `exp(−t/τ)`, τ = envMs, 32-sample attack. |
| Freeze | 1 unit, bipolar | `semi` (grain pitch, same scale system as Pitch) | option: scale | Granular hold at the slice start. Grains of 30.3 ms, Hann window, a new one every glen/12 samples, start jitter up to 20 ms, rate `2^(semi/12)`, sum × 0.28. Size and spray are fixed and hidden. |
| Crush | 1 unit | `rate` (500 Hz…16 kHz) | — | Sample-and-hold at `crHz(rate)` with a smoothed rate (×0.002). No bit reduction. |
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
- Row heights use weights: loop/filter row 3.2, pitch 2.8 (when it has a cell parameter), every other row 1, including rows with **no** cell parameter (Reverse, or all Cell boxes unticked). v15 shrank those to a 20 pt strip, which was too small to hit. Rows have a 3 pt gap.
- Rows can be reordered by dragging the ≡ handle more than 8 pt vertically (a ghost row follows the finger; a bar shows the drop point). A tap on the handle opens settings.
- Effects can be hidden in Preferences ("Effects shown"). Hidden effects still play when they're recorded in a sequence.

---

## 8. Recording and sequences

### 8.1 Rules (as approved)
- **Starting into an empty slot** creates a new sequence:
  - if Record is pressed in the first half of a bar, that bar's steps so far are taken from history (no lost downbeat)
  - in the second half, recording waits for the next bar line
- **A new recording never stops by itself.** When it reaches one bar, it becomes the sequence (`clip` event) and keeps recording over it, looping. From then on it replaces or combines according to the mode.
- **Starting on an existing sequence** records over it in place and keeps its length. It loops until Record is pressed again. If the sequence isn't playing yet, it's launched first and recording begins when it does. (Sequences are always one bar now; an older longer one would keep its length.)
- **Stopping a new recording early:**
  - in the first half of a bar, the current bar is cut off and the sequence ends at the previous bar line
  - otherwise it finishes at the end of the bar (state "closing")
- Recorded data is raw touch data: slice, on/off, and effect touches with raw positions and optional automation.

### 8.2 Recording with Replace / Combine and FX only
Recording prints what you hear (§5.3 table), with one difference driven by **FX only** when recording over a sequence:
- **FX only off:** every step is replaced with what played (slice, on/off, effects).
- **FX only on:** each step keeps its slice and on/off state. Only steps that were touched change, and they take the effects heard (merged in Combine, the touch's effect in Replace; a dry tap in Replace removes them). Untouched steps are left alone.

### 8.3 Smooth vs stepped, and automation
- **Stepped** (the default, staircase icon): an effect's value is held from the start of each step.
- **Smooth** (curve icon): values follow the finger continuously. While recording in smooth mode, each step with a live finger records **16 automation points** (`AUTO = 16`) spread across the grid step length `sl` (swing doesn't change the mapping).
  - At the end of the step (`finalize`), unfilled points are carried forward. If the points are flat (within 1e-4), the automation is dropped and only `raw` is kept.
  - Playback linearly interpolates the points across the step **regardless of the stepped toggle**. The toggle only affects live playing.

### 8.4 Capture
Removed in v16 (Andrew's call). The engine keeps its 96-step history ring only for the lane's live view and for a recording started in the first half of a bar.

### 8.5 Editing sequences in the lane
- **Tap and release a step** to switch it off or on (on release, not on touch).
- **Hold a step and tap a cell:** the cell's slice and the finger's raw position are assigned to that step. Keep sliding to adjust; let go to finish. A held step gets a white outline.
- **Hold a cell, then tap a step:** pastes the held cell into the step (older gesture, kept).
- **Trash** (header, one column, trash icon):
  - Tap it and release, touching nothing else: the selected sequence is deleted **on release**. No confirm. Undo is the natural partner for this (§15).
  - Hold Trash and tap steps, or hold steps and tap Trash: just those steps are cleared. Releasing Trash afterwards does nothing more, and the held steps don't toggle on/off when released.
  - A cleared step goes back to the loop's own slice for its position (`a = idx`, on, no effects), exactly what plays with no sequence.
- **Randomizer** (header, two columns): a die resting at the left end of a slider.
  - Drag the die right, or tap anywhere on the slider: the die jumps there and that position sets the **amount** (0–100 %). The sequence morphs live while you drag. Letting go keeps the result and the die rolls home (0.5 s, rotation proportional to distance).
  - Tapping without dragging applies the amount on release. Tapping the die where it rests (amount ≈ 0) does nothing.
  - Hold the die and tap steps: only those steps are re-rolled, each tap a fresh roll, at the held amount, or 100 % when the die is held at its rest spot. The whole-sequence change then doesn't happen on release.
  - An empty slot starts from a blank sequence (slices in order), so 100 % there is close to v15's dice.
  - **The scheme**, per step, at amount `a`. Every step gets its own fixed random numbers for the whole gesture, so dragging further only ever adds change and dragging back undoes it smoothly:

    | What | Chance (per step) | How far |
    |---|---|---|
    | the step is affected at all | `a` | — |
    | its slice moves (if affected) | `a` (so `a²` overall) | up to ±`a`·bar length, wrapped in the bar |
    | each existing effect is removed (if affected) | `a/2` | — |
    | each kept effect's cell position is nudged (if affected) | always | up to ±`a` in raw units (automation shifts with it) |
    | one effect is added (if affected) | `a/2` | a shown effect not already on the step (filter and reverse included), random position; bipolar = ±(0.15…1) |

    On/off state is never changed. A step whose slice moved gets a new `sid`, so it no longer continues a long stutter.
- Sequences are labelled by slot number: 1, 2, 3, …

### 8.6 Grid and bar length changes (Preferences)
- **Grid** (1/16, 1/8) and **bar length** (− / + in grid steps, 1…16 sixteenths): if there are sequences, an inline confirm appears first ("This deletes your 3 clips and empties the song. [Change] [Cancel]"). Then the sequences are deleted, the song rows are emptied, the playing sequence stops, and the change lands on the next bar line.
- Sequence length is fixed at one bar; there is no preference.

## 9. Clips, song and export

- Toggle with the clips/effects icon (two-columns-of-lines icon ↔ 4×4 dots). The clips view replaces the lane, loop row and grid.
- Two columns side by side, each one column wide and scrolling on its own:
  - **Clips** (left): a **■ Loop** button on top (stops the clip and plays the plain loop, ends the song), then the slots, then "+ Add".
    - Each slot shows a thumbnail (each step a short bar at its slice height, coloured by its first effect, off steps faint) and its number in the corner. The number matches the lane label.
    - States: selected (white outline), playing (▶ marker), queued (breathing outline).
    - Tap a slot to select it and launch it (quantised to the bar). Tap an empty slot to select it for recording.
  - **Song** (right): rows of [▶ handle · clip thumbnail · ×].
    - Drag a clip from the left column onto a song row to put it there. A trailing empty row is always present.
    - Each row lasts its clip's length (one bar). An empty row (or a deleted clip) plays a silent bar.
    - Tap a row's ▶ or thumbnail to play the song from there. Drag the ▶ vertically to reorder. × removes the row.
    - Any manual launch ends song playback.
- Drag and drop uses pointer capture plus a floating ghost. Session updates are done in place, so a drag in progress is never destroyed by a re-render. Keep that in SwiftUI (stable identities, no wholesale rebuilds while dragging).
- **Export** (header share icon) opens a sheet:
  - **Export song**: the filled song rows, rendered in order. The sheet shows rows · bars · seconds.
  - **Export each clip**: one file per clip. Or tap a single clip's number to export just that one.
  - Rendering is offline: a fresh engine with the same loop, grid, bar length, effect settings, tempo and swing, run faster than real time (`bounce()` in engine.js). Play order is forward and there is no silence/pattern, so the file is the clip as written. Files are 24-bit stereo WAV at the loop's sample rate, named `slicefield-song-124bpm.wav` and `slicefield-clip-3-124bpm.wav`.
  - Delivery in the web prototype: inside claude.ai the page uses the artifact `downloads` capability, which accepts `.zip` but not `.wav`, so exports arrive as a stored (uncompressed) zip. Elsewhere one file downloads as `.wav` and several as `.zip`. Natively: render on a background thread with the same engine code, write WAVs to a temp folder, and hand them to the share sheet (`ShareLink` / `UIActivityViewController`), or offer "Save to Files".
  - Open question: should exports include the play-order and silence strips as currently set, or a tail for effects that ring past the bar? (§14)

## 10. Screen layout and interaction spec

Portrait only; lock the orientation. Side gutter 16 pt. Top to bottom:

### 10.1 Header (8-column grid, 36 pt tall controls, 5 pt gaps, max width 560)
- Row 1: **Gear** (Preferences) · **Tempo** (2 columns) · **Swing** (2 columns) · **Export** · **Record** · **Play** (1 column, amber)
- Row 2: **Clips/Effects view** · **Stepped/Smooth** · **Randomizer** (2 columns) · **Replace/Combine** (2 columns) · **FX only** · **Trash**
- Tempo and swing are drag fields: drag up or right to increase, 4 pt per unit; tempo 60–200 (default 124), swing 0–50%. They're the same height as the buttons. A tempo change rebuilds loops after 350 ms of inactivity, and the engine rescales positions without stopping.
- Record states: idle; waiting (breathing); on (red); recording over with FX only (orange).
- Replace/Combine shows its current name; Combine is highlighted orange. FX only is a toggle (teal when on).

### 10.2 Sequencer lane (below the header)
- Height: one row, `24 + 6` pt. A longer (older) sequence pages; tap the label to turn the page.
- The left 34 pt shows the label: the slot number ("3"), "REC" (red; orange when recording over with FX only), or the number above "live" when the slot is empty.
- One cell per step showing the slice number (+ for half-steps), coloured by its first effect, with up to 3 extra effect dots. Off steps and pattern-silenced steps are dimmed.
- The playing step gets an accent outline. In the live view, the current bar fills in as it plays.

### 10.3 Loop row
- The loop row holds the "Loop" picker (9 demo loops + "Load your own…") and, on the right, the **fold chevron** (§10.4). There are no track tabs.

### 10.4 Strips and fold
- Two 28 pt strips:
  - **Play order:** ◀ BACK · RANDOM n% · FWD ▶, with an accent marker.
  - **Silence / pattern:** ◀ SILENCE n% on the left half; on the right half, 8 small squares showing the pattern, where the square for the current step **glows softly**; PATTERN ▶.
- A 26 pt ↺ box to the right of each strip turns on "snap back to default on release". It is **on by default for the silence/pattern strip** (snaps back to centre) and off for play order.
- **Double-tap a strip** to reset it (order → forward, silence → none).
- **Fold chevron:** folds away the lane, the loop row and both strips, leaving one 24 pt bar with just a ▾ chevron (no mini sequencer or strip summary). Tapping the bar unfolds it. This recovers about 150 pt for the rows.

### 10.5 Effect grid
- 30 pt handle column (colour bar + ≡), then `cols` cells per row.
- Labels inside the row: the effect name on the left, and the current value on the right while touched (otherwise the range). On tall and bipolar rows, labels sit at the top.
  - pitch and freeze: scale tick marks on the right edge
  - stutter: ticks at the note values
- **Value lines:** for every held finger on a cell-controlled parameter, draw a bright line at its value across the cell, plus a faint dashed guide across the whole row (the finger covers its own cell). This includes the HP/LP bands.
- The cell under a finger is highlighted; a 17 pt ring is drawn at each finger. The playing slice's cell gets a bright outline in rows whose effect is active.
- Columns past the track's bar length are dimmed (they still play).
- The loop row shows the waveform (peaks): the playing slice brighter, with a playhead line in the middle band, dotted band edges, slice numbers, and "HIGH-PASS ↑ / LOW-PASS ↓" labels.

### 10.6 Global mode
Removed in v16 with the move to one channel.

### 10.7 Preferences sheet (gear)
1. Grid and bar length (with confirm)
2. Silence slider, random side (mute / insert)
3. Pattern slider (mute / insert)
4. Late touches (0 / 20 / 40 / 70 ms)
5. Effects shown (checkboxes)
6. Latency information
7. Reset everything (tap twice)

The sheet has a sticky header with a close button. There are no toast popups anywhere in the app, by request.

### 10.8 Haptics (new for native; confirm with Andrew)
Suggestions:
- a light tick on bar-quantised events (launch landing, song row change)
- a soft tick as the randomizer's die passes each 25 %
- a selection tick on strip detents (FWD, BACK and the pattern centre)

Keep haptics off the performance grid by default; they can mask timing.

---

## 11. Visual design tokens

| Token | Value |
|---|---|
| Background | `#111317` |
| Panel / raised / line | `#1a1d23` / `#242831` / `#2f3440` |
| Text / dim | `#ece7dc` / `#8a8f99` |
| Accent | `#ffc65c` |
| Record / Combine | `#e5484d` / `#ff9a4a` (lane label `#ffb36b`) |
| FX only on | `#8ff0cf` text, `#5ee0b4` border on `#1d2f2a` |
| Track hue (HSL) | 40 — text `hsl(40 75% 62%)` |
| Effect hues | stutter 8, random 44, pitch 318, reverse 166, decay 90, freeze 190, crush 262, filter 40 (LP band uses hue+160) |
| Cell fill | `hsl(hue 16% 13%)`; held `hsl(hue 70% 46%)`; value line `hsl(hue 85% 72%)` |
| Font | Martian Mono (Google Fonts, OFL; bundle it), uppercase labels with 0.06em tracking, 9–10 pt in the grid |
| Corner radius | cells 5, panels 7–8, sheets 12 |

The icons are simple 20×20, 1.7 pt-stroke line drawings (see `ICON` in `ui.js`): play, stop, record dot, share (export), trash, stepped staircase, smooth curve, dice, two-column lines, 4×4 dot grid, gear, close, fold chevrons. SF Symbols equivalents are fine where they read the same.

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
- A debug screen with Play and a loop picker.
- **Done when:** it plays on device with the silent switch on, and survives interruptions.

**M3 — Performance grid.**
- The UIKit multi-touch grid view: rows, loop row with waveform, hit-testing, raw values, the touch list sent to the engine (sorted by touch order), the grace window.
- Strips, loop row, header transport, tempo and swing.
- **Done when:** the effects play under the fingers as in the prototype.

**M4 — Settings and preferences.**
- Effect settings sheet with vertical sliders and Cell checkboxes, live cfg updates.
- Scale keyboard, row reorder, effect visibility.
- The Preferences sheet with its confirms.

**M5 — Sequencer.**
- The lane, recording rules (§8), Replace/Combine, FX only, stepped/smooth automation.
- Hold-step-tap-cell, release-to-toggle, Trash (with hold gestures), the randomizer, fold.

**M6 — Session and song.**
- Clip column, launching, thumbnails, song column, drag and drop, song playback.
- Export (offline render → WAV → share sheet).

**M7 — App things.**
- Persistence (autosave the `Project` as JSON; named projects?).
- Audio import, haptics, app icon, TestFlight.

When you are unsure how something should feel, open the prototype on a phone and compare. Andrew has tuned it by hand.

---

## 14. Open questions for Andrew

1. **Export details.** Should exports follow the play-order and silence strips as currently set (today they don't), and should they include a tail for effects that ring past the bar? Stems per effect?
2. **Effect combining per row / custom "slice field maps."** It was discussed and parked ("not yet"). A suggested design was in the conversation: 1–3 effects per row, each effect at most once per track, a fixed in-row order, plus presets.
3. **Removing a single held value.** Latch mode was removed entirely, so there's no way to keep a value without holding it except by recording or capturing. That's intentional; confirm it stays that way.
4. **Persistence and projects.** One autosaved project, or named projects? Export audio or stems? Share sequences?
5. **Imported audio:** resample to a bar (current behaviour, changes pitch) or trim and time-stretch?
6. **Background audio, Ableton Link and MIDI clock**: wanted?
7. **iPad layout**: the prototype is portrait iPhone only.
8. **Master level:** with one track the master peaks around 0.5–0.6; the soft clipper (from the four-track days) rarely engages. Keep the 0.8 master gain, or bring a single track up nearer full scale?
9. **Trash without a confirm.** A single tap now deletes the selected sequence (on release), as requested. Add undo (recommended) or bring back a confirm?
10. **FX only naming.** The new switch is labelled "FX only". "Original loop" was the other candidate.

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
- **No undo** exists anywhere in the prototype. Consider undo for Trash, the randomizer, grid changes and recording passes, since these are the destructive actions. Trash no longer asks first, so this matters more now.

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
| `play` / `stop` | — | start from t = 0 (resets all tracks) / stop (ends recordings, clears song) |
| `touches` | `tr, list:[{id, a, n, o, fx:{k, raw}|null, glob}]` | the current held touches for a track (a, n in sixteenths; o = touch order); may trigger a grace re-decide |
| `cfg` | `tr, cfg:{fx: EffectConfig}` | replace effect settings; bumps the version counter |
| `grid` | `tr, n, q` | grid 16/8, queued to the bar if `q` and playing |
| `range` | `tr, s16, e16, q` | bar length, queued to the bar if `q` and playing |
| `mode` | `mode: replace|combine` | Replace / Combine |
| `fxonly` | `on` | FX only (§5.3) |
| `order` | `tr, mode, r` | play order |
| `mute` | `tr, rnd, bits` | silence (queued to the next step) |
| `tmute` / `tvol` | `tr, on` / `tr, v` | track mute / gain (the app doesn't send these; for multi-track hosts) |
| `swing` / `stepped` | `s` / `on` | |
| `pref` | `{silRnd, silPat, grace}` | |
| `view` | `tr` | which track's history to report |
| `rec` | `tr, on, id` / `over: clip` | start new / record over existing / stop |
| `launch` | `tr, clip|null` | queue a sequence (null = raw loop) at the next bar; starts transport if stopped; ends song |
| `clipEdit` | `clip` | replace a sequence everywhere it's referenced (steps edited, blank replacement) |
| `song` / `songRows` / `songStop` | `rows:[{bars, clips[nTracks]}], from` | play the song from a row (next global bar) / update rows live / stop the song |

Engine → UI events: `clip {tr, clip}` (a recording became a sequence), `clipStep {tr, id, idx, slot}` (recording wrote a step; sent at step start and again with final automation), `overDone`, `grid {tr, n}`, `songRow {idx}`, plus `status`.

### B. Constants
- AUTO = 16 automation points per step
- slice-edge fade = 1.5 ms, smoothstep shaped; with swing s: fade-out 1.5 ms + 12·s ms, fade-in 1.5 ms + 6·s ms
- position-jump crossfade = 96 samples
- post-slice fade = 96 samples
- DC patch decay = 0.992 per sample
- gate smoothing = 0.01; mute smoothing = 0.003
- master ×0.8, soft clip knee at 0.8, 4 ms play/stop ramp
- pitch ring = 16384 samples; pitch window = 30 ms
- freeze grain = 30.3 ms
- history ring = 96 steps
- touch grace default 40 ms
- track gain 0.85 (the v15 volume knob is gone; a host can still send `tvol`)
- strip snap zones: order ±0.06 at the ends; silence ±0.015 around the centre
- bipolar dead band 42–58%; loop-row bands at 36% / 64%
- lane row 24 pt; label column 34 pt; strips 28 pt; folded bar 24 pt; handle column 30 pt; row gap 3 pt; randomizer die 30 pt
- row weights: loop row 3.2, pitch 2.8, others 1

### C. Where to look in the prototype
| Topic | File · function |
|---|---|
| Step decision | `engine.js` · `Track.decide`, `boundary`, `regrace` |
| Effects DSP | `engine.js` · `Track.render`, `startStep` |
| Cell → value | `engine.js` · `resolveInto`, `rowBip`, `defCfg` |
| Recording | `engine.js` · `msg('rec')`, `finishRec`, `finalize` |
| Offline render | `engine.js` · `bounce`; `ui.js` · `exportEngine`, `wav24`, `zip`, `offer` |
| Randomizer | `ui.js` · `rollStep`, `diceAll`, `diceStep` |
| Trash | `ui.js` · `clearSequence`, `clearSteps`, `trashHeld` |
| Hit-testing and raw values | `ui.js` · `hit`, `rawToRel`, `computeLayout` |
| Touch list sent to the engine | `ui.js` · `entriesOf`, `toEngine`, `push` |
| Strips and patterns | `ui.js` · `orderFrom`, `muteFrom`, `patterns`, `drawStrips`, `drawSlim` |
| Lane and step editing | `ui.js` · `laneInfo`, `laneDown`, `assignStep`, `drawLane` |
| Settings sheet | `ui.js` · `openSettings`, `vcol`, `scaleEditor` |
| Preferences and confirms | `ui.js` · the `prefsBtn` click handler, `setShape`, `blankClip` |
| Session and song | `ui.js` · `renderSession`, `renderSong`, `dragSource`, `rowMover`, `songRowsForEngine` |

---

## 18. Slicefield as an engine inside a larger app

Andrew may run Slicefield as the sound and performance engine inside a larger, platform-style app. Most of it is cheap to plan for now and expensive to retrofit, so build it this way from M1, even for the standalone app.

**Package boundaries**
- **`SlicefieldCore`** (C++, a thin C API, or a Swift package wrapping it): the engine, the effect DSP, the loop synth and the offline renderer. It has no UIKit, no AVAudioSession, no file I/O and no globals. Everything lives in an instance, so a host can create several (one per channel, or a preview instance next to a live one).
- **`SlicefieldUI`**: the grid and lane `UIView`s and the SwiftUI sheets. They talk to an engine only through a protocol (commands in, status and events out), never by reaching into its internals.
- **`SlicefieldApp`**: the standalone shell. It owns the audio session, persistence, import and export UI.

**Who owns what**
- **Audio session and graph.** The host owns `AVAudioSession` and the `AVAudioEngine`. The core exposes `render(out, frames)` and the host decides where that runs: its own `AVAudioSourceNode`, a mixer bus, or an AUv3 later. Don't configure the session from inside the core.
- **Clock and transport.** Today the engine's sample counter `t` is its clock and Play resets it. For embedding, accept an external transport: a host sample position plus tempo (and later Ableton Link or MIDI clock), and derive bar and step lines from that. Keep "start at the next bar" as an option, so a Slicefield channel can join a running host. Keep tempo changes the same message they are now (§5.1, which rescales positions).
- **Sample rate and buffers.** Already handled by `load` with a buffer of the new length. Keep loop generation and resampling off the audio thread, as now.
- **Content.** Loops come from the host's library (an asset ID plus a decoded buffer), not only from the built-in synth. Clips, effect settings and the song are plain `Codable` values (§4) that the host can save inside its own document. Give them a `version` field and IDs that are real UUIDs, not the prototype's `t0s3_…` strings (§15).
- **Rendering.** `bounce()` (offline render) is already part of the core; the export feature uses it. A host can use the same call for its own bounces, stems or a song timeline.

**API shape**
- The message protocol (Appendix A) is the public API. Keep it a typed enum of commands, versioned, with no UI concepts in it. Touches arrive as abstract `{id, slice, width, order, effect, raw}`, so a host can drive the engine from MIDI, a different controller or automation instead of the grid.
- Expose parameters by stable identifiers (`fx.pitch.semi.lo`, `strip.order`, `strip.silence`, `swing`, `mode`, `fxOnly`) so a host can automate or MIDI-map them, and an AUv3 can publish them as an `AUParameterTree`.
- Events out (`clip`, `clipStep`, `songRow`, status) should be subscribable, not a single callback, so several UIs (the grid plus a host overview) can watch one engine.
- One-channel UI, multi-channel core: the engine still takes `nTracks` and song rows carry one clip per track. A host that wants four Slicefields side by side can use one engine with four tracks (shared clock, one render call) or four engines. Either works; one engine is simpler for sync.

**Things to avoid**
- Singletons, `static` state or a global RNG (the RNG is already injectable for parity).
- Calls from the engine back into Swift, ObjC or the UI on the audio thread.
- Assuming the app's window, orientation or safe area inside `SlicefieldUI`. Take a size and lay out from it, so the grid can sit in a host's panel or sheet.
- Persisting anything from inside the core.

---

## 19. Changes in version 16

From Andrew's notes on v15. Every item is reflected in the sections above.

| Change | Where |
|---|---|
| One channel: no track tabs, solo, mute, volume knobs, globe, or per-track grid/length rows. Clips and song are one column each, side by side. | §1, §4, §9, §10 |
| Sequences fixed at one bar (no 1/2-bar preference). | §8.1, §8.6 |
| Export: the song, every clip, or one clip, as 24-bit WAV (offline render). | §9 |
| Capture removed. | §8.4 |
| Rows without a cell parameter (Reverse) are back to the normal one-unit height. | §7.3 |
| Swing click fixed: a 2 ms leak of the next slice into each swing gap. Swing fades are also longer and smoothstep-shaped. | §5.6 |
| Fold also hides the loop row, and the folded bar no longer shows a mini sequencer or strip summary. | §10.4 |
| Randomizer: a die on a two-button slider (drag or tap to set the amount, rolls home on release; hold it and tap steps). Scheme documented. | §8.5 |
| "SRR" renamed back to "Crush". | §6 |
| Silence/pattern strip snaps back to centre on release by default. | §10.4 |
| Clear is a one-column trash icon. A tap clears the sequence on release; hold it and tap steps (or hold steps and tap it) to clear just those. | §8.5 |
| New **FX only** switch, independent of Replace/Combine. Combine now means "touched slices still play, all held effects apply; latest touch of an effect wins". | §5.3, §8.2 |

Tests: `node prototype/tests/engine.test.js` (18 cases, including FX only + Replace, Combine with touched slices, and "swing gap is silent"). Scenario `04-record-capture` became `04-record-fxonly`.
