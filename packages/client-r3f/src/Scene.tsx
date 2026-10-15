import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, OrthographicCamera, SRGBColorSpace, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AgentView, BeliefTrack, RenderSnapshot, TacticalMap, Vec3 } from '../../ai-schema/src';

export type KnowledgeView = 'truth' | 'private' | 'squad';
type SceneProps = { map: TacticalMap; snapshot: RenderSnapshot; selected: AgentView; onSelect: (id: string) => void; knowledge: KnowledgeView; paths: boolean; cameraMode: 'isometric' | 'top'; };
const ALPHA = '#cced91';
const BRAVO = '#ee9972';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-error"><strong>3D view unavailable</strong><span>Your browser could not initialize WebGL. The live inspector and simulation controls remain available.</span></div> : this.props.children; }
}

function CameraRig({ map, mode }: { map: TacticalMap; mode: SceneProps['cameraMode'] }) {
  const { camera, gl, size } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controlsRef.current = controls;
    const cam = camera as OrthographicCamera;
    const maxSize = Math.max(map.width, map.depth);
    const target = new Vector3(0, 0, 0);
    cam.position.copy(target).add(mode === 'top' ? new Vector3(0, maxSize * 1.8, .01) : new Vector3(maxSize * .72, maxSize * 1.18, maxSize * .9));
    cam.zoom = Math.min(size.width / (maxSize * (mode === 'top' ? 1.15 : 1.48)), size.height / (maxSize * (mode === 'top' ? 1.2 : 1.22)));
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = .12;
    controls.enableRotate = mode !== 'top';
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minZoom = 3;
    controls.maxZoom = 45;
    controls.update();
    return () => { controls.dispose(); controlsRef.current = null; };
  }, [camera, gl.domElement, map.width, map.depth, mode, size.width, size.height]);
  useFrame(() => controlsRef.current?.update());
  return null;
}

function Label({ text, position, color = '#c3c7b8', size = 1.8 }: { text: string; position: [number, number, number]; color?: string; size?: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.font = '600 34px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = color; context.fillText(text, 256, 48);
    const value = new CanvasTexture(canvas); value.colorSpace = SRGBColorSpace;
    return value;
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={[size * 4, size * .75, 1]}><spriteMaterial map={texture} transparent depthTest={false} /></sprite>;
}

function Route({ points, color = ALPHA, opacity = .55, preserveHeight = false }: { points: Vec3[]; color?: string; opacity?: number; preserveHeight?: boolean }) {
  const object = useMemo(() => {
    const geometry = new BufferGeometry().setFromPoints(points.map(p => new Vector3(p.x, preserveHeight ? p.y : .12, p.z)));
    const material = new LineBasicMaterial({ color, transparent: true, opacity, depthTest: true });
    return new Line(geometry, material);
  }, [points, color, opacity, preserveHeight]);
  useEffect(() => () => { object.geometry.dispose(); object.material.dispose(); }, [object]);
  return <primitive object={object} />;
}

function MapGrid({ width, depth }: { width: number; depth: number }) {
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (let x = -width / 2; x <= width / 2; x++) points.push(x, .012, -depth / 2, x, .012, depth / 2);
    for (let z = -depth / 2; z <= depth / 2; z++) points.push(-width / 2, .012, z, width / 2, .012, z);
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(points, 3));
    return result;
  }, [width, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#a6ae93" transparent opacity={.23} /></lineSegments>;
}

function Agent({ agent, selected, select }: { agent: AgentView; selected: boolean; select: () => void }) {
  const group = useRef<Group>(null);
  const direction = useRef<Group>(null);
  const target = useMemo(() => new Vector3(), []);
  const fov = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, .075, 0, -5.8, .075, 8, 5.8, .075, 8], 3));
    return geometry;
  }, []);
  useEffect(() => () => fov.dispose(), [fov]);
  useEffect(() => { group.current?.position.set(agent.position.x, 0, agent.position.z); }, [agent.id]);
  useFrame((_, dt) => {
    if (!group.current || !direction.current) return;
    target.set(agent.position.x, 0, agent.position.z);
    group.current.position.lerp(target, 1 - Math.exp(-18 * Math.min(dt, .1)));
    const delta = Math.atan2(Math.sin(agent.yaw - direction.current.rotation.y), Math.cos(agent.yaw - direction.current.rotation.y));
    direction.current.rotation.y += delta * (1 - Math.exp(-20 * Math.min(dt, .1)));
  });
  const color = agent.team === 'alpha' ? ALPHA : BRAVO;
  return <group ref={group} onClick={event => { event.stopPropagation(); select(); }}>
    <mesh position={[0, agent.alive ? .63 : .17, 0]} castShadow scale={agent.alive ? 1 : .8}>
      <cylinderGeometry args={[.31, .42, agent.alive ? 1.1 : .22, 8]} /><meshStandardMaterial color={agent.alive ? color : '#69705c'} roughness={.65} />
    </mesh>
    {agent.alive && <mesh position={[0, 1.34, 0]} castShadow><sphereGeometry args={[.26, 10, 8]} /><meshStandardMaterial color={color} /></mesh>}
    <group ref={direction}>
      {agent.alive && <mesh position={[0, .8, .47]}><boxGeometry args={[.13, .13, .75]} /><meshStandardMaterial color="#2a3028" /></mesh>}
      {selected && agent.alive && <mesh geometry={fov}><meshBasicMaterial color={color} transparent opacity={.08} side={DoubleSide} depthWrite={false} /></mesh>}
    </group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .05, 0]}><ringGeometry args={[selected ? .7 : .48, selected ? .8 : .52, 32]} /><meshBasicMaterial color={color} transparent opacity={agent.alive ? 1 : .35} side={DoubleSide} /></mesh>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .04, 0]}><ringGeometry args={[1, 1.03, 40]} /><meshBasicMaterial color={color} transparent opacity={.4} side={DoubleSide} /></mesh>}
    <Label text={agent.callsign.toUpperCase()} position={[0, 2, 0]} color={selected ? '#f5f8df' : color} size={.68} />
  </group>;
}

function Belief({ track }: { track: BeliefTrack }) {
  const radius = Math.max(.65, Math.min(track.uncertaintyRadius, 8));
  const position: [number, number, number] = [track.meanPosition.x, .09, track.meanPosition.z];
  return <group position={position}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[radius, radius + .045, 48]} /><meshBasicMaterial color={BRAVO} opacity={Math.max(.2, track.confidence)} transparent side={DoubleSide} depthWrite={false} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[radius, 40]} /><meshBasicMaterial color={BRAVO} opacity={track.confidence * .07} transparent side={DoubleSide} depthWrite={false} /></mesh>
    <mesh position={[0, .45, 0]} rotation={[0, Math.PI / 4, 0]}><octahedronGeometry args={[.35]} /><meshBasicMaterial color={BRAVO} wireframe /></mesh>
    <Label text={`${Math.round(track.confidence * 100)}% · ${track.source.toUpperCase()}`} position={[0, 1.5, 0]} color={BRAVO} size={.7} />
  </group>;
}

export function Scene({ map, snapshot, selected, onSelect, knowledge, paths, cameraMode }: SceneProps) {
  const tracks = knowledge === 'squad' ? snapshot.sharedBeliefs[selected.team] : selected.beliefs;
  const enemies = tracks.filter(track => track.classification !== 'friendly' && track.confidence > .06);
  const agents = knowledge === 'truth' ? snapshot.agents : snapshot.agents.filter(agent => agent.team === selected.team);
  const recentShots = snapshot.events.filter(event => event.type === 'shot' && snapshot.tick - event.tick < 4 && event.position && event.endPosition && (knowledge === 'truth' || event.agentId === selected.id));
  return <SceneBoundary><Canvas orthographic shadows camera={{ position: [40, 60, 50], zoom: 11, near: .1, far: 400 }} dpr={[1, 1.7]} gl={{ antialias: true, alpha: true }} fallback={<div className="scene-error">WebGL is required for the tactical map.</div>}>
    <CameraRig map={map} mode={cameraMode} />
    <ambientLight intensity={1.25} />
    <directionalLight position={[-15, 40, -10]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-normalBias={.05} />
    <mesh position={[0, -.35, 0]} receiveShadow><boxGeometry args={[map.width + 1.4, .65, map.depth + 1.4]} /><meshStandardMaterial color="#575e4b" roughness={1} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]} receiveShadow><planeGeometry args={[map.width, map.depth]} /><meshStandardMaterial color="#747965" roughness={1} /></mesh>
    <MapGrid width={map.width} depth={map.depth} />
    {map.regions.map(region => <Label key={region.id} text={region.name.toUpperCase()} position={[region.center.x, .2, region.center.z]} size={1.3} color="#c1c7aa" />)}
    {map.obstacles.map(obstacle => <group key={obstacle.id} position={[obstacle.x, obstacle.height / 2, obstacle.z]}>
      <mesh castShadow receiveShadow><boxGeometry args={[obstacle.width, obstacle.height, obstacle.depth]} /><meshStandardMaterial color={obstacle.height > 1.6 ? '#363d33' : '#9a9d80'} roughness={.88} /></mesh>
      <mesh position={[0, obstacle.height / 2 + .01, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[Math.max(.1, obstacle.width - .12), Math.max(.1, obstacle.depth - .12)]} /><meshStandardMaterial color={obstacle.height > 1.6 ? '#4b5544' : '#acaf93'} roughness={.8} /></mesh>
    </group>)}
    {map.nodes.map(node => <mesh key={node.id} rotation={[-Math.PI / 2, 0, 0]} position={[node.position.x, .035, node.position.z]}><ringGeometry args={[.13, .2, 12]} /><meshBasicMaterial color={snapshot.reservations.some(r => r.resourceId === node.id) ? ALPHA : '#bcc1a3'} transparent opacity={.6} side={DoubleSide} /></mesh>)}
    <group position={[snapshot.objective.position.x, .06, snapshot.objective.position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.55, 2.6, 64]} /><meshBasicMaterial color="#e6e5b5" transparent opacity={.7} side={DoubleSide} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}><planeGeometry args={[1.1, 1.1]} /><meshBasicMaterial color="#e6e5b5" transparent opacity={.3} side={DoubleSide} /></mesh>
      <Label text="A" position={[0, 1, 0]} size={1.4} color="#faf0b8" />
    </group>
    {paths && agents.filter(agent => agent.alive && agent.path.length > 0).map(agent => <Route key={agent.id} points={[agent.position, ...agent.path]} color={agent.team === 'alpha' ? ALPHA : BRAVO} opacity={agent.id === selected.id ? .75 : .2} />)}
    {agents.map(agent => <Agent key={agent.id} agent={agent} selected={selected.id === agent.id} select={() => onSelect(agent.id)} />)}
    {knowledge !== 'truth' && enemies.map(track => <Belief key={track.id} track={track} />)}
    {recentShots.map(shot => <Route key={shot.id} points={[shot.position!, shot.endPosition!]} color="#fff4c1" opacity={.95} preserveHeight />)}
  </Canvas></SceneBoundary>;
}
