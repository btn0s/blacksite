import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, AudioLines, ChevronDown, ChevronRight, CircleHelp, Crosshair, Eye, Focus, Layers3, MoveUpRight, Pause, Play, Radio, RotateCcw, ScanLine, ShieldCheck, SkipForward, Target, Terminal, Users, X } from 'lucide-react';
import { DEFAULT_CONFIG, TICK_RATE, type AgentView, type BeliefTrack, type RenderSnapshot, type RuntimeConfig, type ScenarioId, type TacticalMap, type TeamId, type WatchSector, type WorkerRequest, type WorkerResponse } from '../../ai-schema/src';
import { Scene, type KnowledgeView } from './Scene';
import type { RootState } from '@react-three/fiber';

const SCENARIOS: { id: ScenarioId; name: string; geography: string; detail: string }[] = [
  { id: 'crossfire', name: 'Courtyard crossfire', geography: 'Offset buildings · open relay court', detail: 'Coordinate approaches through offset foundry buildings around an open relay courtyard. Establish support and cover the flanks.' },
  { id: 'breach', name: 'Vestibule breach', geography: 'Offset vestibule · enclosed relay room', detail: 'Enter an offset vestibule from west staging, clear the enclosed relay room, and cover its back and service exits.' },
  { id: 'search', name: 'Chamber search', geography: '12 connected chambers · staggered doors', detail: 'Search twelve connected chambers through staggered doorways. Use local evidence to clear room-sized spaces.' },
  { id: 'casualty', name: 'Casualty recovery', geography: 'Protected recovery pocket · switchbacks', detail: 'Reach a protected recovery pocket through alternating barricades. Adapt squad roles to a casualty and constrained approaches.' },
  { id: 'low-ammo', name: 'Warehouse / low ammo', geography: 'Rack aisles · offset endcaps', detail: 'Manage scarce ammunition in horizontal warehouse rack aisles with offset endcaps and short intersections.' },
  { id: 'deadlock', name: 'Dogleg passage', geography: '1.3 m entry · S-bend · service reroutes', detail: 'Resolve a single-file 1.3 m entry and S-bend connector, with north and south service reroutes available.' },
];
const clock = (tick: number) => `${Math.floor(tick / TICK_RATE / 60).toString().padStart(2, '0')}:${Math.floor(tick / TICK_RATE % 60).toString().padStart(2, '0')}`;
const title = (text: string) => text.replaceAll('-', ' ').replaceAll('_', ' ');
const percent = (value: number) => `${Math.round(value * 100)}%`;

function Meter({ value, max = 1, className = '' }: { value: number; max?: number; className?: string }) {
  return <span className={`meter ${className}`}><span style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} /></span>;
}
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Field({ name, children }: { name: string; children: ReactNode }) { return <div className="field"><span>{name}</span><strong>{children}</strong></div>; }
function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) { return <div className="empty-state">{icon}<p>{children}</p></div>; }

function BeliefCard({ track, tick }: { track: BeliefTrack; tick: number }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="belief-card">
    <button className="belief-card-top" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
      <span className="contact-dot" /><span><strong>{track.subjectId || 'Unidentified contact'}</strong><small>{track.source} · {((tick - track.lastObservedAt) / TICK_RATE).toFixed(1)}s ago</small></span><b>{percent(track.confidence)}</b><ChevronDown size={13} className={expanded ? 'rotated' : ''} />
    </button>
    <Meter value={track.confidence} className="orange" />
    <div className="belief-summary"><span>± {track.uncertaintyRadius.toFixed(1)} m uncertainty</span><span>{track.classification}</span></div>
    {expanded && <div className="belief-detail"><Field name="Estimated X / Z">{track.meanPosition.x.toFixed(1)} / {track.meanPosition.z.toFixed(1)}</Field><Field name="Observed / received">{track.lastObservedAt} / {track.receivedAt}</Field><Field name="Expires at tick">{track.expiresAt}</Field><span className="eyebrow">Evidence chain</span><code>{track.provenance.join(' → ') || track.provenanceId}</code></div>}
  </div>;
}

type RegroupSignal = { leadId: string; status: 'waiting' | 'ready' | 'replan'; detail: string };
function parseRegroup(value: string): RegroupSignal | undefined {
  const [kind, leadId, status, ...detail] = value.split(':');
  if (kind !== 'regroup' || !leadId) return;
  if (status !== 'waiting' && status !== 'ready' && status !== 'replan') return;
  return { leadId, status, detail: detail.join(':') };
}

function CoordinationStatus({ agent, snapshot, constraints }: { agent: AgentView; snapshot: RenderSnapshot; constraints: string[] }) {
  const signals = constraints.flatMap(value => { const signal = parseRegroup(value); return signal ? [signal] : []; });
  const signal = signals.find(value => value.leadId === agent.id)
    ?? signals.find(value => value.status !== 'replan' && value.detail === agent.id);
  const callsign = (id: string) => snapshot.agents.find(value => value.id === id)?.callsign ?? id;
  if (signal) {
    const lead = callsign(signal.leadId);
    const buddy = callsign(signal.detail);
    const isLead = signal.leadId === agent.id;
    const heading = signal.status === 'ready' ? 'Entry support ready'
      : signal.status === 'replan' ? 'Regroup needs a new plan'
      : isLead ? `Waiting for ${buddy}` : `Regroup with ${lead}`;
    const explanation = signal.status === 'ready' ? `${lead} and ${buddy} are paired for the next entry.`
      : signal.status === 'replan' ? `Reason: ${title(signal.detail || 'readiness changed')}.`
      : 'Meet at the staging point before advancing into the next sector.';
    return <div className={`coordination-status ${signal.status}`}><Users size={14} /><div><strong>{heading}</strong><p>{explanation}</p></div></div>;
  }
  if (agent.execution.skill === 'yield') return <div className="coordination-status waiting"><Users size={14} /><div><strong>Yielding the passage</strong><p>Giving way before continuing the plan.</p></div></div>;
  return null;
}

function SectorWatchStatus({ watch, snapshot }: { watch: WatchSector; snapshot: RenderSnapshot }) {
  if (watch.issuedAt > snapshot.tick || watch.expiresAt <= snapshot.tick) return null;
  const casualty = snapshot.agents.find(agent => agent.id === watch.casualtyId)?.callsign ?? watch.casualtyId;
  const secondsLeft = Math.ceil((watch.expiresAt - snapshot.tick) / TICK_RATE);
  return <div className="coordination-status"><Eye size={14} /><div><strong>Covering {casualty}’s lane</strong><p>{watch.source === 'radio' ? 'Watching the reported sector' : 'Watching the lane after a squad casualty'} · {secondsLeft}s left.</p></div></div>;
}

function Inspector({ agent, snapshot }: { agent: AgentView; snapshot: RenderSnapshot }) {
  const [tab, setTab] = useState<'state' | 'beliefs' | 'decisions'>('state');
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const squad = snapshot.squads.find(squad => squad.team === agent.team);
  const assignment = squad?.assignments.find(assignment => assignment.agentId === agent.id);
  const beliefs = agent.beliefs.filter(track => track.classification !== 'friendly');
  const candidates = agent.trace?.candidates ?? [];
  const maxScore = Math.max(1, ...candidates.map(candidate => Math.abs(candidate.score ?? 0)));
  return <aside className="inspector panel">
    <div className="panel-heading"><span><ScanLine size={14} /> Agent inspector</span><span className="tiny-label">LIVE</span></div>
    <div className="agent-identity"><div className={`identity-icon ${agent.team}`}><Crosshair size={24} strokeWidth={1.4} /></div><div><span className="eyebrow">{agent.team} / {agent.role}</span><h2>{agent.callsign}</h2></div><span className={`status-dot ${agent.alive ? '' : 'inactive'}`} /></div>
    <div className="inspector-tabs" role="tablist" aria-label="Agent inspection"><button role="tab" aria-selected={tab === 'state'} onClick={() => setTab('state')}>State</button><button role="tab" aria-selected={tab === 'beliefs'} onClick={() => setTab('beliefs')}>Beliefs <span>{beliefs.length}</span></button><button role="tab" aria-selected={tab === 'decisions'} onClick={() => setTab('decisions')}>Decisions</button></div>
    <div className="inspector-content">
      {tab === 'state' && <>
        <section className="inspector-section"><div className="section-label"><span>ACTIVE INTENT</span><span className="lime-dot" /></div><h3 className="intent-title">{agent.alive ? title(agent.plan?.goal ?? 'Observe & orient') : 'Incapacitated'}</h3><p className="muted">{agent.plan ? `${agent.plan.actions.length} action${agent.plan.actions.length === 1 ? '' : 's'} in committed plan` : 'Awaiting the next deliberation cycle'}</p><div className="skill-state"><span><span className="pulse-square" />{title(agent.execution.skill)}</span><code>{agent.execution.state}</code></div><Meter value={agent.execution.progress} /><div className="skill-progress"><span>Skill progress</span><span>{percent(agent.execution.progress)}</span></div>{agent.execution.interrupt && <p className="notice">Interrupt: {agent.execution.interrupt}</p>}</section>
        <section className="inspector-section"><div className="section-label"><span>SQUAD COMMITMENT</span><Users size={12} /></div><CoordinationStatus agent={agent} snapshot={snapshot} constraints={squad?.constraints ?? []} />{agent.alive && assignment?.watchSector && <SectorWatchStatus watch={assignment.watchSector} snapshot={snapshot} />}<Field name="Maneuver">{squad ? title(squad.kind) : 'Awaiting orders'}</Field><Field name="Phase">{squad?.phase ?? '—'}</Field><Field name="Assignment">{assignment?.slotId ?? 'Unassigned'}</Field><Field name="Support">{squad?.supportReady ? <span className="lime-text">Ready</span> : 'Establishing'}</Field>{squad?.constraints.slice(0, 2).map(constraint => <div className="constraint" key={constraint}><ShieldCheck size={12} /><span>{title(constraint)}</span></div>)}{squad && squad.constraints.length > 2 && <details className="constraint-details"><summary>All commitments <span>{squad.constraints.length}</span></summary>{squad.constraints.map(constraint => <code key={constraint}>{constraint}</code>)}</details>}</section>
        <section className="inspector-section"><div className="section-label"><span>MOTOR & FIRE CONTROL</span><Crosshair size={12} /></div><Field name="Fire gate">{title(agent.fireGate)}</Field><Field name="Stance">{agent.stance}</Field><Field name="Suppression">{percent(agent.suppression)}</Field><Field name="Policy">Symbolic fallback</Field><p className="policy-note">{title(agent.policyFallback || 'Deterministic controller active')}</p></section>
      </>}
      {tab === 'beliefs' && <><section className="inspector-section"><div className="section-label"><span>PRIVATE KNOWLEDGE</span><Eye size={12} /></div><p className="muted">Only sensed or received evidence. Confidence decays and uncertainty grows out of view.</p></section><div className="belief-list">{beliefs.length ? beliefs.map(track => <BeliefCard key={track.id} track={track} tick={snapshot.tick} />) : <Empty icon={<Eye size={26} strokeWidth={1} />}>No enemy evidence yet.<br />Unseen does not mean clear.</Empty>}</div><section className="inspector-section"><div className="section-label"><span>SQUAD COMMON PICTURE</span><Radio size={12} /></div><Field name="Shared tracks">{snapshot.sharedBeliefs[agent.team].length}</Field><Field name="Radio messages in flight">{snapshot.metrics.pendingMessages}</Field><p className="muted">Shared evidence arrives after the configured radio delay.</p></section></>}
      {tab === 'decisions' && <><section className="inspector-section"><div className="section-label"><span>LAST DELIBERATION</span><span>#{agent.trace?.tick ?? '—'}</span></div><h3 className="intent-title">{title(agent.trace?.selected ?? 'Awaiting decision')}</h3><Field name="Belief version">{agent.trace?.beliefVersion ?? '—'}</Field><Field name="Search budget">{agent.trace?.deadline ?? '—'}</Field><Field name="Evidence sources">{agent.trace?.observationProvenance.length ?? 0}</Field></section><section className="inspector-section"><div className="section-label"><span>CANDIDATE UTILITY</span><span>{candidates.length} OPTIONS</span></div>{candidates.length ? (showAllCandidates ? candidates : candidates.slice(0, 12)).map(candidate => <details className={`candidate ${candidate.applicable ? '' : 'rejected'}`} key={candidate.id}><summary><div><span>{candidate.id.startsWith('slot:') ? candidate.id.replace(/^slot:/, '') : title(candidate.id)}</span><strong>{candidate.applicable ? candidate.score?.toFixed(2) ?? '—' : 'Rejected'}</strong></div><Meter value={Math.max(0, candidate.score ?? 0)} max={maxScore} /></summary>{candidate.rejectReason && <p>{candidate.rejectReason}</p>}{Object.entries(candidate.terms ?? {}).map(([name, value]) => <Field name={title(name)} key={name}>{value.toFixed(3)}</Field>)}</details>) : <p className="muted">Start or step the simulation to inspect scored alternatives.</p>}{candidates.length > 12 && <button className="show-candidates" onClick={() => setShowAllCandidates(value => !value)}>{showAllCandidates ? 'Show top 12 candidates' : `Show all ${candidates.length} candidates`}<ChevronDown size={11} /></button>}</section><section className="inspector-section"><div className="section-label"><span>PROVENANCE</span><ShieldCheck size={12} /></div><code className="provenance-code">{agent.trace?.observationProvenance.join('\n') || 'No tactical evidence consumed yet.'}</code></section></>}
    </div>
    <div className="inspector-footer"><span className="lime-dot" /> Immutable decision snapshots <ShieldCheck size={13} /></div>
  </aside>;
}

function Performance({ values, snapshot }: { values: number[]; snapshot?: RenderSnapshot }) {
  const ceiling = Math.max(8, ...values);
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * 230},${37 - Math.min(1, value / ceiling) * 32}`).join(' ');
  return <div className="performance-card"><div><span className="eyebrow">AI + SIMULATION / P99</span><strong>{snapshot?.metrics.p99.toFixed(2) ?? '—'}<small>ms</small></strong><span className="performance-caption">Measured worker tick time</span></div><svg viewBox="0 0 230 45" aria-label="Recent simulation tick durations" role="img"><path d="M0 38H230" stroke="#3c4437" strokeDasharray="2 5" />{values.length > 1 && <polyline points={points} fill="none" stroke="#c4e592" strokeWidth="1.7" />}</svg></div>;
}

export function App({ onCreated }: { onCreated?: (state: RootState) => void } = {}) {
  const worker = useRef<Worker | null>(null);
  const [snapshot, setSnapshot] = useState<RenderSnapshot>();
  const [map, setMap] = useState<TacticalMap>();
  const [config, setConfig] = useState<RuntimeConfig>({ ...DEFAULT_CONFIG });
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_CONFIG.seed));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [team, setTeam] = useState<TeamId>('alpha');
  const [knowledge, setKnowledge] = useState<KnowledgeView>('truth');
  const [cameraMode, setCameraMode] = useState<'isometric' | 'top'>('isometric');
  const [paths, setPaths] = useState(true);
  const [history, setHistory] = useState<number[]>([]);
  const [help, setHelp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const helpDialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!help) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    helpDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setHelp(false); event.stopPropagation(); }
      if (event.key !== 'Tab') return;
      const buttons = helpDialog.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [help]);
  const [eventFilter, setEventFilter] = useState<'all' | 'radio' | 'decisions'>('all');
  const post = useCallback((message: WorkerRequest) => worker.current?.postMessage(message), []);
  useEffect(() => {
    const instance = new Worker(new URL('../../ai-worker/src/worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        setSnapshot(message.snapshot); setMap(message.map);
        setHistory(values => message.snapshot.tick === 0 ? [] : [...values.slice(-59), message.snapshot.metrics.tickMs]);
        if (message.snapshot.status === 'complete') setPlaying(false);
      } else if (message.type === 'error') { setError(message.message); setPlaying(false); setExporting(false); }
      else if (message.type === 'replay') {
        const blob = new Blob([JSON.stringify(message.replay, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `warden-${message.replay.config.scenarioId}-${message.replay.config.seed}.json`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setExporting(false);
      }
    };
    instance.onerror = event => { setError(event.message || 'The simulation worker stopped unexpectedly. Reset to retry.'); setPlaying(false); };
    instance.postMessage({ type: 'init', config: DEFAULT_CONFIG } satisfies WorkerRequest);
    return () => { instance.postMessage({ type: 'dispose' } satisfies WorkerRequest); instance.terminate(); worker.current = null; };
  }, []);
  const reset = useCallback((next: RuntimeConfig = config) => {
    setConfig(next); setSeedDraft(String(next.seed)); setPlaying(false); setError(''); setHistory([]); post({ type: 'init', config: next });
  }, [config, post]);
  const togglePlay = useCallback(() => {
    if (!snapshot || snapshot.status === 'complete') return;
    if (playing) { post({ type: 'pause' }); setPlaying(false); } else { post({ type: 'play', speed }); setPlaying(true); }
  }, [playing, snapshot, speed, post]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight' && !playing) { event.preventDefault(); post({ type: 'step', count: 1 }); }
      if (event.key.toLowerCase() === 'r') reset();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, playing, post, reset]);
  const selected = snapshot?.agents.find(agent => agent.id === selectedId) ?? snapshot?.agents.find(agent => agent.team === team) ?? snapshot?.agents[0];
  const squad = snapshot?.squads.find(squad => squad.team === team);
  const scenario = SCENARIOS.find(scenario => scenario.id === config.scenarioId)!;
  const selectAgent = (id: string) => { setSelectedId(id); const agent = snapshot?.agents.find(agent => agent.id === id); if (agent) setTeam(agent.team); };
  const setTeamView = (next: TeamId) => { setTeam(next); setSelectedId(snapshot?.agents.find(agent => agent.team === next)?.id ?? ''); };
  const events = (snapshot?.events ?? []).filter(event => eventFilter === 'all' || (eventFilter === 'radio' ? event.type === 'radio' || event.type === 'contact' : ['order', 'interrupt', 'fallback', 'objective'].includes(event.type))).slice(-40).reverse();
  return <div className="app-shell">
    <header className="masthead"><a href="#" className="brand" aria-label="Warden home"><span className="brand-symbol"><i /><i /><i /></span><span>WARDEN<span className="brand-sub">TACTICAL INTELLIGENCE LAB</span></span></a><div className="masthead-center"><span className="lime-dot" /> Local authority <span className="header-divider" /> Deterministic simulation</div><div className="masthead-actions"><Badge>RESEARCH BUILD <span>01</span></Badge><button className="icon-button" onClick={() => setHelp(true)} title="About this lab" aria-label="About this lab"><CircleHelp size={18} /></button></div></header>
    <main>
      <section className="intro"><div><div className="eyebrow intro-eyebrow"><span className="mini-cross">+</span> OBSERVE. UNDERSTAND. ITERATE.</div><h1>Intelligence in action<span>.</span></h1><p>A window into what your squad sees, believes, and decides.</p></div><div className="intro-meta"><span className="eyebrow">ACTIVE ARCHITECTURE</span><div><span className="architecture-bars"><i /><i /><i /><i /></span> Hierarchical · Symbolic</div><span>Belief-driven. Every decision traceable.</span></div></section>
      <section className="control-bar" aria-label="Simulation controls"><div className="scenario-control" title={scenario.detail}><label htmlFor="scenario">SCENARIO</label><div className="select-wrap"><select id="scenario" value={config.scenarioId} onChange={event => reset({ ...config, scenarioId: event.target.value as ScenarioId })}>{SCENARIOS.map((scenario, index) => <option key={scenario.id} value={scenario.id}>{String(index + 1).padStart(2, '0')} / {scenario.name}</option>)}</select><ChevronDown size={13} /></div></div><div className="seed-control"><label htmlFor="seed">SEED</label><input id="seed" type="number" min="0" max="4294967295" value={seedDraft} onChange={event => setSeedDraft(event.target.value)} onBlur={() => { const seed = Number(seedDraft); if (seedDraft !== '' && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295 && seed !== config.seed) reset({ ...config, seed }); else setSeedDraft(String(config.seed)); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div><span className="control-divider" /><div className="transport"><button className={`play-button ${playing ? 'playing' : ''}`} disabled={!snapshot || snapshot.status === 'complete' || !!error} onClick={togglePlay}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{playing ? 'Pause' : 'Run simulation'}</button><button className="icon-button" disabled={!snapshot || playing || snapshot.status === 'complete'} onClick={() => post({ type: 'step', count: 1 })} title="Advance one tick (→)" aria-label="Advance one tick"><SkipForward size={16} /></button><button className="icon-button" onClick={() => reset()} title="Reset simulation (R)" aria-label="Reset simulation"><RotateCcw size={16} /></button></div><div className="speed-control"><label className="sr-only" htmlFor="speed">Simulation speed</label><select id="speed" value={speed} onChange={event => { const next = Number(event.target.value); setSpeed(next); if (playing) post({ type: 'play', speed: next }); }}><option value={.5}>0.5× speed</option><option value={1}>1× speed</option><option value={2}>2× speed</option><option value={4}>4× speed</option></select></div><div className="clock"><strong>{clock(snapshot?.tick ?? 0)}</strong><span>TICK {String(snapshot?.tick ?? 0).padStart(5, '0')}</span></div><button className="export-button" aria-label="Export replay" title="Export replay" disabled={!snapshot || exporting} onClick={() => { setExporting(true); post({ type: 'export' }); }}><ArrowDownToLine size={15} /><span>{exporting ? 'Exporting…' : 'Export replay'}</span></button></section>
      {error && <div className="error-banner" role="alert"><strong>Simulation interrupted</strong><span>{error}</span><button onClick={() => reset()}>Reset simulation</button></div>}
      <div className="workspace">
        <aside className="squad-panel panel"><div className="panel-heading"><span><Users size={14} /> Squad overview</span><span className="tiny-label">{config.agentsPerTeam}v{config.agentsPerTeam}</span></div><div className="team-tabs"><button className={team === 'alpha' ? 'active alpha' : ''} onClick={() => setTeamView('alpha')}><span /> ALPHA <b>{snapshot?.agents.filter(agent => agent.team === 'alpha' && agent.alive).length ?? config.agentsPerTeam}</b></button><button className={team === 'bravo' ? 'active bravo' : ''} onClick={() => setTeamView('bravo')}><span /> BRAVO <b>{snapshot?.agents.filter(agent => agent.team === 'bravo' && agent.alive).length ?? config.agentsPerTeam}</b></button></div><div className="squad-order"><span className="eyebrow">STRATEGIC ORDER</span><div><MoveUpRight size={20} /><h3>{squad ? title(squad.order.posture) : 'Awaiting orders'}</h3></div><p>{squad ? `${title(squad.kind)} · ${squad.phase}` : 'Initialize squad commitments'}</p><div className="order-meta"><span>OBJECTIVE A</span><span>{squad ? `TEMPO ${percent(squad.order.tempo)}` : 'READY'}</span></div></div><div className="roster-label"><span>PERSONNEL</span><span>HP / AMMO</span></div><div className="roster">{snapshot?.agents.filter(agent => agent.team === team).map((agent, index) => <button className={`agent-row ${selected?.id === agent.id ? 'selected' : ''} ${agent.alive ? '' : 'dead'} ${agent.team}`} key={agent.id} onClick={() => selectAgent(agent.id)} aria-pressed={selected?.id === agent.id}><span className="agent-number">{String(index + 1).padStart(2, '0')}</span><span className="agent-row-body"><span className="agent-name">{agent.callsign}<ChevronRight size={12} /></span><span className="agent-role">{agent.alive ? agent.role : 'Incapacitated'}</span><Meter value={agent.health} max={100} /></span><span className="agent-vitals"><strong>{Math.round(agent.health)}</strong><span>{agent.ammo}<small> / {agent.reserveAmmo}</small></span></span></button>) ?? <Empty icon={<Users size={24} />}>Preparing squad…</Empty>}</div><div className="squad-footer"><Radio size={14} /><span>Radio latency</span><strong>{Math.round(config.radioLatencyTicks / TICK_RATE * 1000)} ms</strong></div><div className="squad-principle"><ShieldCheck size={17} /><p>Fair by architecture.<br /><span>No access to unseen enemies.</span></p></div></aside>
        <section className="map-panel panel"><div className="map-heading"><div><span className={`status-dot ${playing ? '' : 'idle'}`} /><strong>{map?.name ?? 'Preparing tactical map'}</strong><span className="map-mode">TACTICAL VIEW</span></div><span className="map-status">{snapshot?.status === 'complete' ? 'ROUND COMPLETE' : playing ? 'SIMULATION LIVE' : 'SIMULATION PAUSED'}</span></div><div className="map-canvas">{snapshot && map && selected ? <Scene onCreated={onCreated} map={map} snapshot={snapshot} selected={selected} onSelect={selectAgent} knowledge={knowledge} paths={paths} cameraMode={cameraMode} /> : <div className="map-loading"><span className="loading-mark"><Crosshair size={36} strokeWidth={1} /></span><strong>Preparing the field</strong><span>Loading deterministic simulation worker…</span></div>}<div className="map-coordinate"><span>{map?.name.toUpperCase() ?? 'TACTICAL MAP'}</span><span>{map ? `${map.width} × ${map.depth} M · ${map.regions.length} REGIONS` : '—'}</span><span className="map-geography">{scenario.geography}</span></div><div className="north-mark">N<span>↑</span></div><div className="map-legend"><span><i className="legend-alpha" /> ALPHA</span><span><i className="legend-bravo" /> {knowledge === 'truth' ? 'BRAVO' : 'BELIEF'}</span><span><i className="legend-objective" /> OBJECTIVE</span></div><div className="map-view-tools"><button className={paths ? 'active' : ''} onClick={() => setPaths(value => !value)} title="Toggle planned routes" aria-label="Toggle planned routes" aria-pressed={paths}><Layers3 size={16} /></button><button className={cameraMode === 'top' ? 'active' : ''} onClick={() => setCameraMode(value => value === 'top' ? 'isometric' : 'top')} title="Switch top-down / isometric" aria-label="Switch top-down or isometric view"><Focus size={16} /></button></div>{snapshot?.status === 'complete' && <div className="round-complete"><Target size={23} /><strong>{snapshot.winner === 'draw' ? 'Round drawn' : `${snapshot.winner?.toUpperCase()} takes the round`}</strong><span>Inspect the final state or reset to run again.</span><button onClick={() => reset()}><RotateCcw size={13} /> Replay scenario</button></div>}</div><div className="map-bottom"><div className="knowledge-switch" aria-label="Knowledge view"><Eye size={13} /><button className={knowledge === 'truth' ? 'active' : ''} onClick={() => setKnowledge('truth')}>Truth</button><button className={knowledge === 'private' ? 'active' : ''} onClick={() => setKnowledge('private')}>Private belief</button><button className={knowledge === 'squad' ? 'active' : ''} onClick={() => setKnowledge('squad')}>Shared picture</button></div><span className="map-hint">{knowledge === 'truth' ? 'Debug view · hidden truth shown' : `${selected?.callsign ?? 'Agent'} · evidence only`}</span></div></section>
        {selected && snapshot ? <Inspector agent={selected} snapshot={snapshot} /> : <aside className="inspector panel"><div className="panel-heading"><span><ScanLine size={14} /> Agent inspector</span></div><Empty icon={<Crosshair size={28} />}>Select an agent to inspect its decisions.</Empty></aside>}
      </div>
      <section className="telemetry-strip" aria-label="Runtime telemetry"><Performance values={history} snapshot={snapshot} /><div className="telemetry-stat"><span className="eyebrow"><Activity size={12} /> DELIBERATIONS</span><strong>{snapshot?.metrics.decisions.toLocaleString() ?? '0'}</strong><span>Bounded planner decisions</span></div><div className="telemetry-stat"><span className="eyebrow"><Target size={12} /> RESERVATIONS</span><strong>{snapshot?.metrics.activeReservations ?? 0}<small>active</small></strong><span>Exclusive tactical slots</span></div><div className="telemetry-stat"><span className="eyebrow"><ShieldCheck size={12} /> FAIRNESS VIOLATIONS</span><strong className={snapshot?.metrics.fairnessViolations ? 'orange-text' : 'lime-text'}>{snapshot?.metrics.fairnessViolations ?? 0}<span className="stat-check">{snapshot ? 'MONITORED' : 'WAITING'}</span></strong><span>Evidence provenance assertions</span></div><div className="telemetry-stat"><span className="eyebrow"><Crosshair size={12} /> RUNTIME MODE</span><strong className="text-value">Symbolic <ArrowUpRight size={17} /></strong><span>Deterministic policy fallback</span></div></section>
      <section className="event-panel panel"><div className="event-heading"><div className="panel-heading"><span><Terminal size={14} /> Event stream</span><span className="event-count">{snapshot?.events.length ?? 0} EVENTS</span></div><div className="event-filters"><button className={eventFilter === 'all' ? 'active' : ''} onClick={() => setEventFilter('all')}>All events</button><button className={eventFilter === 'radio' ? 'active' : ''} onClick={() => setEventFilter('radio')}>Communication</button><button className={eventFilter === 'decisions' ? 'active' : ''} onClick={() => setEventFilter('decisions')}>Decisions</button></div><span className="event-stream-label"><AudioLines size={13} /> AUTHORITATIVE DEBUG STREAM</span></div><div className="event-list" aria-label="Simulation events">{events.length ? events.map(event => <div className={`event-row ${event.type}`} key={event.id}><time>{clock(event.tick)}<span>.{String(Math.floor(event.tick % TICK_RATE / TICK_RATE * 100)).padStart(2, '0')}</span></time><span className={`event-type ${event.team ?? ''}`}>{event.type}</span><span>{event.text}</span><code>t:{event.tick}</code></div>) : <div className="event-empty"><Radio size={17} /><span>{playing ? 'Listening for squad activity…' : 'The field is quiet. Run the simulation to follow the squad’s decisions.'}</span><button disabled={!snapshot || !!error} onClick={togglePlay}>Start observing <ArrowUpRight size={13} /></button></div>}</div></section>
      <footer className="page-footer"><span><span className="mini-cross">+</span> COMPETENCE, ENGINEERED. DECISIONS, INSPECTABLE.</span><span>30 HZ FIXED STEP <i /> {snapshot?.checksum ? `CHECKSUM ${snapshot.checksum}` : 'WORKER INITIALIZING'} <i /> v0.1.0</span></footer>
    </main>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section ref={helpDialog} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="icon-button close-dialog" onClick={() => setHelp(false)} aria-label="Close help"><X size={18} /></button><span className="eyebrow">WARDEN / RESEARCH BUILD</span><h2 id="help-title">Inspect the intelligence.</h2><p>Run a reproducible 5v5 tactical scenario. Select a squad member to inspect its evidence, commitments, execution state, and scored decisions.</p><div className="help-line"><Eye size={18} /><p><strong>Compare knowledge views.</strong> Truth is a debugging view. Private belief and shared picture show uncertain contacts at their estimated positions.</p></div><div className="help-line"><ShieldCheck size={18} /><p><strong>A working symbolic baseline.</strong> Learned policies are not installed. Human indistinguishability requires consented training data and independent evaluation.</p></div><div className="help-line"><ArrowDownToLine size={18} /><p><strong>Reproduce a run.</strong> Export tick-indexed commands, checksums, seed, and versioned configuration as a JSON replay.</p></div><div className="keyboard-hints"><span><kbd>Space</kbd> Play / pause</span><span><kbd>→</kbd> One tick</span><span><kbd>R</kbd> Reset</span></div><button className="play-button" onClick={() => setHelp(false)}>Back to the field <ArrowUpRight size={15} /></button></section></div>}
    <span className="sr-only">{scenario.detail}</span>
  </div>;
}
