// The recount chamber.
//
// A cloud of excluded wallets (small coins) drifts around a glass chamber.
// Five validator lenses orbit it. The scene follows the user's case:
//   idle      your coin waits in the cloud
//   filed     your coin rises into the chamber
//   judging   lenses converge and beam into the chamber (one consensus round)
//   approved  coin turns approval green and lifts
//   rejected  coin turns rejection red and settles

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Float, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type ScenePhase = "idle" | "filed" | "judging" | "approved" | "rejected";

const INK = new THREE.Color("#18222D");
const MIST = new THREE.Color("#9FB0C0");
const AMBER = new THREE.Color("#D99A1C");
const STAMP = new THREE.Color("#2B3FD4");
const APPROVE = new THREE.Color("#23775A");
const REJECT = new THREE.Color("#B8322C");

const COINS = 620;
const VALIDATORS = 5;

function useReducedMotion(): boolean {
  return useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

function CoinCloud({ phase }: { phase: ScenePhase }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const reduced = useReducedMotion();
  const seeds = useMemo(() => {
    const rnd = mulberry32(7);
    return Array.from({ length: COINS }, () => {
      const r = 2.5 + Math.pow(rnd(), 0.8) * 2.3;
      return {
        r, a: rnd() * Math.PI * 2, y: (rnd() - 0.5) * 1.6 * (1.2 - r / 7),
        speed: 0.03 + rnd() * 0.05, tilt: rnd() * Math.PI, spin: rnd() * 2, flagged: rnd() < 0.18,
      };
    });
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorsSet = useRef(false);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = reduced ? 0 : state.clock.elapsedTime;
    // While the validators deliberate the whole cloud slows and leans in.
    const pull = phase === "judging" ? 0.86 : 1;
    seeds.forEach((s, i) => {
      const a = s.a + t * s.speed;
      dummy.position.set(Math.cos(a) * s.r * pull, s.y + Math.sin(t * 0.6 + i) * 0.05, Math.sin(a) * s.r * pull);
      dummy.rotation.set(s.tilt + t * 0.3 * s.spin, a, 0);
      dummy.scale.setScalar(s.flagged ? 1.15 : 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (!colorsSet.current) m.setColorAt(i, s.flagged ? AMBER : i % 9 === 0 ? INK : MIST);
    });
    m.instanceMatrix.needsUpdate = true;
    if (!colorsSet.current && m.instanceColor) {
      m.instanceColor.needsUpdate = true;
      colorsSet.current = true;
    }
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COINS]} castShadow>
      <cylinderGeometry args={[0.058, 0.058, 0.014, 20]} />
      <meshStandardMaterial metalness={0.55} roughness={0.32} />
    </instancedMesh>
  );
}

function GlassChamber() {
  return (
    <group>
      <mesh position={[0, 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.95, 1.1, 16, 64]} />
        <MeshTransmissionMaterial
          thickness={0.6} roughness={0.08} transmission={1} ior={1.35} chromaticAberration={0.04}
          anisotropy={0.2} distortion={0.15} distortionScale={0.3} temporalDistortion={0.05}
          color="#DDE7F0" backside samples={4} resolution={512}
        />
      </mesh>
      {/* base plate: a ballot-box lid */}
      <mesh position={[0, -1.18, 0]} receiveShadow>
        <cylinderGeometry args={[1.35, 1.45, 0.16, 64]} />
        <meshStandardMaterial color="#18222D" metalness={0.3} roughness={0.45} />
      </mesh>
      <mesh position={[0, -1.095, 0]}>
        <boxGeometry args={[0.9, 0.012, 0.09]} />
        <meshStandardMaterial color="#2B3FD4" emissive="#2B3FD4" emissiveIntensity={0.6} />
      </mesh>
    </group>
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
    if (phase === "idle") target.set(Math.cos(t * 0.05) * 3.4, 0.25, Math.sin(t * 0.05) * 3.4);
    else if (phase === "approved") target.set(0, 0.95, 0);
    else if (phase === "rejected") target.set(0, -0.72, 0);
    else target.set(0, 0.2, 0);
    const k = reduced ? 1 : 1 - Math.pow(0.02, dt);
    m.position.lerp(target, k);
    m.rotation.y += dt * (phase === "judging" ? 2.6 : 0.6);
    m.rotation.x = Math.PI / 2 + Math.sin(t) * 0.15;
    const color = phase === "approved" ? APPROVE : phase === "rejected" ? REJECT : STAMP;
    mat.current.color.lerp(color, k);
    mat.current.emissive.lerp(color, k);
    mat.current.emissiveIntensity = phase === "judging" ? 0.5 + Math.sin(t * 6) * 0.25 : 0.25;
  });

  return (
    <mesh ref={ref} castShadow scale={phase === "idle" ? 1.6 : 2.6}>
      <cylinderGeometry args={[0.11, 0.11, 0.024, 48]} />
      <meshStandardMaterial ref={mat} metalness={0.6} roughness={0.25} color={STAMP} emissive={STAMP} />
    </mesh>
  );
}

function Validators({ phase }: { phase: ScenePhase }) {
  const group = useRef<THREE.Group>(null);
  const beams = useRef<THREE.Mesh[]>([]);
  const lenses = useRef<THREE.Group[]>([]);
  const reduced = useReducedMotion();
  const verdictColor = phase === "approved" ? APPROVE : phase === "rejected" ? REJECT : STAMP;

  useFrame((state, dt) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    const judging = phase === "judging";
    const radius = judging ? 1.9 : 2.25;
    lenses.current.forEach((lens, i) => {
      if (!lens) return;
      const a = (i / VALIDATORS) * Math.PI * 2 + t * (judging ? 0.5 : 0.12);
      const y = 0.25 + Math.sin(t * 0.7 + i * 1.3) * (judging ? 0.08 : 0.35);
      const k = reduced ? 1 : 1 - Math.pow(0.05, dt);
      lens.position.lerp(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius), k);
      lens.lookAt(0, 0.2, 0);
      const beam = beams.current[i];
      if (beam) {
        const on = judging || phase === "approved" || phase === "rejected";
        const mat = beam.material as THREE.MeshBasicMaterial;
        mat.opacity += ((on ? (judging ? 0.35 + 0.25 * Math.sin(t * 8 + i) : 0.18) : 0) - mat.opacity) * Math.min(1, dt * 6);
        mat.color.lerp(verdictColor, k);
        const p = lens.position;
        beam.position.set(p.x / 2, (p.y + 0.2) / 2, p.z / 2);
        beam.lookAt(0, 0.2, 0);
        beam.scale.set(1, 1, p.length());
      }
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: VALIDATORS }, (_, i) => (
        <group key={i}>
          <group ref={(el) => { if (el) lenses.current[i] = el; }}>
            <mesh>
              <torusGeometry args={[0.2, 0.035, 16, 48]} />
              <meshStandardMaterial color="#2B3FD4" metalness={0.8} roughness={0.2} />
            </mesh>
            <mesh>
              <circleGeometry args={[0.17, 32]} />
              <meshPhysicalMaterial color="#C9D8F2" transmission={0.9} roughness={0.05} thickness={0.2} />
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
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    // judging: lean in; verdict: half-step back so coin and chamber read together.
    const close = phase === "judging";
    const verdict = phase === "approved" || phase === "rejected";
    // On wide screens the copy sits on the left, so frame the chamber right of centre.
    const wide = state.size.width / state.size.height > 1.15;
    const shift = wide ? (close ? -1.25 : verdict ? -1.55 : -1.9) : 0;
    const px = state.pointer.x * 0.5;
    const py = state.pointer.y * 0.25;
    // Portrait screens: step back and aim low so the chamber sits above the copy.
    const portrait = state.size.width / state.size.height < 0.8;
    const back = portrait ? 1.65 : 1;
    const target = close
      ? new THREE.Vector3(px + 0.3, 1.05 + py, 5.4 * back)
      : verdict
        ? new THREE.Vector3(px + 0.2, 1.45 + py, 6.5 * back)
        : new THREE.Vector3(px + Math.sin(t * 0.05) * 0.4, 1.8 + py, 7.6 * back);
    state.camera.position.lerp(target, 0.03);
    // Keep the fog band relative to the camera distance so stepping back never hides the chamber.
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = 7 * back; fog.far = 15 * back; }
    look.lerp(new THREE.Vector3(shift, wide ? 0.25 : portrait ? -2.25 : -0.35, 0), 0.03);
    state.camera.lookAt(look);
  });
  return null;
}

export default function Chamber({ phase }: { phase: ScenePhase }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.9, 7.4], fov: 38 }} gl={{ antialias: true }}>
      <color attach="background" args={["#E8EDF1"]} />
      <fog attach="fog" args={["#E8EDF1", 7, 15]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 7, 3]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      {/* Local studio light (no network): soft panels for the glass to reflect. */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 5, -6]} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#dfe6ff" position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[6, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer form="ring" intensity={1.4} color="#2b3fd4" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={3} />
      </Environment>
      <Rig phase={phase} />
      <Float speed={1} rotationIntensity={0.05} floatIntensity={0.15}>
        <GlassChamber />
        <YourCoin phase={phase} />
      </Float>
      <Validators phase={phase} />
      <CoinCloud phase={phase} />
      <ContactShadows position={[0, -1.27, 0]} opacity={0.35} scale={14} blur={2.6} far={4} color="#18222D" />
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
