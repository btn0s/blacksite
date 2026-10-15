'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Group, Line, LineBasicMaterial, Vector3 } from 'three';
import type { AgentView, RenderSnapshot, TacticalMap, Vec3 } from '../../ai-schema/src';

export type WardenSceneProps = {
  map: TacticalMap;
  snapshot: RenderSnapshot;
  selectedAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
  showPaths?: boolean;
  /** Disable the debug floor and obstacle meshes when a host already renders its map. */
  showMap?: boolean;
};

const teamColor = (team: AgentView['team']) => team === 'alpha' ? '#c6e992' : '#ed9771';

function Route({ points, color, ground = false }: { points: Vec3[]; color: string; ground?: boolean }) {
  const line = useMemo(() => new Line(
    new BufferGeometry().setFromPoints(points.map(point => new Vector3(point.x, ground ? .08 : point.y, point.z))),
    new LineBasicMaterial({ color, transparent: true, opacity: .55, depthTest: true }),
  ), [points, color, ground]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  return <primitive object={line} />;
}

function AgentMarker({ agent, selected, onSelect }: { agent: AgentView; selected: boolean; onSelect?: (id: string) => void }) {
  const position = useRef<Group>(null);
  const facing = useRef<Group>(null);
  const target = useMemo(() => new Vector3(), []);
  useEffect(() => {
    position.current?.position.set(agent.position.x, agent.position.y, agent.position.z);
    if (facing.current) facing.current.rotation.y = agent.yaw;
  }, [agent.id]);
  useFrame((_, dt) => {
    if (!position.current || !facing.current) return;
    target.set(agent.position.x, agent.position.y, agent.position.z);
    const blend = 1 - Math.exp(-20 * Math.min(.1, dt));
    position.current.position.lerp(target, blend);
    const delta = Math.atan2(Math.sin(agent.yaw - facing.current.rotation.y), Math.cos(agent.yaw - facing.current.rotation.y));
    facing.current.rotation.y += delta * blend;
  });
  const color = agent.alive ? teamColor(agent.team) : '#68705e';
  return <group ref={position} onClick={event => { if (onSelect) { event.stopPropagation(); onSelect(agent.id); } }}>
    <mesh position={[0, agent.alive ? .7 : .15, 0]} castShadow>
      <cylinderGeometry args={[.3, .4, agent.alive ? 1.3 : .25, 10]} />
      <meshStandardMaterial color={color} roughness={.8} />
    </mesh>
    <group ref={facing}>
      {agent.alive && <mesh position={[0, 1, .65]}><boxGeometry args={[.16, .16, 1]} /><meshStandardMaterial color={color} /></mesh>}
    </group>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .04, 0]}>
      <ringGeometry args={[.65, .8, 24]} /><meshBasicMaterial color={color} side={DoubleSide} />
    </mesh>}
  </group>;
}

/**
 * Debug/research truth view: renders every authoritative agent, including hidden enemies.
 * Mount INSIDE your Canvas. Owns no Canvas, camera, light, renderer, controls or global CSS.
 * The host owns camera framing and lighting. Map coordinates are centered on the X/Z plane.
 */
export function WardenScene({ map, snapshot, selectedAgentId, onSelectAgent, showPaths = false, showMap = true }: WardenSceneProps) {
  return <group>
    {showMap && <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]} receiveShadow>
        <planeGeometry args={[map.width, map.depth]} /><meshStandardMaterial color="#525b47" roughness={1} />
      </mesh>
      {map.obstacles.map(obstacle => <mesh key={obstacle.id} position={[obstacle.x, obstacle.height / 2, obstacle.z]} castShadow receiveShadow>
        <boxGeometry args={[obstacle.width, obstacle.height, obstacle.depth]} /><meshStandardMaterial color="#384133" roughness={.9} />
      </mesh>)}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[snapshot.objective.position.x, .04, snapshot.objective.position.z]}>
        <ringGeometry args={[2.2, 2.4, 48]} /><meshBasicMaterial color="#f2db9b" side={DoubleSide} />
      </mesh>
    </>}
    {showPaths && snapshot.agents.filter(agent => agent.alive && agent.path.length > 0).map(agent =>
      <Route key={agent.id} points={[agent.position, ...agent.path]} color={teamColor(agent.team)} ground />)}
    {snapshot.agents.map(agent => <AgentMarker key={`${snapshot.seed}:${map.id}:${agent.id}`} agent={agent} selected={agent.id === selectedAgentId} onSelect={onSelectAgent} />)}
    {snapshot.events.filter(event => event.type === 'shot' && snapshot.tick - event.tick < 4 && event.position && event.endPosition).map(event =>
      <Route key={event.id} points={[event.position!, event.endPosition!]} color="#fff1be" />)}
  </group>;
}
