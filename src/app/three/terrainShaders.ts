/**
 * The attention terrain.
 *
 * Height and heat both come from the analysed attention curve — this is a
 * rendering of the measurement, not an ambient graphic. Where the terrain is
 * hot, the engine found language that holds attention; where it is cold and
 * flat, it did not. Clip windows are the bands lit from beneath.
 */

export const terrainVertex = /* glsl */ `
uniform sampler2D uCurve;
uniform float uReveal;
uniform float uTime;
uniform float uHeight;
uniform float uDrift;

varying float vAttention;
varying float vFalloff;
varying vec2  vUv;
varying float vRevealed;

void main() {
  vUv = uv;

  float t = uv.x;
  // Three taps flatten the sampling stair-step the low-res curve texture would
  // otherwise show along the ridge.
  float texel = 1.0 / 512.0;
  float a =
      texture2D(uCurve, vec2(t - texel, 0.5)).r * 0.25
    + texture2D(uCurve, vec2(t,         0.5)).r * 0.50
    + texture2D(uCurve, vec2(t + texel, 0.5)).r * 0.25;

  // Ridge band: the curve is strongest along the centre line and tapers to the
  // front and back edges, so the surface reads as a landform rather than a wall.
  float z = (uv.y - 0.5) * 2.0;
  float falloff = exp(-z * z * 2.3);

  // Reveal sweeps left to right once, as the pipeline resolves.
  float revealed = 1.0 - smoothstep(uReveal - 0.10, uReveal + 0.015, t);

  // Idle drift — a slow breathing motion, never a loop the eye can catch.
  float drift = sin(t * 21.0 + uTime * 0.34) * 0.5 + sin(t * 8.0 - uTime * 0.21) * 0.5;
  float ripple = drift * 0.020 * uDrift * falloff;

  float h = (a * falloff * uHeight + ripple) * revealed;

  vAttention = a;
  vFalloff = falloff;
  vRevealed = revealed;

  vec3 displaced = position;
  displaced.z += h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const terrainFragment = /* glsl */ `
precision highp float;

uniform float uReveal;
uniform float uTime;
uniform float uOpacity;
uniform vec2  uPointer;

varying float vAttention;
varying float vFalloff;
varying vec2  vUv;
varying float vRevealed;

// The thermal ramp, matching --t0…--t6 in tokens.css.
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.075, 0.102, 0.141);
  vec3 c1 = vec3(0.114, 0.227, 0.290);
  vec3 c2 = vec3(0.180, 0.420, 0.447);
  vec3 c3 = vec3(0.541, 0.561, 0.290);
  vec3 c4 = vec3(0.851, 0.478, 0.094);
  vec3 c5 = vec3(1.000, 0.416, 0.122);
  vec3 c6 = vec3(1.000, 0.851, 0.627);

  float s = t * 6.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  if (s < 4.0) return mix(c3, c4, s - 3.0);
  if (s < 5.0) return mix(c4, c5, s - 4.0);
  return mix(c5, c6, s - 5.0);
}

void main() {
  float a = vAttention;
  vec3 col = thermal(a * 0.92 + 0.04);

  // Topographic contours — the instrument reference, and they make the height
  // readable without a legend.
  float bands = a * 11.0;
  float d = abs(fract(bands - 0.5) - 0.5) / max(fwidth(bands), 0.0001);
  float contour = 1.0 - clamp(d, 0.0, 1.0);
  col += contour * 0.30 * mix(vec3(0.42, 0.78, 0.92), vec3(1.0, 0.86, 0.63), a);

  // Time graticule, spaced as an instrument scale rather than a decorative grid.
  float gx = abs(fract(vUv.x * 48.0) - 0.5) / max(fwidth(vUv.x * 48.0), 0.0001);
  col += (1.0 - clamp(gx, 0.0, 1.0)) * 0.06 * vec3(0.5, 0.75, 0.9) * vFalloff;

  // The leading edge of the reveal glows as it passes.
  float edge = 1.0 - smoothstep(0.0, 0.045, abs(vUv.x - uReveal));
  col += edge * vec3(1.0, 0.62, 0.24) * 0.85 * step(0.001, uReveal) * step(uReveal, 0.999);

  // Pointer proximity warms the surface — the only interaction the terrain has.
  float pd = distance(vUv, uPointer);
  col += smoothstep(0.22, 0.0, pd) * vec3(0.28, 0.12, 0.03);

  // Fade to the page ground at the depth edges and past the reveal.
  float depthFade = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
  float alpha = uOpacity * vRevealed * mix(0.30, 1.0, vFalloff) * depthFade;
  alpha *= smoothstep(0.0, 0.03, vUv.x);

  gl_FragColor = vec4(col, alpha);
}
`;
