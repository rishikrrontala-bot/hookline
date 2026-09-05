import { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainVertex, terrainFragment } from './terrainShaders';

export interface TerrainProps {
  /** The analysed attention curve, 0..1 per sample. */
  curve: number[];
  /** Normalised [start, end] pairs marking selected clips. */
  clips?: { start: number; end: number; score: number }[];
  /** Normalised positions of detected topic boundaries. */
  boundaries?: number[];
  /** Drives the one-time left-to-right build. Set to 1 to show it resolved. */
  reveal?: number;
  className?: string;
  /** Camera framing: `hero` sits low and wide, `panel` looks down from closer. */
  view?: 'hero' | 'panel';
}

const CURVE_RES = 512;

function useCurveTexture(curve: number[]): THREE.DataTexture {
  return useMemo(() => {
    const data = new Uint8Array(CURVE_RES);
    const source = curve.length ? curve : [0];

    for (let i = 0; i < CURVE_RES; i++) {
      const pos = (i / (CURVE_RES - 1)) * (source.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(source.length - 1, lo + 1);
      const f = pos - lo;
      // Smoothstep between samples so the ridge has no visible facets.
      const eased = f * f * (3 - 2 * f);
      const v = source[lo] * (1 - eased) + source[hi] * eased;
      data[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }

    const tex = new THREE.DataTexture(data, CURVE_RES, 1, THREE.RedFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, [curve]);
}

const SPAN_X = 16;
const SPAN_Z = 5.4;

function Surface({
  curve, reveal, quality, drift,
}: { curve: number[]; reveal: number; quality: 'high' | 'low'; drift: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const texture = useCurveTexture(curve);
  const pointer = useRef(new THREE.Vector2(0.5, -1));
  const revealRef = useRef(0);

  const segments = quality === 'high' ? [384, 96] : [176, 44];

  const uniforms = useMemo(
    () => ({
      uCurve: { value: texture },
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uHeight: { value: 2.05 },
      uDrift: { value: 1 },
      uOpacity: { value: 1 },
      uPointer: { value: new THREE.Vector2(0.5, -1) },
    }),
    [texture],
  );

  useEffect(() => {
    uniforms.uCurve.value = texture;
  }, [texture, uniforms]);

  // Same reasoning as the camera: if frames never arrive, the sweep must still
  // land on its target rather than leaving the terrain permanently unrevealed.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (revealRef.current < reveal - 0.01) {
        revealRef.current = reveal;
        if (material.current) material.current.uniforms.uReveal.value = reveal;
      }
    }, 1400);
    return () => window.clearTimeout(id);
  }, [reveal]);

  const { size } = useThree();
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.set(e.clientX / size.width, 1 - e.clientY / size.height);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [size.width, size.height]);

  useFrame((state, delta) => {
    const m = material.current;
    if (!m) return;
    // Ease toward the target rather than snapping, so a reveal driven by the
    // pipeline reads as an instrument settling.
    revealRef.current += (reveal - revealRef.current) * Math.min(1, delta * 3.4);
    m.uniforms.uReveal.value = revealRef.current;
    // Drift eases to a stop rather than snapping when the terrain leaves view.
    m.uniforms.uDrift.value += ((drift ? 1 : 0) - m.uniforms.uDrift.value) * Math.min(1, delta * 2.2);
    if (m.uniforms.uDrift.value > 0.002) m.uniforms.uTime.value = state.clock.elapsedTime;
    (m.uniforms.uPointer.value as THREE.Vector2).lerp(pointer.current, 0.06);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
      <planeGeometry args={[SPAN_X, SPAN_Z, segments[0], segments[1]]} />
      <shaderMaterial
        ref={material}
        vertexShader={terrainVertex}
        fragmentShader={terrainFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/** Vertical markers at each topic boundary — cyan, because they are structure. */
function BoundaryMarkers({ boundaries, reveal }: { boundaries: number[]; reveal: number }) {
  const group = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const at = boundaries[i];
      const target = reveal > at ? 1 : 0;
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity += (target * 0.34 - mat.opacity) * Math.min(1, delta * 4);
    });
  });

  return (
    <group ref={group}>
      {boundaries.map((b, i) => (
        <mesh key={i} position={[(b - 0.5) * SPAN_X, 0.35, 0]} rotation={[0, 0, 0]}>
          <planeGeometry args={[0.012, 1.9]} />
          <meshBasicMaterial color="#2fd2f5" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Clip windows, lit from beneath the terrain where the engine chose to cut. */
function ClipSlabs({ clips, reveal }: { clips: { start: number; end: number; score: number }[]; reveal: number }) {
  const group = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const clip = clips[i];
      const target = reveal > clip.end ? 1 : 0;
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const peak = 0.06 + clip.score * 0.13;
      mat.opacity += (target * peak - mat.opacity) * Math.min(1, delta * 3);
    });
  });

  return (
    <group ref={group}>
      {clips.map((c, i) => {
        const width = Math.max(0.06, (c.end - c.start) * SPAN_X);
        const centre = ((c.start + c.end) / 2 - 0.5) * SPAN_X;
        return (
          <mesh key={i} position={[centre, -0.58, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[width, SPAN_Z * 0.66]} />
            <meshBasicMaterial color="#ff6a1f" transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

const VIEWS = {
  hero: { position: new THREE.Vector3(0, 1.55, 6.4), look: new THREE.Vector3(0, 0.1, 0) },
  // The workspace strip is short and wide, so the panel view sits higher and
  // further back — the terrain reads as a landscape band rather than a wall.
  panel: { position: new THREE.Vector3(0, 3.9, 8.6), look: new THREE.Vector3(0, -0.35, 0) },
} as const;

function Rig({ view }: { view: 'hero' | 'panel' }) {
  const { camera } = useThree();
  const { position, look } = VIEWS[view];

  // Frame zero has to be correct on its own. Animation frames do not run in a
  // backgrounded tab, under a throttled compositor, or before the first paint —
  // and a camera that only aims itself inside the render loop shows the terrain
  // edge-on until a frame happens to arrive.
  useLayoutEffect(() => {
    camera.position.copy(position);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }, [camera, position, look]);

  useFrame((state, delta) => {
    // A slow parallax that follows the pointer a little. The camera never
    // orbits on scroll — one authored move, not a ride.
    const px = (state.pointer.x || 0) * 0.42;
    const py = (state.pointer.y || 0) * 0.22;
    camera.position.lerp(
      new THREE.Vector3(position.x + px, position.y + py, position.z),
      Math.min(1, delta * 1.6),
    );
    camera.lookAt(look);
  });
  return null;
}

export function AttentionTerrain({
  curve,
  clips = [],
  boundaries = [],
  reveal = 1,
  className,
  view = 'hero',
}: TerrainProps) {
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [reduced, setReduced] = useState(false);
  // Governs the idle drift only — never the render loop. See the effect below.
  const [visible, setVisible] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 860px)');
    const sync = () => {
      setReduced(mq.matches);
      setQuality(narrow.matches ? 'low' : 'high');
    };
    sync();
    mq.addEventListener('change', sync);
    narrow.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      narrow.removeEventListener('change', sync);
    };
  }, []);

  // R3F renders nothing until `react-use-measure` reports a non-zero size, and
  // that measurement comes from a ResizeObserver which does not fire while the
  // page is in a background or non-compositing tab. A canvas mounted in those
  // conditions stays at the browser's default 300x150 and never initialises,
  // even after the tab is brought forward — the element's box never changed, so
  // there is nothing for the observer to report.
  //
  // Nudging a re-measure once after mount, and again when the page becomes
  // visible, costs nothing and removes the failure entirely.
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const raf = requestAnimationFrame(nudge);
    const timer = window.setTimeout(nudge, 220);
    document.addEventListener('visibilitychange', nudge);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', nudge);
    };
  }, []);

  // Idle drift is stilled once the terrain scrolls out of view. Switching R3F's
  // frameloop to "demand" instead would stop the loop entirely, and an observer
  // that reports "off screen" before first layout then leaves a hero that never
  // draws at all — so visibility governs the animation, never the loop.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '160px',
    });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Reduced motion resolves the terrain immediately and stills the drift.
  const effectiveReveal = reduced ? Math.max(reveal, 1) : reveal;

  return (
    <div className={className} ref={host} aria-hidden="true">
      <Canvas
        dpr={[1, quality === 'high' ? 1.85 : 1.3]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 60, position: [0, 1.55, 6.4] }}
        frameloop={reduced ? 'demand' : 'always'}
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      >
        <Rig view={view} />
        <Surface curve={curve} reveal={effectiveReveal} quality={quality} drift={visible && !reduced} />
        <BoundaryMarkers boundaries={boundaries} reveal={effectiveReveal} />
        <ClipSlabs clips={clips} reveal={effectiveReveal} />
      </Canvas>
    </div>
  );
}
