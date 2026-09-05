import type { Clip, ThumbnailConcept, HookPattern } from '../types';

/** Thermal ramp, cold → hot. Matches the terrain and the curve. */
export const THERMAL = ['#131A24', '#1D3A4A', '#2E6B72', '#8A8F4A', '#D97A18', '#FF6A1F', '#FFD9A0'];

export function heatPair(score01: number): [string, string] {
  const t = Math.min(0.999, Math.max(0, score01));
  const i = Math.floor(t * (THERMAL.length - 2));
  return [THERMAL[i], THERMAL[i + 1]];
}

const COMPOSITION: Record<HookPattern, string> = {
  question: 'Subject centred, eyes on lens, overlay stacked above the head. Leave the lower third empty for burned captions.',
  statistic: 'Figure set large in the upper third, subject pushed to the lower right. Let the number carry the frame.',
  contrarian: 'Subject off-centre left, overlay right, hard negative space between them. The gap is the argument.',
  stakes: 'Tight crop, subject filling the frame, overlay lower left. Close enough to read the face.',
  story: 'Wider frame with environment visible, overlay small in a corner. Context is the hook.',
  instruction: 'Subject and the object of the instruction both in frame. Overlay top, two lines maximum.',
  declaration: 'Subject three-quarter, overlay overlapping the shoulder. Direct and unfussy.',
};

export function buildThumbnail(
  overlay: string,
  pattern: HookPattern,
  clipStart: number,
  clipDuration: number,
  score01: number,
): ThumbnailConcept {
  return {
    overlay,
    // A frame ~18% in has the speaker settled but still mid-hook.
    frameAtSec: clipStart + Math.min(3.2, clipDuration * 0.18),
    composition: COMPOSITION[pattern],
    heat: heatPair(score01),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Render the thumbnail concept as a real 9:16 SVG card.
 *
 * This is a layout proof, not a fake photo: the frame region is left as a
 * marked placeholder with the grab timecode on it, and everything the engine
 * actually decided — overlay text, position, heat — is rendered to scale so it
 * can be checked before anyone opens an editor.
 */
export function renderThumbnailSVG(clip: Clip, index: number): string {
  const W = 810;
  const H = 1440;
  const [cold, hot] = clip.thumbnail.heat;
  const lines = splitOverlay(clip.thumbnail.overlay);
  const id = `hl${index}`;

  const fontSize = lines.length > 1 ? 104 : 128;
  const lineHeight = fontSize * 0.92;
  const top = H * 0.115;
  const blockH = lines.length * lineHeight;

  // Safe areas: the regions a vertical player covers with its own chrome. The
  // card marks them because a thumbnail concept that ignores them is useless.
  const capTop = H - 430;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Thumbnail layout for clip ${clip.rank}: overlay reads ${esc(clip.thumbnail.overlay)}">
  <defs>
    <linearGradient id="${id}g" x1="0.1" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#0A0C10"/>
      <stop offset="42%" stop-color="${cold}"/>
      <stop offset="78%" stop-color="${hot}" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#06070A"/>
    </linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#06070A" stop-opacity="0"/>
      <stop offset="100%" stop-color="#06070A" stop-opacity="0.95"/>
    </linearGradient>
    <filter id="${id}b" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="46"/>
    </filter>
    <pattern id="${id}grid" width="54" height="54" patternUnits="userSpaceOnUse">
      <path d="M54 0 L0 0 0 54" fill="none" stroke="#E8EDF4" stroke-width="1" stroke-opacity="0.05"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="#06070A"/>
  <rect width="${W}" height="${H}" fill="url(#${id}g)"/>
  <ellipse cx="${W * 0.62}" cy="${H * 0.55}" rx="${W * 0.40}" ry="${H * 0.19}" fill="${hot}" opacity="0.30" filter="url(#${id}b)"/>
  <rect width="${W}" height="${H}" fill="url(#${id}grid)"/>

  <!-- where the subject sits, and where the player will cover the frame -->
  <g stroke="#E8EDF4" stroke-opacity="0.34" fill="none">
    <rect x="70" y="${H * 0.42}" width="${W - 140}" height="${H * 0.30}" stroke-dasharray="12 10" stroke-width="2" rx="4"/>
  </g>
  <text x="${W / 2}" y="${H * 0.565}" font-family="ui-monospace, monospace" font-size="23" fill="#E8EDF4" fill-opacity="0.62" text-anchor="middle" letter-spacing="4">SUBJECT</text>
  <text x="${W / 2}" y="${H * 0.565 + 38}" font-family="ui-monospace, monospace" font-size="21" fill="#E8EDF4" fill-opacity="0.42" text-anchor="middle" letter-spacing="2">grab @ ${clip.thumbnail.frameAtSec.toFixed(1)}s</text>

  <rect x="0" y="${capTop}" width="${W}" height="${H - capTop}" fill="url(#${id}s)"/>
  <g stroke="#2FD2F5" stroke-opacity="0.34" stroke-dasharray="8 8" stroke-width="2">
    <line x1="0" y1="${capTop}" x2="${W}" y2="${capTop}"/>
  </g>
  <text x="52" y="${capTop - 22}" font-family="ui-monospace, monospace" font-size="19" fill="#2FD2F5" fill-opacity="0.72" letter-spacing="2.4">CAPTION SAFE AREA</text>

  <g font-family="Archivo, Helvetica Neue, sans-serif" font-weight="900" font-size="${fontSize}" fill="#FFFFFF" letter-spacing="-4">
    ${lines
      .map((line, i) => `<text x="52" y="${top + (i + 1) * lineHeight}" stroke="#06070A" stroke-width="16" paint-order="stroke">${esc(line)}</text>`)
      .join('\n    ')}
  </g>
  <rect x="52" y="${top + blockH + 28}" width="150" height="7" fill="${hot}"/>

  <g font-family="ui-monospace, monospace" font-size="20" fill="#9AA6B6" letter-spacing="1.6">
    <text x="52" y="${H - 58}">CLIP ${String(clip.rank).padStart(2, '0')} · ${clip.durationSec.toFixed(0)}s · SCORE ${clip.score.toFixed(0)}</text>
    <text x="${W - 52}" y="${H - 58}" fill="${hot}" text-anchor="end" letter-spacing="3">HOOKLINE</text>
  </g>
</svg>`;
}

/** Break the overlay across at most two lines of roughly equal length. */
function splitOverlay(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  if (text.length <= 11) return [text];

  let best: string[] = [text];
  let bestDelta = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length > 14 || b.length > 14) continue;
    const delta = Math.abs(a.length - b.length);
    if (delta < bestDelta) { bestDelta = delta; best = [a, b]; }
  }
  // Nothing fit two lines cleanly — hard-split at the midpoint.
  if (best.length === 1 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    best = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  return best;
}
