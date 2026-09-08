# HOOKLINE brand assets

Regenerate with `npm run brand`. `public/mark.svg` and `public/logo.svg` are the
source of truth; everything here is rendered from the same geometry through
headless Chrome, so the PNGs cannot drift from the SVG and the wordmark uses the
real Archivo face rather than a fallback.

| File | Use |
| --- | --- |
| `mark-{32…1024}.png` | The mark alone, transparent background |
| `mark-512-mono-light.png` | Single colour, for dark surfaces |
| `mark-512-mono-dark.png` | Single colour, for light surfaces |
| `icon-{180,512,1024}.png` | App icon on its tile, rounded, transparent corners |
| `icon-{512,1024}-square.png` | Unrounded, for iOS and macOS which apply their own mask |
| `lockup-light-on-dark.png` | Horizontal lockup for dark backgrounds |
| `lockup-dark-on-light.png` | Horizontal lockup for light backgrounds |
| `lockup-mono-{light,dark}.png` | Single-colour lockups |
| `brand-card-1440x960.png` | 3:2 title card for project galleries and slides |

Colours: cyan `#2FD2F5` is structure, heat `#FF6A1F` is attention, ground is
`#0A0C10`. The split is never decorative — see `DESIGN.md`.
