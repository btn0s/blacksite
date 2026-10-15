'use client';

import { useState, type CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { WardenScene } from './scene';
import { useWarden, type UseWardenOptions } from './use-warden';

export type WardenDemoProps = UseWardenOptions & {
  className?: string;
  style?: CSSProperties;
};

const buttonStyle: CSSProperties = { border: '1px solid #697656', borderRadius: 4, padding: '7px 12px', background: '#d2edab', color: '#1e2817', cursor: 'pointer', font: 'inherit' };

/** Optional standalone local demo. Unlike WardenScene, this component owns its Canvas. */
export function WardenDemo({ className, style, ...options }: WardenDemoProps) {
  const session = useWarden(options);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const ready = !!session.snapshot && session.status !== 'loading' && session.status !== 'error';
  const selected = session.snapshot?.agents.find(agent => agent.id === selectedAgentId);
  const extent = Math.max(session.map?.width ?? 48, session.map?.depth ?? 36);
  const exportReplay = async () => {
    setExportError(''); setExporting(true);
    try {
      const replay = await session.exportReplay();
      const url = URL.createObjectURL(new Blob([JSON.stringify(replay)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `warden-${replay.config.scenarioId}-${replay.config.seed}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setExportError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };
  return <section className={className} aria-label="Warden local AI demo" style={{ background: '#172014', color: '#e6eddf', borderRadius: 8, padding: 16, fontFamily: 'system-ui, sans-serif', ...style }}>
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: '1 1 220px' }}><strong>Warden</strong><div style={{ fontSize: 12, marginTop: 4, color: '#b1c3a0' }}>Local AI research demo · truth view includes hidden enemies</div></div>
      <button style={buttonStyle} disabled={!ready || session.status === 'complete'} onClick={() => session.status === 'running' ? session.pause() : session.play()}>{session.status === 'running' ? 'Pause' : 'Play'}</button>
      <button style={buttonStyle} disabled={!ready || session.status === 'complete'} onClick={() => session.step()}>Step</button>
      <button style={buttonStyle} onClick={() => session.reset()}>Reset</button>
      <button style={buttonStyle} disabled={!ready || exporting} onClick={exportReplay}>{exporting ? 'Exporting…' : 'Export replay'}</button>
    </header>
    {(session.error || exportError) && <p role="alert" style={{ color: '#ffb8a7' }}>{session.error || exportError}</p>}
    <div style={{ height: 'min(58vh, 560px)', minHeight: 260, marginTop: 14, borderRadius: 4, overflow: 'hidden' }}>
      {session.snapshot && session.map ? <Canvas key={session.map.id} camera={{ position: [extent * .65, extent * 1.05, extent * .9], fov: 43, near: .1, far: extent * 8 }} dpr={[1, 1.5]} onCreated={({ camera }) => camera.lookAt(0, 0, 0)} fallback={<p>WebGL is unavailable. Simulation controls still work.</p>}>
        <ambientLight intensity={1.4} /><directionalLight position={[-15, 35, 10]} intensity={2} />
        <WardenScene map={session.map} snapshot={session.snapshot} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} showPaths />
      </Canvas> : <p role="status">{session.status === 'error' ? 'Reset to retry the simulation.' : 'Starting simulation worker…'}</p>}
    </div>
    <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, marginTop: 12, color: '#b1c3a0' }}>
      <span>{session.map?.name ?? 'Loading map'} · tick {session.snapshot?.tick ?? 0} · {session.status}</span>
      {session.snapshot?.winner && <span>Result: {session.snapshot.winner}</span>}
      <span>{selected ? `${selected.callsign} · ${selected.role} · ${selected.execution.skill} · ${selected.health} health` : 'Select an agent to inspect its role and active skill.'}</span>
    </footer>
  </section>;
}
