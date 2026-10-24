# Slicefield — handoff for the iOS app

This guide and the `prototype/` folder are everything needed to build Slicefield as a native iPhone app. The prototype is a single-page web app (version 23) designed through about fifteen rounds of hands-on testing on a phone. Treat its behaviour as the specification: when this document and the code disagree, the code in `prototype/src/` is what was actually played and approved. Say so in the pull request if you change any behaviour on purpose.

**For Claude Code:** read this whole file first, then `prototype/src/engine.js` (about 580 lines, the heart of it). Section 13 gives the build order. Section 14 lists decisions the owner (Andrew) hasn't made yet. Ask him about those instead of guessing. Section 18 covers using Slicefield as the sound engine inside a larger app, and sections 19–21 list what changed in versions 16, 17 and 18. **Version 18 replaced recording, clips and the song with capture and a Takes list, and the play-order and silence strips with fixed ORDER and SKIP patterns.** Where §5.4, §5.5, §8, §9, §10.4 or §20 disagree with §21, §21 wins.

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
20. Changes in version 17
21. Changes in version 18 (and the planned next steps)
22. Changes in version 19
23. Changes in version 20
24. Changes in version 21
25. Changes in version 22: fields, the game, and a leaner Clips page
26. Changes in version 23: fields as rows, the waveform ruler, the game's second pass

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
  src/engine.js                audio engine: tracks, step decisions, effects, capture, ORDER/SKIP patterns, song (pure JS, no DOM)
  src/synth.js                 demo-loop synthesiser (9 loops) + resample helper, inside synthFactory()
  src/ui.js                    the whole UI: touch handling, drawing, sheets, Takes list, export
  src/app.html                 the instrument's CSS + markup (lives in its shadow root)
  src/page.html                the host page: title, font, one <div id="slicefield">
  tests/engine.test.js         behaviour tests (node tests/engine.test.js) — port these to XCTest
  tools/render-reference.js    renders scripted scenarios to WAV + step logs for parity testing
  tools/scenarios/*.json       five scenarios (plain loop, every effect, 4 engine tracks + swing, capture/FX only/combine, patterns + delay)
```

To regenerate the reference renders (written to `tools/out/`, about 20 MB, not checked in), run `node tools/render-reference.js`. Running it twice gives byte-identical step logs.

How the prototype is put together:

- The built page defines exactly one global, the class `Slicefield` (v18). The engine factory, the loop synth, the markup and the interface code are its static members, and `new Slicefield(element)` draws a complete instrument into that element's shadow root, so its CSS and element ids never touch the host page. Several instances can sit on one page.
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
   | **Combine** | Touched slices take turns; *every* held effect plays on each of them, **layered on the step's own effects** (v20; the plain loop and empty steps have none). If one effect is held twice, or a held effect is already on the step, the most recent touch's value wins. | Every held effect stacks on whatever plays (the step's own effects stay, same effect = replaced). Dry taps are ignored. |

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
> **Replaced in v18** by fixed ORDER patterns (`ord = {perm}`); see §21.

- `stepOrder(cur, n)`: with probability `r`, jump to a random index; otherwise step forward or back with wraparound. Start: 0 (fwd) or n−1 (back).
- `pickTouch(list)` does the same over held touches, remembering the last one played (by id and order number) so it rotates correctly when touches are added or removed.
- Strip mapping (strip value `v` 0…1, laid out ◀ BACK · RANDOM · FWD ▶):
  - `v ≤ 0.06` → back, r = 0
  - `v ≥ 0.94` → forward, r = 0
  - `v < 0.5` → back, r = (v−0.06)/0.44
  - otherwise → forward, r = (0.94−v)/0.44
  - Default `v = 1`.

### 5.5 Silence and patterns (`mute = {rnd, bits}`)
> **Replaced in v18** by fixed SKIP patterns (`mute = {bits}`), 16 steps, no random side; see §21.

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

Master: sum → `× g` (unity; `g` ramps over 4 ms on play and stop) → look-ahead limiter (1.5 ms look-ahead, ceiling −1 dBFS, 80 ms release, linear-attack ramp that reaches each peak's required gain exactly when that peak is output) → hard clamp ±1. Untouched audio therefore plays and exports at exactly its source level. The last 8 bars of output are kept in a ring for "export what you just heard". Peak and a limiter-active flag are reported to the UI.

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
| Crush | 1 unit | `rate` (500 Hz…16 kHz) | — | Sample-and-hold at `crHz(rate)` with a smoothed rate (×0.002). No bit reduction. Loudness-compensated (v20, §23.5). |
| Delay | 1 unit | `send` | `time` (1/16…1/2), `fb`; option: Tails ring / cut | Tempo-synced ping-pong send, darkened repeats. Tails (v20, §23.4). |
| Reverb | 1 unit | `send` | `size` (RT60 0.3…9 s), `tone`; option: Tails ring / cut | Send into a 4-line FDN (§23.4). |
| Filter | loop row bands | `cut` (bipolar: + = HP, − = LP) | `res` 0.7 | TPT state-variable filter, k = 2−1.9·res, cutoff smoothed (×0.002), clamped to 0.45·sr. Resonance level-matched (v22, §25.6). |

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

> **Back in v19, simpler (§22.1):** Record overdubs the touched steps into the sequence in place; there are no new-recording rules. §8.2 (what gets written) and §8.3 (automation) apply as written. The v18 note follows for history.
>
> **Replaced in v18:** there is no record button. Every bar is captured and kept on the Takes list (§21). Lane editing (§8.5), smooth/stepped automation (§8.3) and grid changes (§8.6) still apply to the main page's sequence.

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
  - A cleared step becomes **empty** (v17): it plays the clip's background (§20).
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

> **Replaced in v18** by the Takes list and its export (§21), and in v19 by Capture and the Clips page (§22).

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
> **v18:** the strips are ORDER and SKIP (GAP); see §21 for their layout and fine control. The pin and fold rules below still apply.

- Two 28 pt strips:
  - **Play order:** ◀ BACK · RANDOM n% · FWD ▶, with an accent marker.
  - **Silence / pattern:** ◀ SILENCE n% on the left half; on the right half, 8 small squares showing the pattern, where the square for the current step **glows softly**; PATTERN ▶.
- A 26 pt **pin** box to the right of each strip (v17, replaces ↺). Pinned: dragging changes the value stored on the selected clip (or the plain loop), which is kept, played and exported. Unpinned: dragging is a live override and the strip snaps back to the stored value on release. Defaults: play order pinned, silence/pattern unpinned. The stored value is a solid marker; a live override is a dashed ghost marker.
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

Postponed by Andrew (v22): resampling a take into a new loop, Ableton Link and MIDI clock, background audio, the iPad layout, desktop/VST input, sharing projects, and the native app itself (until the game is further along).

1. **Fields** (rows, §26.1). Still open: the maximum of 10 rows and 4 effects a row, the order of effects inside a row (as added now), whether the filter's dry middle should be wider again (it uses the same middle band as Pitch now), and the ruler's height (24 pt).
2. **The game** (second pass, §26.5): scoring and currency (waiting on the larger platform), round length (16 bars), the gesture mix and timing, whether mines stay, and an in-world theme (§26.5 lists ideas).
3. **Imported audio** is stretched to the bar by default now (§25.6); resampling is the other choice in Preferences. Still open: trimming or choosing which part of a long file becomes the bar.
4. **Persistence and projects.** Named projects in a folder library (§24.6, now a sheet, §25.5).

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
| `load` / `loadAll` | `tr, L, R` / `bufs[4]` | set the track's own loop (`base`); if the length changed, rescale running positions |
| `loopBuf` | `key, L, R` | hold a loop that sequences can name with `clip.loop = key` (clips made on other loops, §23.2) |
| `play` / `stop` | — | start from t = 0 (resets all tracks) / stop (clears song) |
| `touches` | `tr, list:[{id, a, n, o, fx:[{k, raw}]|null}]` | the current held touches for a track (a, n in sixteenths; o = touch order). `fx` lists every cell under the finger (overlapping cells, §25.3); a single `{k, raw}` is still accepted. May trigger a grace re-decide |
| `cfg` | `tr, cfg:{fx: EffectConfig}` | replace effect settings (the field's); bumps the version counter |
| `field` | `tr, order:[effect keys]` | the field's signal order, top to bottom (§25.3). A sequence may carry its own `cfg` and `rank` (`{key: place}`, from `rankOf(order)`), which win while it plays |
| `grid` | `tr, n, q` | grid 16/8, queued to the bar if `q` and playing |
| `range` | `tr, s16, e16, q` | bar length, queued to the bar if `q` and playing |
| `mode` | `mode: replace|combine` | Replace / Combine |
| `fxonly` | `on` | FX only (§5.3) |
| `order` | `tr, perm|null` | the plain loop's ORDER pattern from `orderPattern(v, n)` (a sequence carries its own `ord = {perm}`) |
| `mute` | `tr, bits|null` | the plain loop's SKIP pattern from `skipPattern(v, n)`, queued to the next step (a sequence carries `mute = {bits}`) |
| `live` | `tr, ord?, mute?` | live (unpinned) strip override; `null` clears it. Effective = live ∥ playing sequence's stored ∥ the loop's own |
| `grab` | `bars` | post back the last whole bars of output (`grabbed {L, R, sr}`) |
| `tmute` / `tvol` | `tr, on` / `tr, v` | track mute / gain (the app doesn't send these; for multi-track hosts) |
| `swing` / `stepped` | `s` / `on` | |
| `pref` | `{silPat: mute|insert, grace, lat, touchWin, fill}` | SKIP or GAP; late-touch window = `grace + lat` ms (`lat`: reported output latency); touches play through SKIP when `touchWin`; `fill: false` makes empty steps (and the plain loop) silent (§26.3) |
| `view` | `tr` | which track's history to report |
| `launch` | `tr, clip|null, now` | set the sequence (null = raw loop): stopped, at once (it **never** starts playback); playing, at the next bar, or at once with `now` (the clip position picks up from the loop's, `cpos = lp`); ends song |
| `rec` | `tr, on, id` | Record: while on, touched steps are written into the playing sequence whose id matches (§22.1) |
| `clipEdit` | `clip` | replace a sequence everywhere it's referenced (steps edited, blank replacement) |
| `song` / `songRows` / `songStop` | `rows:[{bars, clips[nTracks]}], from, once` / `rows, idx` | play the list from a row (next global bar; starts transport if stopped); with `once` it stops after the last row (`songEnd`) / update rows live, `idx` = the row now playing in the new list / stop the song |

Engine → UI events: `clipStep {tr, id, idx, bn, slot}` (a step written by recording, sent once the step has ended), `grabbed {L, R, sr}`, `grid {tr, n}`, `songRow {idx}`, `songEnd`, plus `status`. The v18 `bar` capture event and the v17 `clip` and `overDone` are gone.

### B. Constants
- AUTO = 16 automation points per step
- slice-edge fade = 1.5 ms, smoothstep shaped; with swing s: fade-out 1.5 ms + 12·s ms, fade-in 1.5 ms + 6·s ms
- position-jump crossfade = 96 samples
- post-slice fade = 96 samples
- DC patch decay = 0.992 per sample
- gate smoothing = 0.01; mute smoothing = 0.003
- master unity, look-ahead limiter at −1 dBFS (1.5 ms look-ahead, 80 ms release), 4 ms play/stop ramp
- pitch ring = 16384 samples; pitch window = 30 ms
- freeze grain = 30.3 ms
- history ring = 96 steps
- touch grace default 40 ms
- track gain 1 (a host can still send `tvol`); imported loops are no longer normalised
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

**Input without multi-touch (web, VST, desktop).** Andrew wants iOS first, but web and VST versions could be useful, and a mouse is one pointer. Ideas to settle later (§14):
- latch: click a cell to hold it until clicked again (the prototype had a latch mode in earlier versions), so several cells can be "held" at once
- the computer keyboard as a second hand: rows of keys mapped to columns or to cells of the current field
- MIDI notes and controllers mapped to cells (the touch messages already take abstract `{id, slice, effect, raw}`, so this needs no engine change)
- moving holds: drag with the mouse while a key is down, or map a controller to the held cell's `raw`

**Things to avoid**
- Singletons, `static` state or a global RNG (the RNG is already injectable for parity). The web prototype now follows the same rule: one class, no globals (§2).
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

---

## 20. Changes in version 17

Agreed with Andrew after v16. The model has three layers, with two actions that move things down.

| Layer | What lives there | Lasts |
|---|---|---|
| **Live** | fingers on the grid; an unpinned strip while held | until you let go |
| **Clip** | per clip: play order and silence/pattern (strip positions), random **seed**, **variation length** (1/2/4/8 bars or never), **background** (loop or silence) | saved with the clip, played and exported |
| **Steps** | slice, on/off, effects, or **empty** | saved |

- **Keep** = the pin on a strip (§10.4): pinned moves write to the selected clip, or to the plain loop's own settings when the slot is empty.
- **Print** (Clip sheet): renders one variation cycle offline and writes what played into the steps. Play order, silence, patterns and random-slice jumps become ordinary steps (random slice is replaced by the slice it picked). The strips reset to forward / no silence, and the variation length goes to 1. Printing an empty slot makes a new clip from the plain loop. A 4-bar cycle prints as a 4-bar clip (the lane pages).

**Repeating randomness (engine).**
- Each track has a seeded generator `rnd()` used for play order (`stepOrder`), random silence and the Random slice effect.
  - Touch rotation (`pickTouch`) and freeze grain jitter stay truly random.
- At every bar line, with variation length `v > 0` and a cycle of `clipBars × v` bars:
  - `pass = barsSinceContextStart mod cycle`
  - the generator is reseeded with `seedMix(seed, pass)`
  - at `pass == 0` the play positions restart
- The context is the playing clip's id, or the plain loop; changing it restarts the count.
- `v = 0` means "never" (`Math.random`, as before).
- The generator state is part of the grace-window snapshot.
- A song row lasts one full cycle of its clip.

**Empty steps and backgrounds.**
- A step can be `{empty: true}`. It plays the clip's `bg`:
  - `'loop'` plays the loop's own slice for that step's position (`s + idx mod n`), as a plain-loop step: continuous, no slice fades.
  - `'silence'` is silent.
- An empty step that is switched off is silent.
- An effect applied to an empty step (FX only, Combine) makes it heard.
- New and blank clips are all empty.
- Trash on a step empties it: hold Trash and tap the step, or hold the step and tap Trash. Tapping a step still toggles on/off.

**Recording writes only touched steps.**
- Untouched steps are left as they are (empty, in a new recording).
- Silence, play order and randomness are no longer baked in by recording; Print does that.
- A touched step is written as on, even if random silence hid it at the time.
- FX only on an empty step turns it into its background slice plus the effects.
- A new recording takes the plain loop's strip settings and seed, so the new clip keeps sounding the way it did while recording.

**Undo / redo** (two buttons in the loop row).
- Every edit gesture snapshots the clips, the song and the loop's settings first: one undo per gesture.
  - Trash tap; each Trash-step tap; step on/off; assigning a cell to a step; a randomizer gesture; a whole recording take
  - Print; a pinned strip drag or double-tap reset; Clip-sheet changes; song edits; adding a row; grid/bar-length changes
- Live touches are not undoable.
- Undo/redo is disabled while recording.
- After undo or redo, the engine gets `clipEdit` for the playing or queued clip, or `launch null` if that clip no longer exists.

**Export.**
- Clips render one full variation cycle with their stored settings, after a pre-roll of the same cycle, so they loop seamlessly. Delay echoes wrap into the start.
- Song export can add 2 silent bars for echoes to ring out.
- New: **What you just heard** exports the last 2, 4 or 8 whole bars from the engine's output ring, live touches included.
- New: 32-bit float WAV option.
- No multiple takes: render again for another.

**Delay** (new effect row, hue 130).
- A send: the cell sets the send amount for that step.
- Settings sheet controls:
  - Time: 1/16, 1/8, 3/16 (default), 1/4, 3/8, 1/2, tempo-synced
  - Feedback: default 55 %
- DSP:
  - stereo ping-pong with a one-pole low-pass in the feedback path
  - send smoothed (×0.004 per sample), time glides (×0.0005)
  - placed after the gate and DC patch, so echoes ring on through silent steps
- Line length 2¹⁷ samples, preallocated.
- Cleared on play and reset.

**Level.**
- Unity gain: track 1, master 1; imports are not normalised.
- The soft clipper is replaced by a look-ahead limiter (§5.6).
- Freeze is level-matched to the dry slice: grain sum ×0.38, was ×0.28, about 3 dB quieter than dry.

**Tests and scenarios.**
- `engine.test.js` has 28 cases. New ones cover: empty steps and backgrounds, recording only touched steps, variation length 1/2/never, delay tail, unity gain, limiter ceiling, grab.
- New scenario `05-variation-delay`.

**Resampling** (discussed, not built). The case for a one-button "resample this clip into a new loop":
- it extends pitch range
- it will matter for time-stretching once that exists
- re-slicing a sequenced result gives a new slice grid ("chop the chop"), which stacked effects can't do

Repeating most effects adds little, so it's parked as an open question (§14).

---

## 21. Changes in version 18 (and the planned next steps)

> **Partly replaced in v19 (§22):** automatic capture and the Takes list (§21.1) are gone; Record and a deliberate Capture button are back, and saved sequences live on the Clips page. ORDER/SKIP patterns (§21.2) stay, flipped on screen.

Agreed with Andrew after v17. Two big shifts: **capture replaces recording**, and **ORDER and SKIP are fixed patterns** with no randomness. Together they remove seeds, variation length, the Clip sheet and Print: what you hear is what is kept and what exports.

### 21.1 Capture and the Takes list

**Engine.**
- At every bar line while playing, the track hands over the bar that just ended as a sequence: `bar {tr, bn, cid, touched, cols, n, slots}`.
- `slots` are the steps exactly as heard:
  - ORDER, SKIP/GAP and any random-slice pick are written in (`a` is the slice actually played; Random is removed from the effects)
  - an off step is `on: false`
  - smooth-mode automation is included
- `touched` is true when any step in the bar was played by a finger.
- `cid` is the sequence (or take) that was playing.
- A partial bar (play began mid-bar, or the grid changed) is not handed over.
- The JS builds these objects on the audio thread. Natively, write each bar into a preallocated ring of bars and let the UI thread copy it out.

**Which bars become takes (UI).** A bar is kept as a new take unless:
- it equals the plain loop (forward, nothing skipped, no effects); or
- it is untouched and equals a take already kept (looping a take, or Play all, adds nothing).

The same bar again straight after (contiguous bar numbers) is a **repeat** of the last take: `×2`, `×3`… Only touched bars add repeats, so a sequence left looping doesn't run the count up. The count can also be set by hand (− / +, 1–64).

**Takes view** (the list button in the header, row 1 column 7, with a count badge that pulses on each new take). One scrolling column, oldest at the top, new takes appended and auto-scrolled. Each row has:
- a **drag handle**: drag up or down to move the take
- a **thumbnail** with the take's number: tap it to loop the take on the main page
- the **repeats** control
- a **select** toggle (for export)
- **delete**

The header has **Play all** / **Stop** (every take in order with its repeats, through the engine's song player; rows update live), a "*n* selected ×" chip, and **Clear** (tap twice).

**The main page's sequence** (`seq`, or none for the plain loop):
- Looping a take puts a **copy** on the main page, so takes never change. The lane label shows `T12`, and `T12*` once it's edited. Play over it, and what you play becomes new takes. This is how you layer.
- **◀ Take** (loop row) loops the newest take; each further tap loops the one before. An edited copy reloads first.
- Touching a lane step on the plain loop starts a blank sequence of empty steps. Tap toggles a step on/off; hold a step and tap a cell to assign it.
- **Trash** tap clears the sequence (back to the plain loop). Hold Trash and tap steps (or the reverse) to empty them. **Empty steps always play the loop's own slice**; the "silence" background is gone.
- **Play all** clears the main page's sequence (undoable).

**Undo/redo:**
- Snapshots cover the sequence, the plain loop's strips and the takes list (order, repeats, deletions).
- Capture is never undone: takes captured after a snapshot survive undoing it.
- Undo works while playing.

**Export** (share icon):
- Takes, **in order** with repeats: one file, with an optional 2-bar tail for echoes.
- Takes, **each** as a seamless one-bar loop.
- Both use only the selected takes when any are selected.
- **The main page's sequence** (or the loop as set), one seamless bar.
- **What you just heard** and **32-bit float**, as in v17.

**Grid or bar-length changes** clear the sequence and the takes, after asking.

### 21.2 ORDER and SKIP (GAP)

Both strips are fully static. Every slider position is one fixed pattern, and nothing is re-rolled at playback.

**Patterns (engine).**
- **The default zone.** `orderPattern(v, n)` and `skipPattern(v, n)` return `null` for `v ≥ DEAD` (0.96): forward order, nothing skipped. This is the small zone at the far right.
- **Position to pattern.** Below `DEAD`, the position maps to an index `i = floor((DEAD − v)/DEAD · PATN)` with `PATN = 2048`, and amount `L = (i+1)/PATN`. A generator seeded from `i` makes the pattern, so each index is always the same pattern.
- **ORDER** (`perm[position] = step played`) starts from forward order and applies `1 + floor(L²·n·1.5)` operations. Each operation reaches up to `max(1, round(L·(n−1)))` steps away and is one of:
  - repeat a slice: probability `0.15 + 0.35·L`
  - swap two steps: up to 0.85 cumulatively
  - play a run backwards: the rest
  - The result is never forward order.
- **SKIP** (`bits[step] = 1 plays`) silences `max(1, round(1 + L·(0.75·n − 1)))` steps.
  - The steps are chosen by weight: off-beats first near the default, the downbeat almost never, until `L` grows.
- Patterns are 16 steps on the 1/16 grid (8 on 1/8).
- About 1,700 of the 2,048 positions give a different pattern on each slider. Positions next to the default zone repeat a little, since one change can only land in a few places.

**Engine playback.**
- A position counter walks the sequence (`cpos`) or the loop (`lp`), and `mapPos` sends it through `perm`.
- Positions don't reset at the bar line.
  - With SKIP they stay aligned with the bar anyway.
  - With **GAP** (SKIP set to insert rests: the sequence waits), a skipped step holds the sequence back. It plays through every step and drifts against the bar, deterministically.
- Touched slices take turns in the order they were pressed; ORDER doesn't apply to them.

**Strip interface.**
- Each strip is labelled **ORDER** or **SKIP**. SKIP reads **GAP** when Preferences sets it to insert.
- Each strip has:
  - a gradient showing that change grows to the left
  - the default zone at the right
  - the pattern number on the right (`#614`), or FORWARD / NONE
- **Fine control:** while dragging, move the finger above or below the strip and the value slows down, to a tenth at about 200 pt away, so every pattern can be reached. The label shows `FINE · #n`.
- **Pins and resets.**
  - Pins work as in v17 (ORDER pinned, SKIP unpinned by default).
  - **Unpinning SKIP puts its stored value back to the default.**
  - Double-tap still resets.
- The lane dims the steps SKIP will silence. As GAP the sequence shifts instead, so nothing dims.

### 21.3 Touches, timing and the randomizer

- **Touches play through SKIP and GAP** by default (`pref.touchWin`). A Preferences switch applies the pattern to touched steps too.
- **Late touches:**
  - A touch, or a release, that lands up to `grace + lat` ms after a step starts counts for that step. The step is decided again from its snapshot.
  - The slice keeps its place in time (it continues from where it is, it doesn't restart). Slice playback stays quantised.
  - `lat` is the output latency the device reports, plus 43 ms on the backup ScriptProcessor engine. Without it, the 40 ms window was mostly used up before the touch arrived.
  - Natively, use the touch timestamp against the render clock instead of a fixed window if you can.
- **The randomizer follows the play mode:**
  - **Replace:** a rolled step ends with at most one effect; an added effect replaces what was there.
  - **Combine:** effects stack.
  - **FX ONLY:** slices never move.

### 21.4 Interface details

- **Header row 1:** gear, tempo, swing, export, Takes, play.
- **Header row 2:** stepped, die slider (four columns), REPLACE/COMBINE, FX ONLY, trash. REPLACE/COMBINE is now all caps and one column, the same size as FX ONLY.
- The die shows just five larger pips; the button is the die's edge.
- **Lane steps:**
  - more than four stacked effects show a small "+" after the three dots
  - the lane label reads LIVE, SEQ, or `T12` / `T12*`
- **Loop row:** loop picker, undo, redo, ◀ Take, fold. The Clip button is gone.
- **Removed:**
  - the record button
  - clips and song columns
  - the Clip sheet, seeds, variation length and Print
  - the "silence" background
  - the random half of the silence strip
- **Fixed:** a v17 slip had commented out the line that names an imported file in the loop picker.

### 21.5 One self-contained class (web)

`build.py` now emits a page whose only global is `class Slicefield`.
- **Static members:** `engineFactory`, `synthFactory`, `markup` (CSS + HTML) and `ui` (the interface code).
- **Constructor:** `new Slicefield(element)` attaches a shadow root and builds a complete, independent instrument in it.
- **Shadow root:** element ids, CSS and the backup engine's ScriptProcessor reference are all per instance. Font loading stays in the host page, because `@font-face` doesn't work inside shadow roots in every browser.
- **Tests:** the headless test checks that the page adds nothing to `window`.
- **Native counterpart:** this is the §18 rule — no globals, no singletons, everything in an instance.

### 21.6 Tests and scenarios

- `engine.test.js` has 33 cases. Recording tests became capture tests. New cases cover:
  - ORDER/SKIP repeat exactly and follow their patterns
  - the default zone
  - more than 1,000 patterns per slider
  - GAP plays through
  - touches over SKIP
  - the late-touch window with and without latency
  - a late release taking an effect off
- Scenario `04-capture-fxonly` replaces `04-record-fxonly`, and `05-patterns-delay` replaces `05-variation-delay`.
- Scenarios can give ORDER/SKIP as a slider position, `{"type":"order","v":0.4}`, and the renderer turns it into the pattern.

### 21.7 Planned: fields, signal order and overlapping cells (built in v22, see §25.3)

Andrew's direction: cell layouts become **fields**, presets you can switch on the fly (and generate at random); row order sets signal order; and resizing cells lets them overlap to make combinations.

- **What steps store.** With fields and overlap, a raw touch position no longer means anything on its own: the same spot can drive two or three effects, each over part of its range. Steps should store the **resolved effect chain**: each effect's id and parameter values, in signal order.
  - Then a sequence and its takes play the same in any field, so loading a field never has to clear anything.
  - The cost: changing an effect's settings no longer re-maps steps already played (today a scale change re-maps them).
  - Andrew's alternative is that loading a field keeps the sample but clears the sequence. It's simpler, but it would also strand the takes.
  - **Recommendation:** store resolved values; takes are meant to outlive the field they were made in.
- **Signal order:**
  - the playback stage (slice choice, stutter, reverse, random, freeze, pitch) composes in one fixed way
  - the processing stage (crush, filter, delay, later reverb) runs top to bottom in field order
  - natively, an index array per step
- **Overlap:**
  - cells are rectangles on a coarse snap grid (about 12 × 16)
  - a touch inside several cells drives each by its position within that cell
  - resizing and moving need an edit mode, so they never fight with playing
- **Switching fields mid-performance:**
  - held touches keep their effect until released
  - a picker in the header, not a swipe, which would clash with multi-touch
- **Random fields** need rules:
  - minimum cell size
  - always some plain slice cells
  - a cap on overlaps

### 21.8 Planned: the shooting game (first pass built in v22, see §25.4)

An optional layer over the grid. Hitting an enemy touches the cell under it. (Since v19 there is no capture of every bar: a round should run with Record on, or capture at the end of each round, so it leaves clips; to be decided.) Agreed so far:
- **Drones: tap.** Quick hits.
- **Armoured: hold for 1–4 beats.** They regenerate if you let go early.
- **Serpents: hold and follow.**
  - paths generated at random, never longer than a bar
  - the finger slides through cells and their value ranges
- **Linked groups: hold two or three at once.**
- **Mines:** touching one costs you. This stops mashing.
- **Spawning on the beat** is for feel, not scored. Touches are quantised anyway.
- **Difficulty = tempo.**

**Proposed scoring** (for Andrew):
- **Points per enemy:**
  - drone 10
  - armoured 25 per beat held
  - serpent 5 per step tracked, plus a 50 bonus for staying on to the end without lifting
  - linked group: the sum of its members × the number of fingers
- **Streak multiplier** ×1 → ×4: it climbs with consecutive kills and drops to ×1 on a mine or an enemy that escapes off the grid.
- **Variety bonus** (+10 % per different effect row hit in a bar, up to +50 %). It rewards what makes good loops without rewarding timing.
- **Rounds** of 32 bars rather than lives, so each round gives a predictable batch of takes. The next round is +8 BPM.

The game should drive the engine through the same touch messages as fingers (`touches`), so it is just another host of the engine (§18).

---

## 22. Changes in version 19

Agreed with Andrew after v18. Capturing every bar made the list huge and confusing, and starting each bar fresh ruled out Combine. v19 goes back to one sequence that stays loaded, with **Record** to write into it and a deliberate **Capture** to save it.

### 22.1 Record (overdub in place)

- **Record off:** touches are only heard; the sequence never changes. This is jamming.
- **Record on:** each step you touch is written into the sequence in place, as soon as that step ends (`clipStep`). Untouched steps are left alone.
  - What is written follows §8.2: FX only off, the step becomes what was heard (slice, on/off, effects; Replace or Combine decide what was heard). FX only on, the step keeps its slice and on/off and takes the effects heard (an empty step becomes its loop slice).
  - Smooth mode records automation (§8.3).
  - A late touch or release (the grace window) re-decides the step: the engine puts back the step it overwrote first, then writes again if the step is still touched.
- **Starting on the plain loop:** a sequence of empty steps is made and switched in at once (`launch … now`), so recording starts on the next step and the loop carries on in place.
- **Trash while recording** leaves an empty sequence, so recording carries on.
- Record can be armed while stopped; it records once playback starts. It stays on across Stop.
- **Undo:** each bar that writes steps is one undo step (the app checkpoints on the first `clipStep` of each bar).
- The lane label reads **REC** (red) under the sequence's name while recording, and the playing step is outlined red.
- Engine: `rec {tr, on, id}` sets `Track.rec`; `decide()` writes into `clip.slots[cIdx]` and keeps `recW` (the slot it replaced) until `finalize()` emits `clipStep`. In the native engine the write must go to an engine-owned copy of the sequence (the UI applies `clipStep` to its own model). The web backup engine is given its own copies of sequences for the same reason.

### 22.2 Capture and the Clips page

- **Capture** (the frame-with-plus button, far right of the tools row) saves the sequencer's sequence as it is at that moment to the end of the Clips list, with its stored ORDER and SKIP. On the plain loop it saves the loop as set. The new clip becomes the selection, the Clips button's count flashes, and the lane now names the sequence **C<n>** (with a `*` once it changes again). Capture is undoable and is disabled on the Clips page.
- Clips never change once saved. A clip is `{id, num, cols, n, slots, orderV, muteV}`; it is turned into engine form (`ord`, `mute`) when played or exported.
- **The Clips page** (the list button in the header; "Takes" is renamed "Clips"):
  - Each row: a drag handle (reorder) and the clip's thumbnail, labelled C<n>. No repeats, checkboxes, ×, Play all or Clear.
  - **Tap a clip:** select it and play the list from it (at the next bar line if something is playing; it starts playback if stopped). The selection follows playback.
  - **Play** (header) plays from the selected clip. Without **LOOP**, the list plays to its end and stops (`song … once`). With **LOOP** on (yellow), the selected clip repeats; tapping another clip loops that one.
  - **DELETE DUPLICATES** keeps the first of any identical clips (same steps, effects, ORDER and SKIP) and deletes the rest. The button says how many went.
  - **LOAD TO SEQUENCER** copies the selected clip into the sequencer and opens the field page. This is the only way a clip gets onto the field: going back with the list button leaves the field as it was, and the field's own sequence plays again (from the next bar line if the list was playing). If the list was playing when you load, the loaded clip carries on playing.
  - **Trash** works as elsewhere: hold it and tap clips, or hold clips and tap it, to delete them. A tap on its own asks before deleting every clip.
  - Editing the list while it plays (delete, reorder, dedupe, undo) keeps the clip that is playing, and the list carries on from there (`songRows … idx`).
- There is always a selection while clips exist: the last capture, or the last clip selected; deleting it moves the selection to the next clip (or the one before).
- **Export:** "All clips in order, one file", "All individual clips" (one seamless bar each, zipped), "Selected clip only", plus the sequencer's sequence, "what you just heard" and the format.

### 22.3 Layout

- **Row 1:** gear · BPM · swing · export · Clips (count) · Record · Play (two columns). BPM and swing are one column each, value over a small label.
- **Row 2 (the loop bar):** loop picker · undo · redo · fold. It shows on both pages and never folds, so undo and redo never move.
- **Row 3 (tools):** trash (under the gear) · then, on the field page, stepped · die (three columns) · REPLACE/COMBINE · FX ONLY; on the Clips page, LOOP (two columns) · DELETE DUPLICATES (two) · LOAD TO SEQUENCER (two) · then Capture at the far right.
- **Sequencer lane** below the tools: one bar in **two rows of 8** steps (other lengths split evenly across two rows; 8 steps or fewer use one row), 26 pt per row. Steps and the label column work as before.
- **Fold** hides the lane and the ORDER/SKIP strips only.
- **Launching never starts playback**, so the trash, lane edits and the die no longer start the transport when stopped.

### 22.4 ORDER and SKIP, flipped

- The default zone and the pin are now at the **left**; the pattern number grows to the **right**. The engine is unchanged: a strip position `p` (0 at the left edge of the strip, just right of the pin) is the value `v = 1 − p` passed to `orderPattern` / `skipPattern`.
- **Unpinning either strip resets its stored pattern to the default** (it used to only reset SKIP; unpinning ORDER kept the last pinned position, so an unpinned ORDER sprang back there instead of to FORWARD).

### 22.5 FX ONLY field

With FX ONLY on, the effect rows have **no column divisions**: each row is one strip, and a touch anywhere in it plays that row's effect on whatever the sequence (or loop) plays. The loop row hides its step numbers and per-slice backgrounds (the waveform and playhead stay). Holding a step and tapping a row in FX ONLY keeps the step's slice and gives it the effect.

### 22.6 Tests and scenarios

- `engine.test.js` has 38 cases. The capture tests became recording tests (touched steps written once, untouched left alone, automation, nothing written with Record off, FX only vs not). New cases: launching never starts playback, a `now` launch picks up the loop's place, and the list plays to its end once and stops. ORDER/SKIP/GAP tests read the lane history instead of capture events.
- Scenario `04-record-fxonly` replaces `04-capture-fxonly`: it adds a recording pass from bar 4½ to bar 8 (32 `clipStep` events).

### 22.7 Not decided yet

- Combine while recording without FX only writes what was heard, which (as approved for §5.3) drops the step's own effects when a touched slice plays. If "combine with the sequence" should keep the step's effects too, that is a change to §5.3 and needs Andrew's sign-off.
- Clips are not persisted between launches (§14).

---

## 23. Changes in version 20

Agreed with Andrew after v19.

### 23.1 Combine layers onto the sequence

With Combine on and FX ONLY off, a touched step now plays the touched slice **with the step's own effects**, and every held effect stacks on top (the same effect held = the touch's value replaces the step's). Before, the touched slice dropped the step's effects. Because recording writes what is heard, recording in Combine now updates the slice and layers the new effects onto the old ones. Replace and FX ONLY are unchanged. In `decide()`: the touch base takes `slot.fx` when Combine is on and the step isn't empty.

### 23.2 Clips keep their loop and SKIP/GAP mode

- A clip is now `{id, num, cols, n, slots, orderV, muteV, silPat, loop}`. `loop` is the loop it was captured on: a demo loop's name or `f:<id>` for imported audio. Imported files are kept by id (`files`), so several can be in use.
- **SKIP or GAP belongs to the sequence** (or the plain loop), like ORDER and SKIP's pattern. The Preferences radio changes the current sequence's (or loop's) mode and is undoable. The engine uses `clip.silPat` when the playing sequence has one, else `pref.silPat` (the plain loop's).
- The Clips list plays each clip on its own loop: the app sends the loop once (`loopBuf {key, L, R}`) and the clip names it. `Track.setClip()` swaps the loop with the clip, at the same bar line; a sequence without `loop` plays the track's own (`base`, from `load`). Native: keep a small table of loaded loops on the engine side, filled from the UI thread.
- **Load to Sequencer** also switches the loop picker to the clip's loop. Undo puts the loop back.
- A clip whose loop differs from the current one shows the loop's name on its row.

### 23.3 Exporting GAP

GAP shifts the sequence against the bar, so the output repeats exactly only after **L / gcd(p, L)** bars, where L is the sequence length and p the steps played per bar (16 − gaps). The Export sheet has a choice for sequences set to GAP: **One bar**, or **The full cycle** (up to 16 bars at 16 steps). It applies to individual, selected and in-order clip exports and to the sequencer's sequence. Each render is pre-rolled by the same length so it loops seamlessly. The sheet lists the GAP clips and their cycle lengths.

### 23.4 Reverb, and Tails for Delay and Reverb

- **Reverb** is a new effect row (hue 214), a send like Delay: `send` on the cell; `size` = RT60 0.3…9 s (`0.3·30^v`); `tone` = damping (one-pole low-pass in each line, coefficient 0.12 + 0.85·tone).
  - DSP: two input allpasses (142 and 379 samples at 48 kHz, g = 0.6), then four delay lines (1427, 1693, 1949, 2203 samples at 48 kHz, scaled to the rate) mixed by a 4×4 Hadamard matrix (×0.5) with per-line gain `10^(−3·len/(RT60·sr))`. Left out = lines 1 + 3, right = 2 + 4, × 0.45. Buffers are preallocated per track.
- **Tails** (option on both Delay and Reverb): **Always ring out** (default, as before) or **Cut at the next step without** the effect. Cutting fades the wet output to zero in a few ms (×0.005 per sample) and stops the feedback, so the lines empty and nothing old comes back the next time the effect plays.

### 23.5 Loudness

- **Crush** is compensated: its aliasing moves energy into the range the ear is most sensitive to, so it sounded louder even though RMS was unchanged. The engine compares Crush's input and output A-weighted (an IEC 61672 A-weighting filter as three biquads, 80 ms envelopes) and turns the output down to match, never up (floor ×0.3). Measured A-weighted change at the lowest rate is now within about ±1 dB on every demo loop (it was up to +5.7 dB on Dub stabs).
- **Acid bass** is 6.5 dB and **Synth lead** 4 dB quieter (`TRIM` in `synth.js`); acid's RMS was 7 dB above the others.

### 23.6 Sequencer, header and Clips page

- **Lane:** steps are 36 pt tall (two rows of 8). A **rotate column** at the right: the upper arrow moves the whole sequence one step left, the lower one step right, wrapping. Empty steps are first fixed to the loop slice they play, so rotating the plain loop works and makes a sequence. Each rotate is one undo step.
- The lane label shows the clip's **plain number inside the Capture icon's corner ticks** (with `*` once changed); SEQ or LIVE otherwise. Clip rows show plain numbers too.
- **Touching a lane step while stopped starts playback** (trash, die and rotate still don't).
- **Fold is gone.**
- **Swing** reads 50 (straight) to 75 (the swung step three quarters of the way to the next): value = 50 + 50·s, the engine's `s` unchanged (0…0.5).
- **Header:** gear · BPM · swing · export · project · Record · Play. The **Clips button** moved to the right end of the loop bar, directly above Capture; the loop bar's last three columns line up with the header's.
- The Clips count (and Capture) **flash only after a capture** (the class is cleared on `animationend`; it used to replay whenever the button was redrawn).
- **Clips page:** a **Duplicate** button (two overlapping pages) copies the selected clip right after it, with the next number, and selects it. **Delete Duplicates** moved into the trash: a tap on the trash alone opens a sheet with "Delete duplicates (n)" and "Delete all".
- **Dragging a clip** shows a line in the gap where it will land, instead of outlining a row.
- **Thumbnails** split each step's mark into one colour per effect (up to four).
- **The die** does more at the right: an effect is added (Combine) or swapped in (Replace) with chance a/2 + a³/2, so every step gets one at the far right; in Combine a second effect stacks with chance 0.7·a³; a slice moves with chance a + a³. The extra random numbers are drawn after the old ones, so dragging further still only adds change.

### 23.7 Projects

The **project** button (folder) opens a sheet: **Save project**, **Open project…**, **New project** (tap twice). A project is one JSON file holding tempo, swing, stepped, Replace/Combine, FX ONLY, preferences, pins, the loop (imported audio as base64 float32), grid, effect settings and row order, the plain loop's strips, the sequence, and every clip with the selection and LOOP. Undo history isn't saved. Inside claude.ai the page can only hand over zips, so the file is saved as a (stored) zip with the JSON inside; Open reads either. Effects added after a project was saved get their defaults and a row.

### 23.8 Tests and scenarios

- `engine.test.js` has 48 cases. New ones:
  - Combine layering, live and recorded
  - delay and reverb tails, ring and cut
  - a sequence's own GAP mode
  - a sequence naming another loop, and the track's own coming back
  - Crush loudness within 1.5 dB (A-weighted)
  - GAP repeating after exactly its cycle and not sooner
- Scenario `06-reverb-tails-combine` covers a clip on another loop with reverb and crush steps, recording in Combine (each written step keeps its effect and gains the held one), and both tails switched to cut. The renderer gained two shorthands: `{"type":"loopBuf","key","kind"}` and `{"type":"cfgOpt","tr","k","o"}`.

---

## 24. Changes in version 21

Agreed with Andrew after v20. (v22 changed several of these again: see §25.)

### 24.1 Transport and the die
- **Stop turns Record off.**
- **Rolling the die starts playback** when stopped: dragging it, or holding it and tapping steps. Tapping a lane step already did; the trash and rotate still don't.

### 24.2 Reverb levels and tails
- Reverb's **send** is replaced by two levels, **Wet** (the cell parameter: how much of the step goes into the reverb) and **Dry** (the step's own level while it has reverb). Both default to 100%.
- Dry scales only the step itself, before Delay's echoes are added, and doesn't change what Delay is fed.
- Default **Tails**: Reverb **cut** at the next step without reverb, Delay **rings out**.
- Projects saved with the old reverb settings (`send`) get the new defaults for that effect when opened.

### 24.3 FX ONLY: trash an effect
With FX ONLY on, holding the trash and tapping an effect row takes that effect off **every step** of the sequence (one undo step). A tap on the loop row's middle band (dry) does nothing.

### 24.4 Clips look like the sequencer
- The thumbnails are gone. Each clip row is drawn by the lane's own code: two rows of 8 steps, effect colours, stacked-effect dots, SKIP dimming, and the clip number in corner ticks.
- A clip on a different loop shows that loop's short name under its number.
- The step playing is outlined while the list plays.

### 24.5 Clips page trash
- **Delete Duplicates is gone.**
- A tap on the trash alone deletes **every clip at once**, with no question asked; Undo brings them back.
- Hold-and-tap deletes single clips, as before.

### 24.6 Projects page and library
The folder button now opens a **Projects page**, the third page after the field and Clips. Undo, redo and the loop bar stay where they are.

- **Top of the page:** the project's name (edit it in place) and its state: not saved yet / changed / saved.
- **Path bar:** Projects › folder › subfolder; tap any part to go there.
- **The list:** subfolders first (tap to open), then the projects in this folder, newest first. Each shows its date, clip count, loop and tempo, and the open one is outlined.
- **Opening:** tap a project.
- **Moving:** drag a project's handle onto a folder, or onto a folder in the path bar.
- **Tools row:**
  - trash
  - **NEW FOLDER** (named in place, inside the folder being viewed)
  - **SAVE** (a project saved for the first time goes in the folder being viewed)
  - **NEW PROJECT**
- **Deleting:** hold the trash and tap a project or folder (or hold it and tap the trash). It goes at once, with an **Undo** in the message bar for 7 seconds. Deleting a folder deletes everything in it.
- **Saving:**
  - When you press SAVE.
  - Automatically, if the project changed, before another project is opened or a new one is started. A new, untouched project isn't kept.
  - When the page is hidden, for a project that has been saved before.
- **Files:** **Save to file** and **Open file…** remain, for copies outside the app. A project opened from a file isn't in the library until it's saved.
- **Storage:**
  - Inside claude.ai the library is in the artifact's database (`db` + `user` capabilities), in each viewer's private space `data/users/<id>/`, which is private even from the artifact's owner.
  - Records:
    - `p_<id>` is the project's meta: `kind:'project'`, name, folder, updated, clips, loop, bpm, chunks.
    - `p_<id>_<n>` holds the state as JSON in chunks under 200 kB (documents are capped at 256 KiB, and imported audio makes projects megabytes).
    - `folders` is the folder list, so empty folders survive.
  - Elsewhere the same records go into IndexedDB.
  - Native: a folder of project files in the app's Documents directory (visible in the Files app) is the natural equivalent; keep the same meta fields for the list.

### 24.7 Tests
`engine.test.js` has 50 cases; new ones cover reverb's default tails and dry/wet levels. Scenario 06 now drives reverb's wet level from the cell (its default tails are cut).

---

## 25. Changes in version 22: fields, the game, and a leaner Clips page

Agreed with Andrew after v21. The native app is on hold until the game is further along.

### 25.1 Header: three rows, the third only on the field
Rows 1 and 2 are the same on both pages; row 3 (and the lane) are only on the field, so on the Clips page that row is gone entirely.

| Row | Columns 1 … 8 |
|---|---|
| 1 | gear · BPM · swing · export · projects (folder) · undo · redo · Clips |
| 2 | trash · **[field page]** loop picker (3) · Fields · Game **/ [Clips page]** LOAD TO SEQUENCER (5) · Play (2) |
| 3 (field only) | stepped/smooth · die (3) · REPLACE/COMBINE · FX ONLY · Record · Capture |

- Row 2's middle is "what is on the field": the loop, the field and the game there, and on the Clips page the one way to put a clip on the field.
- Record sits under Play; Capture under the Clips button's column.
- **Colours:** REPLACE is orange (the accent), COMBINE blue; stepped is orange, smooth blue. Both are always lit in one of the two.

### 25.2 Clips page: a jamming page
- No title, count or hint, no LOOP and no Duplicate (any edit ends in a new capture anyway).
- **There is always one clip selected** while any exist. **Tap a clip:** it is selected and **loops** (from the next bar line if something is playing; it starts playback if stopped) until another is tapped or Stop is pressed. Play plays the selected clip. The list never plays through by itself any more (export still renders it in order).
- **Trash:** a tap deletes the **selected** clip (the selection moves to the next one, which takes over if the deleted one was playing). Hold the trash and tap clips, or hold clips and tap it, to delete several. There's no "delete all".
- **LOAD TO SEQUENCER** also puts back the clip's field (§25.3).

### 25.3 Fields
**Superseded by §26.1:** fields are now rows of 1–4 effects (no partial overlaps), kept in a library shared by every project, and the loop row is gone (the waveform is in the ruler, the filter is an ordinary row).

A **field** is a layout of effect cells plus the effects' settings: `{id, name, cells:[{k, y, h}], cfg}`. A project holds a list of fields; the field page shows one.

- **Cells** are full-width bands on a grid **48 units** tall (`FG`). `k` is an effect key, or `center` for the loop row (high-pass above, dry middle, low-pass below). Each effect has at most one cell. Cells may **overlap**.
- **Touches:** a touch drives every cell under the finger, each by its place in its own cell (the same raw mapping as before, §7.1). The touch's `fx` becomes a list. Replace plays all of a touch's effects; Combine stacks them with the other held touches (one value per effect, the latest touch wins); recording and lane assignment write them all.
- **Signal order = top to bottom.** Each step's effect list is sorted by the field's order (cells starting at the same unit keep their order); the engine gets it as `field {order}` and sorts `F` when a step is decided (natively: an index array per field, no allocation). It applies to the per-step chain: Stutter, Reverse, Random, Freeze, Pitch, Decay, Crush and Filter. Delay and Reverb are sends whose tails outlive the step, so they always come last. Effects a field doesn't hold (in an old step) go after, as they were.
- **Each clip keeps the field it was captured on** (a copy). In engine form a clip carries `cfg` (its settings) and `rank` (its order); the engine uses them while that sequence plays (`cfgOf(k)`, `rankE`) and the track's own otherwise. So editing a field's settings no longer changes clips already captured, only the sequence on the field. (Before v22 settings were per project and re-mapped every clip.)
- **Loading a field keeps the loop and clears the sequence** at once (to a blank one with the same ORDER, SKIP and SKIP/GAP mode). Undo brings both back. Load to Sequencer restores the clip's field: the project's field with that id if it's unchanged, otherwise a copy named "<field> · clip n" is added.
- **The Fields sheet** (row 2):
  - the current field's name (rename in place), **Edit layout**, **Duplicate**;
  - the project's fields (a small picture of each, its cells in order); tap to load; a trash per row (not for the one on the field);
  - **Random field**, and **New from a preset** (All effects, the v21 layout; Dub; Glitch; Pitch play).
- **Random fields:** the loop row (at least 12 units, so its dry middle is easy to find) plus 3–6 other effects, each at least 3 units (5 for Pitch and Freeze), the whole height covered, then one or two overlaps made by growing a cell into its lower neighbour, never more than two cells deep.
- **Field editor** (Edit layout): each cell is a block at its true height; overlapping cells are shown side by side so each can be grabbed. Drag a block to move it, its top or bottom edge (the grips) to resize it (minimum 2 units), × to remove it, tap it for its settings. The bar at the bottom has **+ Add…** (an effect not in the field: it takes the largest free space, or the lower half of the tallest cell), **Even out** (stack everything, no gaps or overlaps, sizes kept in proportion) and **Done**. Each drag is one undo step; the engine follows every change at once.
- **On the field**, overlapping cells are drawn see-through with a dashed outline, the overlap is striped in both colours and labelled ("DELAY + REVERB"), and the handle column is split into one lane per overlapping cell. A tap on a handle opens that effect's settings; dragging a handle moves its cell (with anything overlapping it) to another place in the order, and the field is re-stacked.
- Effect **settings** edits are now undoable (the first change in the sheet is one undo step).
- **Preferences → Effects shown** is gone: a field decides which effects are there. FX ONLY + trash + tap removes every effect under the finger from the sequence.
- **Projects:** a project now stores `fields` and `field` (the one on the field); each clip stores its `field`. A project from before v22 becomes one field built from its row order, the effects it showed and its settings, and its clips get a copy of it.

### 25.4 The game (first pass, no scoring)
**Superseded by §26.5** (targets are now gestures: holds and slow drags, alone or three at once).

**Game** (crosshair, row 2) starts a round; tapping it again stops the round. Stop does too.

- **Round:** a one-bar count-in (the rest of the current bar if more than half of it is left, else the next one; bar 0 if playback was stopped), then **16 bars**. Record is on for the whole round, and at the end of each round bar the sequence is **captured as a clip**, so a round always leaves 16 clips (bar n's clip is the sequence as it stood at the end of bar n, so what you heard in that bar). Capture happens when the engine's `barN` passes the bar, by which time its last step's `clipStep` has arrived. Capture, Record and Fields are disabled during a round.
- **Targets** appear over the field on the beat (with a short fade-in), at a slice column and a height inside one of the field's cells, so hitting them plays that cell. Touches work as always: they're heard and recorded whether or not they hit anything.
  - **Drone:** tap it within about a beat.
  - **Armoured** (hexagon, a number): hold it for that many beats (1–4); letting go resets it.
  - **Serpent:** its path (up to five turns across neighbouring columns) is shown; hold its head and follow it for 2–4 beats. It dies if you stayed on it for at least 60% of its run.
  - **Linked** (2 or 3 nodes joined by lines): hold all the nodes at once for half a beat.
  - **Mine** (red, spiked): a finger that touches one is **silenced** until it lifts (shown with a red ring). Mines never appear under a finger.
- **Ramp:** bars 1–4 drones only (2 per bar, rising to 4); armoured from bar 5; serpents and linked groups from bar 9; mines from bar 13; off-beat drones from bar 7. Difficulty otherwise = tempo.
- **Display:** the round's state replaces the ORDER and SKIP strips (which rest during a round): GET READY with a beat count, then BAR n / 16, the clips so far and hits. At the end: "16 clips saved", hits and how many got away (counted, not scored).
- The game reads touches only and drives the engine like any fingers (§18). Code: `startGame`, `gameTick` (spawning, hit tests, captures, once per frame), `drawGame`, in `ui.js`.

### 25.5 Projects is a sheet again
- The folder button opens a **large sheet** (like Export, but taller); the icon stays a folder.
- **Naming a new project saves it** (in the folder being viewed). **NEW PROJECT** starts one and puts the cursor in the name. SAVE keeps later changes; the automatic saves of §24.6 remain.
- **Selection:** tap a project or folder to select it (white outline; its line says "Tap again to open"), tap it again to open it.
- **The sheet's own trash** (left of NEW FOLDER): a tap deletes the selected item; hold it and tap rows, or hold rows and tap it, to delete several. A deleted row **turns red at once** and goes a moment later; the library is updated in the background, and **Undo** in the message bar brings it back.

### 25.6 Sound
- **Filter resonance is level-matched** like Crush: the filter's input and output are compared A-weighted (80 ms) and the output is only ever turned down, so a plain cut is never made up for. Measured on the demo loops the resonant peak raised the A-weighted level by up to +1.6 dB (Electric piano, Acid bass); now at most +0.1 dB.
- **Crush fix:** with near-silent input the compensation could divide by almost nothing and push its gain to infinity (a NaN on the output, caught by the new scenario 07). Both Crush and Filter now leave the gain alone unless the output is louder than the input by a measurable amount.
- **Imported audio is time-stretched** to the bar by default (Preferences → Your own audio: **Stretch**, keeps its pitch, or **Resample**, as before). WSOLA in `synth.js` (`stretch2`): 40 ms Hann grains every 20 ms, each read from near where the speed puts it, nudged by up to 10 ms to the place that best continues the grain before (cross-correlation of the mono sum, every 2nd lag and 4th sample); both channels use the same grains; reading and writing wrap round so the bar loops seamlessly. It runs once per tempo and is cached. Projects from before v22 keep resampling. Native: do the same offline (or use a library), never on the audio thread.

### 25.7 Always a sequence
- The field starts on a **blank sequence** (every step empty: the loop's slices in order, no effects), which sounds exactly like the plain loop did. There's no separate "live" view; the lane label always says **SEQ** (or the clip's number in its corner ticks), never LIVE or REC. Recording still outlines the playing step in red.
- **Trash** clears the sequence to a blank one with the same ORDER, SKIP and SKIP/GAP mode (at the next bar line; at once while recording). It's disabled while the sequence is already blank.

### 25.8 Tests and scenarios
- `engine.test.js` has 56 cases. New ones:
  - filter resonance level-matching (within 0.5 dB, Electric piano)
  - a touch over two overlapping cells plays both effects
  - …in the field's order, and changing the order changes the sound
  - a clip plays with its own field's settings, then the track's
  - time-stretch keeps pitch at the new length
- Scenario `07-fields-overlap-order`: steps with two effects each played in two signal orders, recording a two-effect touch (Stutter + Pitch), a settings change, and a clip carrying its own `rank`. The parity renderer needed no new shorthands.


## 26. Changes in version 23: fields as rows, the waveform ruler, the game's second pass

Agreed with Andrew after v22. Partly overlapping cells made the field too busy, so overlap is now always full: a row holds several effects.

### 26.1 Fields are rows
A **field** is `{id, name, rows:[{fx:[k…], h}], cfg}`: a stack of full-width rows whose heights (`h`, in units of the 48-unit grid `FG`) add up to 48.

- **A row holds 1–4 effects** (`MAXFX`). A touch in it drives every one of them, each by the touch's height in the row with its own mapping (§7.1): unipolar effects bottom→top, centred ones (Pitch, Freeze, Filter) from the middle band out. In the Filter's middle band the touch gives no filter (dry), but the row's other effects still play.
- **At most 10 rows** (`MAXROWS`, one per effect); each effect is in at most one row; a row is at least 3 units tall (`MINH`).
- **Signal order:** top to bottom, and inside a row in the order its effects are listed (the order they were added). Delay and Reverb, as sends, still come last (§25.3). `field {order}` is unchanged: the rows' effects flattened.
- **On the field** a row is one solid colour: the **mix of its effects' hues** (their mean direction on the colour wheel; one effect keeps its own). Its title is the effects' names joined with " + " ("STUTTER + CRUSH"), or short names ("STUT+CRUSH") when it doesn't fit. The value at the right shows every effect's value for the latest touch, when it fits. Step ticks (notes, note values) are only drawn on single-effect rows. A row with a centred effect shows the middle band; "NO CHANGE" (or "DRY" for the Filter) is written in it only on a single-effect row at least 56 pt tall. There are no overlap stripes or combined labels.
- **The loop row is gone.** `center` is now plain `filter` (a row like any other); its high-pass/low-pass halves are Filter's centred mapping. Projects and clips saved with `center` are converted.
- **Handles:** a tap opens the row's settings (the first effect's, with a button per effect to switch); dragging moves the row in the order.
- **Presets:** All effects (one row each), **Combos** (Stutter + Crush, Pitch + Delay, Freeze + Reverb, Reverse + Filter), Dub (Delay + Reverb share a row), Glitch (Stutter + Random), Pitch play (Pitch + Delay).
- **Random field:** 4–8 effects (the Filter is one of the choices) in 3–6 rows; the extra effects join random rows of fewer than 3; heights are shared at random, with rows holding Pitch, Freeze or Filter given more.
- **Fields from before v23** (cells): each group of overlapping cells becomes one row holding all of their effects, as tall as the group; gaps go to the rows; a row over 4 effects is split; heights are scaled to add up to 48.

### 26.2 The editor
The editor shows the rows stacked at their true heights.

- Each row has a **chip per effect** (× takes it out; the last effect of a row removes the row and gives its height to a neighbour) and a **+** chip while it has room, which opens a list of the effects not in the field.
- **Drag a row** to move it: it changes places as the finger passes the middle of a neighbour. **Drag the line between two rows** to share their height (each keeps at least 3 units). **Tap a row** for its settings.
- The bar: **+ Row…** (an effect not in the field; the new row goes at the bottom with half the tallest row's height), **Even out** (equal heights), the row count ("5 / 10 rows") and **Done**.

### 26.3 The ruler, and empty steps
- **The waveform has its own strip, the ruler**, 24 pt tall between SKIP and the rows, with the slice numbers and lines and the playhead. The slice playing is drawn bright. It replaces the waveform and slice numbers that were in the loop row, so the waveform is no longer tied to the Filter. It is not touchable.
- **Preferences → Empty steps:** the loop plays through them (as before), or **silent**: only touches, and the steps they wrote, make sound (`pref.fill = false`, saved with the project). In the engine an empty step (and, without a sequence, the plain loop's step) becomes a rest; an effect touched onto an empty step in FX ONLY still makes it heard (§25.7). The lane drops the slice numbers from empty steps while they are silent. Applies to the field, clips and export alike.
- **Pitch is quantised to octaves and fifths by default** (`scale: 'oct5'`: up +7, +12; down −5, −12). Saved settings keep their own scale.

### 26.4 Fields kept apart from projects
- **The fields are a library on the device** (inside claude.ai, the artifact's private database; else IndexedDB), shared by every project: one record `fields` holding `{list, last}`. It is read once at start (a new session starts on the field last used), and written back a moment after any change to the list or a field in it.
- **A project saves a copy of the field it uses** (`field`, the whole field; v23). Opening one adds its field to the library; if the library has a different field with the same id, the project's copy is added as "<name> · <project>". A v22 project's list of fields all join the library.
- Clips still keep their own copy (§25.3). Deleting a field from the library never changes projects or clips. Undo covers the library like before.

### 26.5 The game, second pass (still no scoring)
Targets are now **gestures** that make good loops:

| Gesture | Share | Length |
|---|---|---|
| three touches at once, mostly in different rows | about half (from bar 3) | half a bar to two bars |
| two touches at once | about a sixth | half a bar to two bars |
| one touch, often a vertical drag across its row | about a third | a beat to two bars |

- **Each touch is held or dragged.** A held target is a disc that **swells as it is held until it bursts** at its end. A dragged one is a **marker moving slowly up or down a track** inside its row (chevrons show the way; a single drag crosses the row, three at once travel at least half of it; at six beats or more it may go there and back, marked ↕). Holds and drags can be mixed in one gesture; its touches are joined by a dashed line.
- **Which:** by the row's effects. Stutter, Filter and Crush favour dragging (75%), Reverse, Freeze, Delay and Reverb holding (20% drag), Random, Pitch and Decay either (50%); a row with several effects averages them. Past two beats the chance of a drag rises (halfway to certain), and past a bar it always is a drag.
- **When:** each gesture starts on an eighth, weighted toward the second half of the bar and most of all its end (weights 1, .4, .8, .5, 2, 1.5, 3, 4 for eighths 1–8). The next gesture often starts while one is still held (at most 5 fingers at once). About 12 gestures a round.
- **Seeing them:** a **ring closes on each target** over the beat before it starts (touch as it meets the disc); the **beats left are shown in a pill above the target**, clear of the finger (below it if there's no room, kept on screen). New targets appear **above everything already held or showing**, since a held finger and hand hide what is below; on an empty field they start low.
- **Clearing:** hold or follow a target for at least 60% of its time (from a little before its start) to clear it. The end shows "16 clips saved", cleared and missed (counted, not scored).
- **Mines** from bar 9: in about a third of the bars, for a bar and a half, in a column no target is using; a finger that touches one is silenced until it lifts.
- Code: `makePlan` (the gestures), `pickRows` and `spawn` (placement), `gameTick`, `drawGame` in `ui.js`.

**Ideas for making it feel like a game** (not built; for Andrew to choose):
- *Rhythm-game timing* (osu!, Cytus, Deemo): already used for the closing rings. Next: a "perfect" flash when a touch lands within an eighth of the ring closing, and combo streaks.
- *Defend something* (Missile Command, tower defence): targets are threats drifting toward the loop (the ruler) at the top or a core at the bottom; a held target is a shield, a drag a beam that sweeps; letting one through costs a life or glitches the audio.
- *Slicing* (Fruit Ninja): long drags as cuts through incoming objects.
- *Bosses:* every fourth bar a large target that needs three fingers held while it moves.
- *In-world art:* creatures or ships in place of discs, with the effect's colour; a held target "charging" and exploding into particles in time with the beat.

### 26.6 Fixes
- The Fields sheet's thumbnails were absolutely positioned (the page's `canvas` rule) and drew as coloured bands in the top-left of the screen.

### 26.7 Tests and scenarios
- `engine.test.js` has 58 cases. New ones: pitch defaults to octaves and fifths; touches only (empty steps and the plain loop silent; touches and written steps play). Two older pitch tests now set chromatic explicitly.
- Scenario `08-touches-only`: a sequence with two written steps under `fill: false`, a touch, an FX ONLY effect on empty steps, then `fill` back on.
