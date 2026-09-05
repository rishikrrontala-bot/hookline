/**
 * The HOOKLINE mark.
 *
 * Two upright bars are the in and out points of a cut; between them the
 * attention curve rises to a peak and falls away. So the glyph is a diagram of
 * what the product does — measure a curve, then cut a window out of it — and it
 * happens to resolve into an H at small sizes.
 *
 * The colour split is the one the rest of the system uses and is never
 * decorative: cyan is structure (the boundaries), heat is attention (the
 * curve). `tone="mono"` collapses both to `currentColor` for places that need a
 * single-colour mark.
 */

export interface MarkProps {
  size?: number;
  tone?: 'duo' | 'mono';
  className?: string;
}

/**
 * The curve never touches the bars. An earlier version ran it edge to edge and
 * the three shapes fused into a single jagged glyph that read as an N — the
 * gap is what makes the bars legible as boundaries around something.
 *
 * The peak is asymmetric, with a longer fall than rise, so it reads as a curve
 * that was measured rather than as a symmetrical arch.
 */
const CURVE = 'M 10.4 20.6 C 12.5 20.6 12.7 10.6 15.9 10.6 C 19.1 10.6 19.4 17.8 21.6 17.8';

export function Mark({ size = 28, tone = 'duo', className }: MarkProps) {
  const bar = tone === 'duo' ? 'var(--cyan-500)' : 'currentColor';
  const curve = tone === 'duo' ? 'var(--heat-500)' : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="5.4" width="3.6" height="21.2" rx="1.8" fill={bar} />
      <rect x="24.4" y="5.4" width="3.6" height="21.2" rx="1.8" fill={bar} />
      <path d={CURVE} stroke={curve} strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export interface LogoProps extends MarkProps {
  /** `full` sets the wordmark beside the mark; `mark` is the glyph alone. */
  variant?: 'full' | 'mark';
}

export function Logo({ size = 26, tone = 'duo', variant = 'full', className }: LogoProps) {
  if (variant === 'mark') {
    return (
      <span className={`logo logo--mark${className ? ` ${className}` : ''}`}>
        <Mark size={size} tone={tone} />
        <span className="visually-hidden">HOOKLINE</span>
      </span>
    );
  }

  return (
    <span className={`logo${className ? ` ${className}` : ''}`}>
      <Mark size={size} tone={tone} />
      <span className="logo__word">HOOKLINE</span>
    </span>
  );
}
