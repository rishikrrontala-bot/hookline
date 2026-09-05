# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript. React Three Fiber / three.js for the 3D attention terrain, GSAP for scroll choreography. The analysis engine is framework-free TypeScript with zero runtime dependencies so the identical code executes in the browser and in the Node CLI. Static deploy target. (User answered: "Vite + React + TypeScript + Three.js".)

## Users

Solo creators and small-channel editors who record long-form material — podcasts, tutorials, streams, talks, interviews — and then face the second job: cutting it into short vertical clips, writing captions, titles, descriptions, tags and chapters, and spacing the results across a week of posting. They work alone, usually at night, in a dim room, with the recording already finished and the deadline already close. The bottleneck is not editing skill. It is deciding *which ninety seconds of ninety minutes are worth anyone's attention*, and then producing the eleven pieces of metadata each clip needs before it can go out.

## Product Purpose

HOOKLINE takes one long-form transcript and returns a complete, publishable week of channel output: ranked clips cut at real topic boundaries, rewritten hooks, platform-tuned titles, descriptions, hashtags, burn-in-ready captions, thumbnail concepts, chapter markers for the source video, and a posting schedule. Success is a creator going from a finished recording to a full export package in under a minute, and shipping most of it with light edits rather than starting from a blank timeline.

## Positioning

The mechanism is an **attention curve computed from the transcript itself**, not a prompt asking a model to "find good clips."

Every sentence is scored across eight independent linguistic signals — hook construction, curiosity gap, emotional charge, concreteness, TF-IDF salience, payoff resolution, delivery pace, and quotability. Those scores are smoothed into a continuous curve over the whole recording. Topic boundaries are found separately by lexical-cohesion segmentation (TextTiling), so clips are cut where the subject actually changes rather than at arbitrary durations. Clip candidates are then windowed against those boundaries, scored on a weighted objective that heavily favors a hot opening, and reduced by non-maximum suppression so the results do not overlap.

This means the tool is inspectable and deterministic: the same transcript yields the same clips, every score is attributable to named signals a creator can read, and the entire thing runs offline with no API key. A neighboring product built as a model wrapper cannot truthfully claim any of that.

## Operating Context

Input arrives as whatever the creator already has: a plain-text transcript, an SRT or VTT subtitle file, or a pasted YouTube transcript with `0:14`-style timecodes. Output has to land in the tools already open — subtitle files for the editor, plain text for the upload form, CSV for the calendar. The work happens after the recording and before the upload, and it is the part creators most often skip or rush.

## Capabilities and Constraints

- Runs entirely client-side. No account, no upload, no server. The transcript never leaves the machine.
- Deterministic core: no API key required, ever. An optional Claude API pass can rewrite hooks and titles when a key is present, and the deterministic result stands unchanged when it is not.
- The same engine module powers the browser workspace and a Node CLI that writes a real export directory to disk.
- Analyzes text. It does not cut video files; it emits the timecodes, subtitle files and metadata an editor or an ffmpeg step consumes.
- Plain-text input without timecodes gets timings synthesized from a words-per-minute model, and the delivery-pace signal is withheld rather than faked.

## Brand Commitments

Name: HOOKLINE. Voice is that of a technical instrument — measured, specific, unexcited. It reports what it measured. It does not sell, exclaim, or promise reach.

## Evidence on Hand

Sample transcripts ship with the project and are the only content used in the interface. There are no users, no customers, no testimonials, no benchmarks, no press, and no funding. Nothing in the product may imply otherwise — no fabricated logo walls, adoption counts, star ratings, or quoted creators.

## Product Principles

1. **Show the measurement.** Every clip surfaces the signals that selected it. A score the creator cannot interrogate is a score they cannot trust.
2. **Never break on a cold start.** The demo path has no key, no network, and no setup. Enhancement is additive; absence is never an error state.
3. **Cut on meaning, not on duration.** Topic boundaries govern the edit. A clip that ends mid-thought is a defect regardless of its score.
4. **Finish the job.** A clip without captions, titles, tags and a slot on the calendar is homework, not output.
5. **Claim only what was computed.** The language describes signals and timecodes, never predicted views.

## Accessibility & Inclusion

Dark-first, because the real use scene is a dim editing room at night — not because of category habit. Body and placeholder text hold ≥4.5:1; the accent never carries meaning alone (heat is always paired with a numeral or label). Full keyboard operation across the workspace, visible focus, and the 3D terrain is decorative-redundant: everything it shows is also present as text and as a 2D curve, and it stills under `prefers-reduced-motion`.
