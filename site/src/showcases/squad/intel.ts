import * as THREE from 'three'
import type { AgentView, Assignment, BeliefTrack, RenderSnapshot, TeamId, Vec3 } from '@blacksite/warden'

export const TEAM_COLOR: Record<TeamId, THREE.Color> = {
  alpha: new THREE.Color('#e2a23b'),
  bravo: new THREE.Color('#8fc0cf'),
}
export const TEAM_NAME: Record<TeamId, string> = { alpha: 'Alpha', bravo: 'Bravo' }

const MAX_AGENTS = 16
const MAX_BELIEFS = 48
const MAX_CANDIDATES = 64
const MAX_PATH = 512

const VERB: Record<string, string> = {
  move: 'moving',
  hold: 'holding',
  engage: 'engaging',
  reload: 'reloading',
  fallback: 'falling back',
  search: 'searching',
  revive: 'reviving',
  suppress: 'suppressing',
  yield: 'yielding',
  idle: '',
}

export function assignmentsOf(snapshot: RenderSnapshot) {
  return new Map(snapshot.squads.flatMap(squad => squad.assignments.map(assignment => [assignment.agentId, assignment] as const)))
}

export function activity(agent: AgentView, assignment?: Assignment) {
  if (!agent.alive) return 'down'
  if (agent.execution.skill === 'move' && agent.plan?.goal === 'fulfill-role') return agent.role === 'flank' ? 'flanking' : 'to cover'
  if (agent.execution.skill === 'hold' && assignment?.watchSector) return 'covering'
  return VERB[agent.execution.skill] ?? agent.execution.skill
}

function overlayMaterial(opacity: number) {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide })
}

function flat(geometry: THREE.BufferGeometry) { geometry.rotateX(-Math.PI / 2); return geometry }

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, order: number) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.renderOrder = order
  mesh.count = 0
  return mesh
}

type Label = { root: HTMLDivElement; name: HTMLElement; role: HTMLElement; verb: HTMLElement; text: string; shown: boolean }

export class IntelLayer {
  readonly group = new THREE.Group()
  private rings = instanced(flat(new THREE.RingGeometry(0.46, 0.56, 36)), overlayMaterial(0.75), MAX_AGENTS, 3)
  private cover = instanced(flat(new THREE.RingGeometry(0.62, 0.78, 28, 1, Math.PI * 0.15, Math.PI * 0.7)), overlayMaterial(0.9), MAX_AGENTS, 3)
  private spots = instanced(flat(new THREE.CircleGeometry(0.1, 12)), overlayMaterial(0.3), MAX_CANDIDATES, 3)
  private discs = instanced(flat(new THREE.CircleGeometry(1, 40)), overlayMaterial(0.06), MAX_BELIEFS, 2)
  private edges = instanced(flat(new THREE.RingGeometry(0.95, 1, 48)), overlayMaterial(0.3), MAX_BELIEFS, 3)
  private pathGeometry = new THREE.BufferGeometry()
  private pathPositions = new Float32Array(MAX_PATH * 6)
  private pathColors = new Float32Array(MAX_PATH * 6)
  private paths: THREE.LineSegments
  private matrix = new THREE.Matrix4()
  private quaternion = new THREE.Quaternion()
  private scale = new THREE.Vector3()
  private position = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  private color = new THREE.Color()
  private project = new THREE.Vector3()
  private labels = new Map<string, Label>()

  constructor(private readonly layer: HTMLElement) {
    this.pathGeometry.setAttribute('position', new THREE.BufferAttribute(this.pathPositions, 3).setUsage(THREE.DynamicDrawUsage))
    this.pathGeometry.setAttribute('color', new THREE.BufferAttribute(this.pathColors, 3).setUsage(THREE.DynamicDrawUsage))
    this.paths = new THREE.LineSegments(this.pathGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }))
    this.paths.frustumCulled = false
    this.paths.renderOrder = 3
    this.group.add(this.discs, this.edges, this.rings, this.cover, this.spots, this.paths)
  }

  set visible(value: boolean) {
    this.group.visible = value
    this.layer.style.display = value ? '' : 'none'
  }

  private place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, scale: number, yaw: number, color: THREE.Color, intensity: number) {
    this.position.set(x, y, z)
    this.quaternion.setFromAxisAngle(this.up, yaw)
    this.scale.set(scale, 1, scale)
    this.matrix.compose(this.position, this.quaternion, this.scale)
    mesh.setMatrixAt(index, this.matrix)
    mesh.setColorAt(index, this.color.copy(color).multiplyScalar(intensity))
  }

  update(snapshot: RenderSnapshot, positions: Map<string, Vec3>, side: TeamId, focus: string | undefined, camera: THREE.Camera, width: number, height: number) {
    let rings = 0, cover = 0, spots = 0, discs = 0, segments = 0
    const assignments = assignmentsOf(snapshot)
    const enemy: TeamId = side === 'alpha' ? 'bravo' : 'alpha'
    const tracks = new Map<string, BeliefTrack>()
    for (const agent of snapshot.agents) {
      if (!agent.alive || agent.team !== side) continue
      for (const track of agent.beliefs) {
        if (track.classification === 'friendly' || track.expiresAt <= snapshot.tick) continue
        const key = track.subjectId ?? track.id
        const known = tracks.get(key)
        if (!known || track.lastObservedAt > known.lastObservedAt || (track.lastObservedAt === known.lastObservedAt && track.confidence > known.confidence)) tracks.set(key, track)
      }
    }
    for (const track of tracks.values()) {
      if (discs >= MAX_BELIEFS) break
      const age = snapshot.tick - track.lastObservedAt
      const seen = age <= 18
      const radius = Math.max(0.7, Math.min(4.5, track.uncertaintyRadius))
      const strength = track.classification === 'enemy' ? Math.min(1, track.confidence + 0.15) : track.confidence * 0.6
      const tone = seen ? 1.2 : 0.7
      this.place(this.discs, discs, track.meanPosition.x, 0.05, track.meanPosition.z, radius, 0, TEAM_COLOR[enemy], strength * tone)
      this.place(this.edges, discs++, track.meanPosition.x, 0.055, track.meanPosition.z, radius, 0, TEAM_COLOR[enemy], strength * tone)
    }

    for (const agent of snapshot.agents) {
      const at = positions.get(agent.id) ?? agent.position
      const own = agent.team === side
      const focused = agent.id === focus
      if (agent.alive) this.place(this.rings, rings++, at.x, 0.045, at.z, focused ? 1.25 : 1, 0, TEAM_COLOR[agent.team], own ? 1.4 : 0.6)
      if (!agent.alive || !own) continue
      const slot = assignments.get(agent.id)?.position ?? agent.destination
      if (slot && cover < MAX_AGENTS) {
        const threat = [...tracks.values()].sort((a, b) => Math.hypot(a.meanPosition.x - slot.x, a.meanPosition.z - slot.z) - Math.hypot(b.meanPosition.x - slot.x, b.meanPosition.z - slot.z))[0]
        const look = threat?.meanPosition ?? snapshot.objective.position
        const yaw = Math.atan2(slot.x - look.x, slot.z - look.z)
        this.place(this.cover, cover++, slot.x, 0.06, slot.z, 1, yaw, TEAM_COLOR[agent.team], focused ? 2 : 1.2)
      }
      if (focused || agent.execution.skill === 'move' || agent.execution.skill === 'fallback' || agent.execution.skill === 'search') {
        const route: Vec3[] = [at, ...agent.path.filter(point => Math.hypot(point.x - at.x, point.z - at.z) > 0.4)]
        if (agent.destination) route.push(agent.destination)
        const total = route.length - 1
        for (let index = 0; index < total && segments < MAX_PATH; index++) {
          const a = route[index]!, b = route[index + 1]!
          const length = Math.hypot(b.x - a.x, b.z - a.z)
          const dashes = Math.max(1, Math.floor(length / 0.9))
          for (let dash = 0; dash < dashes && segments < MAX_PATH; dash++) {
            const k0 = dash / dashes, k1 = (dash + 0.55) / dashes
            const fade = (focused ? 1.3 : 0.8) * (1 - (index + k0) / Math.max(1, total) * 0.6)
            const o = segments * 6
            this.pathPositions.set([a.x + (b.x - a.x) * k0, 0.07, a.z + (b.z - a.z) * k0, a.x + (b.x - a.x) * k1, 0.07, a.z + (b.z - a.z) * k1], o)
            const c = TEAM_COLOR[agent.team]
            this.pathColors.set([c.r * fade, c.g * fade, c.b * fade, c.r * fade, c.g * fade, c.b * fade], o)
            segments++
          }
        }
      }
      if (focused && agent.trace) {
        for (const candidate of agent.trace.candidates) {
          if (!('position' in candidate) || spots >= MAX_CANDIDATES) continue
          const position = (candidate as { position: Vec3 }).position
          this.place(this.spots, spots++, position.x, 0.06, position.z, 1, 0, TEAM_COLOR[agent.team], 0.6)
        }
      }
    }
    for (const [mesh, count] of [[this.rings, rings], [this.cover, cover], [this.spots, spots], [this.discs, discs], [this.edges, discs]] as const) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.pathGeometry.setDrawRange(0, segments * 2)
    this.pathGeometry.attributes.position!.needsUpdate = true
    this.pathGeometry.attributes.color!.needsUpdate = true
    const sighted = new Set<string>()
    for (const track of tracks.values()) if (track.subjectId && snapshot.tick - track.lastObservedAt <= 30) sighted.add(track.subjectId)
    this.labelsFor(snapshot, assignments, positions, side, focus, sighted, camera, width, height)
  }

  private labelsFor(snapshot: RenderSnapshot, assignments: Map<string, Assignment>, positions: Map<string, Vec3>, side: TeamId, focus: string | undefined, sighted: Set<string>, camera: THREE.Camera, width: number, height: number) {
    const queue: Array<{ agent: AgentView; label: Label; x: number; y: number; rank: number }> = []
    for (const agent of snapshot.agents) {
      let label = this.labels.get(agent.id)
      if (!label) {
        const root = document.createElement('div')
        root.className = `squad-label squad-label--${agent.team}`
        root.style.display = 'none'
        const top = document.createElement('div')
        const name = document.createElement('b')
        const role = document.createElement('span')
        top.append(name, role)
        const verb = document.createElement('i')
        root.append(top, verb)
        this.layer.append(root)
        label = { root, name, role, verb, text: '', shown: false }
        this.labels.set(agent.id, label)
      }
      const at = positions.get(agent.id) ?? agent.position
      this.project.set(at.x, at.y + (agent.stance === 'stand' ? 2.15 : 1.6), at.z).project(camera)
      if (!agent.alive || agent.id === focus || (agent.team !== side && !sighted.has(agent.id)) || this.project.z >= 1 || Math.abs(this.project.x) > 1.1 || Math.abs(this.project.y) > 1.1) { this.show(label, false); continue }
      queue.push({ agent, label, x: (this.project.x * 0.5 + 0.5) * width, y: (-this.project.y * 0.5 + 0.5) * height, rank: agent.id === focus ? 0 : agent.team === side ? 1 : 2 })
    }
    queue.sort((a, b) => a.rank - b.rank)
    const placed: Array<{ x: number; y: number; w: number; h: number }> = []
    const free = (x: number, y: number, w: number, h: number) => placed.every(box => Math.abs(box.x - x) * 2 > box.w + w || Math.abs(box.y - y) * 2 > box.h + h)
    for (const { agent, label, x, y, rank } of queue) {
      const own = agent.team === side
      let compact = !own
      let w = compact ? 34 : 92, h = compact ? 14 : 28
      if (!free(x, y - h / 2, w, h) && !compact) { compact = true; w = 34; h = 14 }
      let lift = 0
      while (lift < 3 && !free(x, y - h / 2 - lift * 14, w, h)) lift++
      if (lift === 3 && rank > 0) { this.show(label, false); continue }
      placed.push({ x, y: y - h / 2 - lift * 14, w, h })
      this.show(label, true)
      label.root.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - lift * 14).toFixed(1)}px, 0) translate(-50%, -100%)`
      const verb = activity(agent, assignments.get(agent.id))
      const text = `${agent.callsign}|${agent.role}|${verb}|${own}|${agent.id === focus}|${agent.suppression > 0.45}|${compact}`
      if (text === label.text) continue
      label.text = text
      label.name.textContent = agent.callsign
      label.role.textContent = own && !compact ? agent.role : ''
      label.verb.textContent = own && !compact ? verb : ''
      label.root.dataset.focus = agent.id === focus ? 'true' : ''
      label.root.dataset.own = own ? 'true' : ''
      label.root.dataset.pinned = agent.suppression > 0.45 ? 'true' : ''
    }
  }

  private show(label: Label, visible: boolean) {
    if (label.shown === visible) return
    label.shown = visible
    label.root.style.display = visible ? '' : 'none'
  }

  clear() {
    for (const label of this.labels.values()) label.root.remove()
    this.labels.clear()
  }

  dispose() {
    this.clear()
    for (const object of [this.rings, this.cover, this.spots, this.discs, this.edges, this.paths]) { object.geometry.dispose(); (object.material as THREE.Material).dispose() }
  }
}
