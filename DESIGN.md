# Design

## The world: Signal Room

A mastering suite at 2am. The reference is not software — it is **instrumentation**: a broadcast QC bay, an oscilloscope, a color-grading room. Rooms where someone is looking at a *measurement of a performance* and deciding what survives. Calibrated, dim, expensive, and completely uninterested in impressing you.

The one idea the whole surface is built on: **attention is heat.** The engine measures where a recording holds attention, and the interface renders that measurement as thermal energy across a landscape. Cold graphite where nothing is happening. Sodium-orange ridges where the signal spikes. This is not a color scheme applied to a chart — the accent *is* the data, and it appears nowhere it does not mean something.

Anti-references, explicitly: the violet-to-indigo AI gradient, the glassmorphic floating card, the friendly rounded SaaS dashboard, the phosphor-green hacker terminal. Signal Room is neutral, precise, and warm only where the measurement is warm.

## Palette

Dark is chosen from the use scene — a creator editing at night with the room lights off — not from category habit.

```
--ink-950   #06070A   page ground
--ink-900   #0A0C10   deep panel
--ink-850   #0F1218   panel
--ink-800   #141821   raised panel
--ink-750   #1A1F29   hover surface
--ink-700   #232935   border, strong
--ink-600   #2E3542   border
--ink-500   #3A4250   divider on raised

--mist-500  #7E8A9B   tertiary text        5.0:1 on ink-850
--mist-400  #9AA6B6   secondary text       7.0:1 on ink-850
--mist-300  #C2CBD7   emphasis text
--mist-100  #E8EDF4   primary text        15.6:1 on ink-850

--heat-600  #E8500A   signal, pressed
--heat-500  #FF6A1F   signal, primary accent — attention/energy
--heat-400  #FF8A3D   signal, bright       7.2:1 on ink-850
--heat-300  #FFB07A   signal, text-safe on dark
--ember     #FFD9A0   signal, peak highlight

--cyan-500  #2FD2F5   measurement / structure — topic boundaries, axes, timecode
--cyan-400  #6BE3FF
--cyan-200  #B8F1FF

--lime-400  #A9E85C   confirmed / exported
--rose-400  #FF5C6E   warning / conflict
```

**Rule:** heat = attention measured. cyan = structure measured. Never decorative, never both on the same element, never a gradient between them.

Thermal ramp for the terrain and curve (single continuous scale, cold → hot):
`#131A24 → #1D3A4A → #2E6B72 → #8A8F4A → #D97A18 → #FF6A1F → #FFD9A0`

## Type

Three faces, each with a job. All self-hosted via Fontsource — no CDN, no system fallback as the display voice.

- **Display — Archivo Variable** (`wght` 400–900, `wdth` 62–125). Set wide and heavy for headlines: `wdth 112, wght 800, letter-spacing -0.04em`. Broadcast titling authority. Display never exceeds 6rem.
- **UI / body — Inter Tight Variable.** Dense, quiet, built for reading labels next to numbers. Body measure held to 62–72ch.
- **Data — JetBrains Mono Variable.** Timecode, scores, durations, SRT output, signal readouts. Mono is earned here: every use is measurement, never costume. `font-variant-numeric: tabular-nums` everywhere a number can change.

Scale (fluid, `clamp`): display 3rem→5.75rem · h2 1.75rem→2.75rem · h3 1.125rem→1.375rem · body 0.9375rem/1.6 · label 0.75rem uppercase `0.14em` tracking · data 0.8125rem.

## Materials

- **Panels** are flat planes separated by 1px `--ink-700` hairlines and by light, not by rounding. Radius is restrained: `4px` controls, `8px` panels, `2px` data cells. No pill shapes outside actual chips.
- **Depth** comes from real shadow — `0 18px 40px -20px rgb(0 0 0 / .8), 0 2px 6px -2px rgb(0 0 0 / .6)` — always with offset and blur. No zero-offset halos.
- **Glow** is reserved. Only emitted where the measurement is hot: the terrain ridges, the curve peak, an active clip marker. It is a light source, not a border treatment.
- **Grain** — one 4% monochrome noise overlay across the whole page at `mix-blend-mode: overlay`. It is what makes the dark read as a room rather than as `#000`.
- **The rule** for the 3D layer: it renders data. The terrain height and heat come from the actual attention curve of the loaded transcript. If it is not showing a measurement, it does not render.

## Motion

One authored moment per surface, exponential ease-out (`cubic-bezier(.16,1,.3,1)`), from an already-visible default state.

- **Landing:** the attention terrain builds once — ridges rise from the plane in a single sweep left to right as the curve resolves, then settles into a slow idle drift. The camera does not orbit on scroll; it dollies once, on the first section change only.
- **Workspace:** analysis is the moment. The curve draws left to right at the real rate the pipeline completes stages, clip slabs drop into place as they are selected, and the stage list advances. It reads as an instrument settling, not as a progress bar.
- Everything else is 120–220ms state work: hover lifts, focus rings, panel swaps.
- `prefers-reduced-motion: reduce` stills the terrain to its resolved state, cuts the draw-on to an instant, and removes all idle drift.

## Browser surfaces

Themed, not defaulted: `::selection` is `--heat-500` at 28% with `--mist-100` text; caret is `--heat-500`; scrollbars are 10px `--ink-700` thumbs on transparent track; focus rings are a 2px `--cyan-400` outline at 2px offset; `text-underline-offset: 0.2em`; all data uses tabular numerals.

## Refused

Cards-as-page-structure, nested cards, kickers/eyebrows above headings, gradient text, glass-as-decoration, colored left borders, section numbering, sparkline filler, emoji-as-icons, and any metric the engine did not actually compute.
