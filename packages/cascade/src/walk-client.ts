import type { PlayerInput, PlayerTool, Vec3 } from '../../destruction-domain/src/index';

export interface WalkTool {
  id: PlayerTool;
  label: string;
  radius: number;
  strength: number;
  repeatMs?: number;
  strike?: { contactMs: number; totalMs: number };
}

export const WALK_TOOLS: readonly WalkTool[] = [
  { id: 'explosive', label: 'Explosive', radius: 1.5, strength: 2 },
  { id: 'cannonball', label: 'Cannonball', radius: 0.32, strength: 2 },
  { id: 'hammer', label: 'Sledge', radius: 1, strength: 1, strike: { contactMs: 300, totalMs: 680 } },
  { id: 'cutter', label: 'Cutter', radius: 0.38, strength: 1, repeatMs: 125 },
];

export function walkInput(keys: ReadonlySet<string>, yaw: number, pitch: number, tool: PlayerTool, move = { forward: 0, right: 0 }, sprint = false): PlayerInput {
  return {
    forward: Math.max(-1, Math.min(1, Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + move.forward)),
    right: Math.max(-1, Math.min(1, Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + move.right)),
    jump: keys.has('Space'),
    sprint: sprint || keys.has('ShiftLeft') || keys.has('ShiftRight'),
    crouch: keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight'),
    yaw,
    aim: [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)],
    tool,
  };
}

export class StrikeClock {
  private contactTimer?: ReturnType<typeof setTimeout>;
  private endTimer?: ReturnType<typeof setTimeout>;
  private identity?: string;
  constructor(private readonly current: () => string | undefined, private readonly contact: () => void, private readonly held: () => boolean) {}
  start(timing: { contactMs: number; totalMs: number }): boolean {
    const identity = this.current();
    if (!identity || this.identity) return false;
    const contactMs = Math.max(0, timing.contactMs);
    const totalMs = Math.max(contactMs, timing.totalMs);
    this.identity = identity;
    this.contactTimer = setTimeout(() => {
      this.contactTimer = undefined;
      if (this.current() === identity) this.contact();
      else this.cancel();
    }, contactMs);
    this.endTimer = setTimeout(() => {
      this.endTimer = undefined;
      this.identity = undefined;
      if (this.held() && this.current() === identity) this.start({ contactMs, totalMs });
    }, totalMs);
    return true;
  }
  check(): void { if (this.identity && this.current() !== this.identity) this.cancel(); }
  cancel(): void {
    clearTimeout(this.contactTimer);
    clearTimeout(this.endTimer);
    this.contactTimer = this.endTimer = undefined;
    this.identity = undefined;
  }
}

export interface WalkSession {
  setPlayerEnabled(enabled: boolean): void;
  playerInput(input: PlayerInput): void;
  playerAction(tool: PlayerTool, direction: Vec3, radius: number, strength: number): void;
  respawnPlayer(): void;
}

export class CascadeWalkClient {
  readonly keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  toolIndex = 0;
  active = false;
  private held = false;
  private move = { forward: 0, right: 0 };
  private sprint = false;
  private dragging = false;
  private timer?: ReturnType<typeof setInterval>;
  private repeat?: ReturnType<typeof setInterval>;
  private readonly strike = new StrikeClock(() => this.active ? String(this.toolIndex) : undefined, () => this.fire(), () => this.held);
  constructor(readonly canvas: HTMLCanvasElement, private readonly session: WalkSession, private readonly onChange: () => void) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.timer = setInterval(() => { this.sendInput(); this.strike.check(); }, 33);
  }
  get tool(): WalkTool { return WALK_TOOLS[this.toolIndex]!; }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.clear();
    this.session.setPlayerEnabled(active);
    if (active && !matchMedia('(pointer: coarse)').matches) this.capture();
    else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.onChange();
  }
  select(index: number): void {
    this.toolIndex = (index + WALK_TOOLS.length) % WALK_TOOLS.length;
    this.strike.check();
    this.stopRepeat();
    this.onChange();
    this.sendInput();
  }
  sendInput(): void {
    if (!this.active) return;
    this.session.playerInput(walkInput(this.keys, this.yaw, this.pitch, this.tool.id, this.move, this.sprint));
  }
  touchMove(forward: number, right: number): void {
    this.move = { forward, right };
    this.sendInput();
  }
  touchLook(dx: number, dy: number): void {
    if (!this.active) return;
    this.yaw -= dx * 0.004;
    this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch - dy * 0.004));
    this.sendInput();
  }
  touchAction(action: 'jump' | 'crouch' | 'sprint' | 'cycle' | 'use' | 'respawn' | 'exit', pressed: boolean): void {
    if (!this.active) return;
    if (action === 'jump' || action === 'crouch') {
      const code = action === 'jump' ? 'Space' : 'KeyC';
      if (pressed) this.keys.add(code); else this.keys.delete(code);
      this.sendInput();
    } else if (action === 'sprint' && pressed) { this.sprint = !this.sprint; this.sendInput(); }
    else if (action === 'cycle' && pressed) this.select(this.toolIndex + 1);
    else if (action === 'respawn' && pressed) this.session.respawnPlayer();
    else if (action === 'exit' && pressed) this.setActive(false);
    else if (action === 'use') {
      this.held = pressed;
      if (pressed) {
        if (this.tool.strike) this.strike.start(this.tool.strike);
        else { this.fire(); this.stopRepeat(); if (this.tool.repeatMs) this.repeat = setInterval(() => this.fire(), this.tool.repeatMs); }
      } else this.stopRepeat();
    }
  }
  dispose(): void {
    this.setActive(false);
    clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }
  private fire(): void {
    const { aim } = walkInput(this.keys, this.yaw, this.pitch, this.tool.id, this.move, this.sprint);
    this.session.playerAction(this.tool.id, aim!, this.tool.radius, this.tool.strength);
    this.canvas.dispatchEvent(new CustomEvent('cascade-walk-fire', { detail: this.tool.id }));
  }
  private capture(): void {
    try { void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => {}); } catch {}
  }
  private stopRepeat(): void { clearInterval(this.repeat); this.repeat = undefined; }
  private clear = (): void => {
    this.keys.clear();
    this.move = { forward: 0, right: 0 };
    this.sprint = false;
    this.held = this.dragging = false;
    this.strike.cancel();
    this.stopRepeat();
    this.sendInput();
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Tab' && !event.repeat) { event.preventDefault(); this.setActive(!this.active); return; }
    if (!this.active || event.metaKey || event.altKey) return;
    if (/^Digit[1-4]$/.test(event.code)) { this.select(Number(event.code.slice(5)) - 1); return; }
    if (event.code === 'KeyR') { this.session.respawnPlayer(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
      this.sendInput();
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); this.sendInput(); };
  private onMouseMove = (event: MouseEvent): void => {
    if (!this.active || (document.pointerLockElement !== this.canvas && !this.dragging)) return;
    this.yaw -= event.movementX * 0.002;
    this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch - event.movementY * 0.002));
    this.sendInput();
  };
  private onMouseDown = (event: MouseEvent): void => {
    if (!this.active) return;
    if (event.button === 2) { this.dragging = true; return; }
    if (event.button !== 0) return;
    if (document.pointerLockElement !== this.canvas && !this.dragging) this.capture();
    this.held = true;
    if (this.tool.strike) this.strike.start(this.tool.strike);
    else {
      this.fire();
      this.stopRepeat();
      if (this.tool.repeatMs) this.repeat = setInterval(() => this.fire(), this.tool.repeatMs);
    }
  };
  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) { this.held = false; this.stopRepeat(); }
    if (event.button === 2) this.dragging = false;
  };
  private onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.select(this.toolIndex + Math.sign(event.deltaY));
  };
  private onContextMenu = (event: MouseEvent): void => { if (this.active) event.preventDefault(); };
}
