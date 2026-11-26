// The airdrop.
//
// A parachute carries a supply crate: the airdrop itself. Excluded wallets
// drift as coins in a ring below it. Five validator lenses orbit the crate.
// The scene follows the user's case:
//   idle      your coin drifts with the other excluded wallets
//   filed     your coin rises to the crate
//   judging   lenses converge and beam at the crate (one consensus round)
//   approved  your coin settles on the crate as its emblem; straps turn green
//   rejected  your coin turns red and falls to the ground

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, Line, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type ScenePhase = "idle" | "filed" | "judging" | "approved" | "rejected";

const INK = new THREE.Color("#18222D");
const MIST = new THREE.Color("#9FB0C0");
const AMBER = new THREE.Color("#D99A1C");
const STAMP = new THREE.Color("#2B3FD4");
const PAPER = new THREE.Color("#F6F8FA");
const APPROVE = new THREE.Color("#23775A");
const REJECT = new THREE.Color("#B8322C");

// Parachute geometry
const GORES = 12;
const CANOPY_R = 1.6;
const CANOPY_THETA = 1.22;   // how far down the dome reaches (radians from the apex)
const CANOPY_FLAT = 0.74;    // vertical squash: a parachute, not a sphere
const CANOPY_Y = 1.55;       // canopy origin height
const CRATE_Y = 0.05;
const CRATE = 0.66;

const COINS = 320;
const VALIDATORS = 5;

function useReducedMotion(): boolean {
  return useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

/** One canopy gore: a sphere slice with its own outward billow, deepest at the hem. */
function goreGeometry(index: number): THREE.BufferGeometry {
  const w = 14;
  const h = 18;
  const g = new THREE.SphereGeometry(CANOPY_R, w, h, (index * Math.PI * 2) / GORES, (Math.PI * 2) / GORES, 0, CANOPY_THETA);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let iy = 0; iy <= h; iy++) {
    for (let ix = 0; ix <= w; ix++) {
      const i = iy * (w + 1) + ix;
      v.fromBufferAttribute(pos, i);
      const across = Math.sin((ix / w) * Math.PI);        // 0 at the seams, 1 mid-gore
      const down = iy / h;                                 // 0 at the apex, 1 at the hem
      const billow = 1 + across * (0.035 + 0.075 * down);
      v.multiplyScalar(billow);
      // Scalloped hem: mid-gore fabric rides up a touch between the seams.
      if (iy === h) v.y += across * 0.06;
      v.y *= CANOPY_FLAT;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Where each seam meets the hem (local canopy space). */
function hemPoint(seam: number): THREE.Vector3 {
  const phi = (seam * Math.PI * 2) / GORES;
  const s = Math.sin(CANOPY_THETA);
  return new THREE.Vector3(-CANOPY_R * Math.cos(phi) * s, CANOPY_R * Math.cos(CANOPY_THETA) * CANOPY_FLAT, CANOPY_R * Math.sin(phi) * s);
}

function verdictColor(phase: ScenePhase): THREE.Color {
  return phase === "approved" ? APPROVE : phase === "rejected" ? REJECT : STAMP;
}

function Parachute({ phase }: { phase: ScenePhase }) {
  const rig = useRef<THREE.Group>(null);
  const canopy = useRef<THREE.Group>(null);
  const straps = useRef<THREE.MeshStandardMaterial[]>([]);
  const reduced = useReducedMotion();
  const gores = useMemo(() => Array.from({ length: GORES }, (_, i) => goreGeometry(i)), []);

  // Suspension lines: every seam runs to the nearest top corner of the crate.
  const lines = useMemo(() => {
    const top = CRATE_Y + CRATE * 0.45 - CANOPY_Y;
    const c = CRATE / 2 - 0.04;
    return Array.from({ length: GORES }, (_, i) => {
      const hem = hemPoint(i);
      const corner = new THREE.Vector3(Math.sign(hem.x || 1) * c, top, Math.sign(hem.z || 1) * c);
      return [hem, corner] as [THREE.Vector3, THREE.Vector3];
    });
  }, []);

  useFrame((state, dt) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    const g = rig.current;
    if (g) {
      const lift = phase === "approved" ? 0.25 : phase === "rejected" ? -0.18 : 0;
      const k = reduced ? 1 : 1 - Math.pow(0.15, dt);
      g.position.y += (lift + Math.sin(t * 0.8) * 0.06 - g.position.y) * k;
      g.rotation.z = Math.sin(t * 0.55) * 0.05 + (phase === "rejected" ? 0.06 : 0);
      g.rotation.x = Math.cos(t * 0.42) * 0.035;
      g.rotation.y = t * 0.06;
    }
    if (canopy.current) {
      // The canopy breathes as air spills out under it.
      const b = Math.sin(t * 1.6) * 0.015;
      canopy.current.scale.set(1 + b, 1 - b * 1.4, 1 + b);
    }
    const col = verdictColor(phase);
    const glow = phase === "judging" ? 0.55 + Math.sin(t * 6) * 0.25 : phase === "idle" || phase === "filed" ? 0.15 : 0.6;
    straps.current.forEach((m) => {
      m.color.lerp(col, 0.08);
      m.emissive.lerp(col, 0.08);
      m.emissiveIntensity = glow;
    });
  });

  const strapRef = (i: number) => (m: THREE.MeshStandardMaterial | null) => { if (m) straps.current[i] = m; };

  return (
    <group ref={rig}>
      <group ref={canopy} position={[0, CANOPY_Y, 0]}>
        {gores.map((geo, i) => (
          <mesh key={i} geometry={geo} castShadow>
            <meshPhysicalMaterial
              color={i % 2 === 0 ? STAMP : PAPER}
              roughness={0.62}
              sheen={1}
              sheenRoughness={0.45}
              sheenColor={i % 2 === 0 ? "#8FA0FF" : "#FFFFFF"}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        {/* apex vent band */}
        <mesh position={[0, CANOPY_R * CANOPY_FLAT * 1.035, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.16, 0.025, 12, 40]} />
          <meshStandardMaterial color={INK} roughness={0.5} />
        </mesh>
        {lines.map((pts, i) => (
          <Line key={i} points={pts} color="#18222D" lineWidth={1.1} transparent opacity={0.75} />
        ))}
      </group>

      {/* the crate */}
      <group position={[0, CRATE_Y, 0]}>
        <RoundedBox args={[CRATE, CRATE * 0.9, CRATE]} radius={0.05} smoothness={4} castShadow receiveShadow>
          <meshStandardMaterial color="#33475B" roughness={0.5} metalness={0.2} />
        </RoundedBox>
        {/* two straps wrapping the crate */}
        <mesh>
          <boxGeometry args={[CRATE + 0.012, CRATE * 0.9 + 0.012, 0.09]} />
          <meshStandardMaterial ref={strapRef(0)} color={STAMP} emissive={STAMP} emissiveIntensity={0.15} roughness={0.4} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.09, CRATE * 0.9 + 0.014, CRATE + 0.014]} />
          <meshStandardMaterial ref={strapRef(1)} color={STAMP} emissive={STAMP} emissiveIntensity={0.15} roughness={0.4} />
        </mesh>
        {/* lifting ring on top */}
        <mesh position={[0, CRATE * 0.45 + 0.03, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.07, 0.015, 10, 30]} />
          <meshStandardMaterial color="#9FB0C0" metalness={0.8} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

function CoinRing({ phase }: { phase: ScenePhase }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const reduced = useReducedMotion();
  const seeds = useMemo(() => {
    const rnd = mulberry32(11);
    return Array.from({ length: COINS }, () => {
      const r = 2.3 + Math.pow(rnd(), 0.9) * 1.9;
      return { r, a: rnd() * Math.PI * 2, y: -1.1 + (rnd() - 0.5) * 0.7, speed: 0.025 + rnd() * 0.04, tilt: rnd() * Math.PI, spin: rnd() * 2, flagged: rnd() < 0.2 };
    });
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colored = useRef(false);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = reduced ? 0 : state.clock.elapsedTime;
    const pull = phase === "judging" ? 0.9 : 1;
    seeds.forEach((s, i) => {
      const a = s.a + t * s.speed;
      dummy.position.set(Math.cos(a) * s.r * pull, s.y + Math.sin(t * 0.7 + i) * 0.04, Math.sin(a) * s.r * pull);
      dummy.rotation.set(s.tilt + t * 0.35 * s.spin, a, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (!colored.current) m.setColorAt(i, s.flagged ? AMBER : i % 7 === 0 ? INK : MIST);
    });
    m.instanceMatrix.needsUpdate = true;
    if (!colored.current && m.instanceColor) { m.instanceColor.needsUpdate = true; colored.current = true; }
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COINS]} castShadow>
      <cylinderGeometry args={[0.05, 0.05, 0.012, 20]} />
      <meshStandardMaterial metalness={0.55} roughness={0.32} />
    </instancedMesh>
  );
}

function YourCoin({ phase }: { phase: ScenePhase }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const reduced = useReducedMotion();

  useFrame((state, dt) => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const t = state.clock.elapsedTime;
    const faceCamera = phase === "approved";
    if (phase === "idle") target.set(Math.cos(t * 0.04) * 3.1, -0.95, Math.sin(t * 0.04) * 3.1);
    else if (phase === "approved") target.set(0, CRATE_Y + 0.25 + Math.sin(t * 0.8) * 0.06, CRATE / 2 + 0.06);
    else if (phase === "rejected") target.set(0.7, -1.62, 1.1);
    else target.set(0, CRATE_Y - CRATE * 0.45 - 0.42 + Math.sin(t * 1.4) * 0.05, 0);
    const k = reduced ? 1 : 1 - Math.pow(0.03, dt);
    m.position.lerp(target, k);
    if (faceCamera) {
      m.rotation.set(Math.PI / 2, 0, 0);
    } else if (phase === "rejected") {
      m.rotation.x += (0 - m.rotation.x) * k;
    } else {
      m.rotation.y += dt * (phase === "judging" ? 2.8 : 0.7);
      m.rotation.x = Math.PI / 2 + Math.sin(t) * 0.2;
    }
    const color = verdictColor(phase);
    mat.current.color.lerp(phase === "idle" ? STAMP : color, k);
    mat.current.emissive.lerp(phase === "idle" ? STAMP : color, k);
    mat.current.emissiveIntensity = phase === "judging" ? 0.5 + Math.sin(t * 6) * 0.25 : 0.25;
  });

  return (
    <mesh ref={ref} castShadow scale={phase === "idle" ? 1.4 : 2}>
      <cylinderGeometry args={[0.1, 0.1, 0.022, 48]} />
      <meshStandardMaterial ref={mat} metalness={0.6} roughness={0.25} color={STAMP} emissive={STAMP} />
    </mesh>
  );
}

function Validators({ phase }: { phase: ScenePhase }) {
  const beams = useRef<THREE.Mesh[]>([]);
  const lenses = useRef<THREE.Group[]>([]);
  const reduced = useReducedMotion();
  const aim = useMemo(() => new THREE.Vector3(0, CRATE_Y, 0), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    const judging = phase === "judging";
    const radius = judging ? 1.55 : 2.15;
    const col = verdictColor(phase);
    lenses.current.forEach((lens, i) => {
      if (!lens) return;
      const a = (i / VALIDATORS) * Math.PI * 2 + t * (judging ? 0.5 : 0.12);
      const y = CRATE_Y + 0.1 + Math.sin(t * 0.7 + i * 1.3) * (judging ? 0.06 : 0.3);
      const k = reduced ? 1 : 1 - Math.pow(0.05, dt);
      lens.position.lerp(tmp.set(Math.cos(a) * radius, y, Math.sin(a) * radius), k);
      lens.lookAt(aim);
      const beam = beams.current[i];
      if (beam) {
        const on = judging || phase === "approved" || phase === "rejected";
        const mat = beam.material as THREE.MeshBasicMaterial;
        const goal = on ? (judging ? 0.4 + 0.25 * Math.sin(t * 8 + i) : 0.2) : 0;
        mat.opacity += (goal - mat.opacity) * Math.min(1, dt * 6);
        mat.color.lerp(col, k);
        const p = lens.position;
        beam.position.set(p.x / 2, (p.y + aim.y) / 2, p.z / 2);
        beam.lookAt(aim);
        beam.scale.set(1, 1, tmp.copy(p).sub(aim).length());
      }
    });
  });

  return (
    <group>
      {Array.from({ length: VALIDATORS }, (_, i) => (
        <group key={i}>
          <group ref={(el) => { if (el) lenses.current[i] = el; }}>
            <mesh>
              <torusGeometry args={[0.16, 0.03, 16, 48]} />
              <meshStandardMaterial color="#2B3FD4" metalness={0.8} roughness={0.2} />
            </mesh>
            <mesh>
              <circleGeometry args={[0.135, 32]} />
              <meshPhysicalMaterial color="#C9D8F2" transmission={0.85} roughness={0.08} thickness={0.15} />
            </mesh>
          </group>
          <mesh ref={(el) => { if (el) beams.current[i] = el; }}>
            <boxGeometry args={[0.012, 0.012, 1]} />
            <meshBasicMaterial color="#2B3FD4" transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rig({ phase }: { phase: ScenePhase }) {
  const reduced = useReducedMotion();
  const look = useMemo(() => new THREE.Vector3(0, 0.8, 0), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    const close = phase === "judging";
    const verdict = phase === "approved" || phase === "rejected";
    const aspect = state.size.width / state.size.height;
    const wide = aspect > 1.15;
    const portrait = aspect < 0.8;
    const back = portrait ? 2.0 : wide ? 1 : 1.12;
    const px = state.pointer.x * 0.5;
    const py = state.pointer.y * 0.25;
    if (close) goal.set(px + 0.3, 1.15 + py, 6.4 * back);
    else if (verdict) goal.set(px + 0.2, 1.4 + py, 7.3 * back);
    else goal.set(px + Math.sin(t * 0.05) * 0.4, 1.55 + py, 8.2 * back);
    state.camera.position.lerp(goal, 0.03);
    // Fog band follows the camera distance so stepping back never hides the subject.
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = 8 * back; fog.far = 16 * back; }
    // Wide screens: the copy sits left, so frame the airdrop right of centre.
    const shiftX = wide ? (close ? -1.85 : verdict ? -2.15 : -2.35) : 0;
    const lookY = portrait ? -2.1 : close ? 0.6 : wide ? 0.8 : 1.25;
    look.lerp(goal.set(shiftX, lookY, 0), 0.03);
    state.camera.lookAt(look);
  });
  return null;
}

export default function AirdropScene({ phase }: { phase: ScenePhase }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.55, 8.2], fov: 38 }} gl={{ antialias: true }}>
      <color attach="background" args={["#E8EDF1"]} />
      <fog attach="fog" args={["#E8EDF1", 8, 16]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 4]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      {/* Local studio light (no network). */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 5, -6]} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#dfe6ff" position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[6, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
      </Environment>
      <Rig phase={phase} />
      <Parachute phase={phase} />
      <YourCoin phase={phase} />
      <Validators phase={phase} />
      <CoinRing phase={phase} />
      <ContactShadows position={[0, -1.75, 0]} opacity={0.32} scale={14} blur={2.8} far={4.5} color="#18222D" />
    </Canvas>
  );
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
