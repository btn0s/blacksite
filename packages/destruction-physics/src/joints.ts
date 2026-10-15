import type RAPIER from '@dimforge/rapier3d-compat';
import type { RapierModule } from './engine';
import { type MaterialDef, type Vec3 } from '../../destruction-domain/src/index';
import type { StructuralGraph } from '../../destruction-graph/src/index';
import type { BondSection } from '../../destruction-graph/src/equilibrium';
import { materialStrengths } from '../../destruction-graph/src/stress';

type V = { x: number; y: number; z: number };
type Q = V & { w: number };
type Pose = { position: V; rotation: Q };
/** Actual native solver writeback. The engine's pinned Rapier fork supplies these methods. */
type MeasuredJoint = RAPIER.ImpulseJoint & {
  setFrameX1(rotation: Q): void;
  setFrameX2(rotation: Q): void;
  appliedImpulses(): Float32Array;
  motorImpulses(): Float32Array;
  limitImpulses(): Float32Array;
  angularJacobian(): Float32Array;
};
interface Connection {
  index: number;
  a: number;
  b: number;
  /** The graph A endpoint may be joint body2 after canonicalizing an actor pair. */
  sign: number;
  section: BondSection;
  stiffness: number[];
  angularLimits: number[];
  damping: number;
  breakForce: number;
  breakTorque: number;
}
interface Seam {
  key: string;
  connections: Connection[];
  first: RAPIER.RigidBody;
  second: RAPIER.RigidBody;
  firstChunk: number;
  secondChunk: number;
  joint: MeasuredJoint;
  point: Vec3;
  basis: Vec3[];
  stiffness: number[];
  /** Runtime motor coefficients; the authored stiffness still apportions joint reactions. */
  motorStiffness: number[];
  motorDamping: number[];
  effectiveMass: number[];
  naturalFrequency: number[];
  frequencyLimit: number;
  allocation: Float64Array;
  rows: number[][][];
  /** Absolute endpoint motion since last step, including together-moving baked seams. */
  lastPose?: number[];
  moving: boolean;
}
interface JointCallbacks {
  body(index: number): RAPIER.RigidBody | undefined;
  pose(index: number): Pose;
  wake(body: RAPIER.RigidBody): void;
  /** Required only for host worlds that customize Rapier's per-body iteration counts. */
  sampleDt?(joint: RAPIER.ImpulseJoint): number;
}
const vec = (v: Vec3): V => ({ x: v[0], y: v[1], z: v[2] });
const tuple = (v: V): Vec3 => [v.x, v.y, v.z];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const quadratic = (matrix: RAPIER.SdpMatrix3, v: Vec3): number =>
  matrix.m11*v[0]*v[0]+matrix.m22*v[1]*v[1]+matrix.m33*v[2]*v[2]+
  2*(matrix.m12*v[0]*v[1]+matrix.m13*v[0]*v[2]+matrix.m23*v[1]*v[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const inverse = (q: Q): Q => ({ x:-q.x, y:-q.y, z:-q.z, w:q.w });
const multiply = (a: Q,b: Q): Q => ({
  x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
  y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
  z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
  w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
});
const rotate = (q: Q,v: Vec3): Vec3 => {
  const t = scale(cross([q.x,q.y,q.z],v),2);
  return add(v,add(scale(t,q.w),cross([q.x,q.y,q.z],t)));
};
const worldPoint = (body: RAPIER.RigidBody, p: V): Vec3 =>
  add(tuple(body.translation()),rotate(body.rotation(),tuple(p)));
const fromBasis = (basis: Vec3[],v: ArrayLike<number>): Vec3 =>
  add(add(scale(basis[0]!,v[0]!),scale(basis[1]!,v[1]!)),scale(basis[2]!,v[2]!));
const inBasis = (basis: Vec3[],v: Vec3): Vec3 => [dot(basis[0]!,v),dot(basis[1]!,v),dot(basis[2]!,v)];
function frame(basis: Vec3[]): Q {
  const [x,y,z] = basis as [Vec3,Vec3,Vec3];
  const trace=x[0]+y[1]+z[2];
  let q: Q;
  if (trace>0) {
    const s=Math.sqrt(trace+1)*2;
    q={w:s/4,x:(y[2]-z[1])/s,y:(z[0]-x[2])/s,z:(x[1]-y[0])/s};
  } else if (x[0]>y[1] && x[0]>z[2]) {
    const s=Math.sqrt(1+x[0]-y[1]-z[2])*2;
    q={w:(y[2]-z[1])/s,x:s/4,y:(y[0]+x[1])/s,z:(z[0]+x[2])/s};
  } else if (y[1]>z[2]) {
    const s=Math.sqrt(1+y[1]-x[0]-z[2])*2;
    q={w:(z[0]-x[2])/s,x:(y[0]+x[1])/s,y:s/4,z:(z[1]+y[2])/s};
  } else {
    const s=Math.sqrt(1+z[2]-x[0]-y[1])*2;
    q={w:(x[1]-y[0])/s,x:(z[0]+x[2])/s,y:(z[1]+y[2])/s,z:s/4};
  }
  return q;
}
function stiffness(section: BondSection,a: MaterialDef,b: MaterialDef): number[] {
  const ea=a.youngModulus??12e9, eb=b.youngModulus??12e9;
  const e=2/(1/ea+1/eb), g=2/(2*(1+(a.poissonRatio??0.2))/ea+2*(1+(b.poissonRatio??0.2))/eb);
  return [e*section.area,g*section.area,g*section.area,g*section.polarInertia,e*section.inertia1,e*section.inertia2].map(v=>v/section.length);
}
function adjacent(a: Connection,b: Connection): boolean {
  const n=scale(a.section.normal,a.sign), m=scale(b.section.normal,b.sign);
  if (dot(n,m)<0.995) return false;
  const d=sub(a.section.point,b.section.point);
  if (Math.abs(dot(d,n))>1e-3+0.01*Math.sqrt(Math.min(a.section.area,b.section.area))) return false;
  const extent=(c:Connection,t:Vec3) =>
    Math.abs(dot(c.section.tangent1,t))*c.section.inertia2/c.section.sectionModulus2+
    Math.abs(dot(c.section.tangent2,t))*c.section.inertia1/c.section.sectionModulus1;
  return [a.section.tangent1,a.section.tangent2].every(t=>Math.abs(dot(d,t))<=extent(a,t)+extent(b,t)+0.002);
}
/** Small dense factor only apportions one measured joint wrench over its constituent patches. */
function factor(matrix: Float64Array): Float64Array {
  const l=new Float64Array(36);
  for(let i=0;i<6;i++) for(let j=0;j<=i;j++) {
    let v=matrix[i*6+j]!;
    for(let k=0;k<j;k++) v-=l[i*6+k]!*l[j*6+k]!;
    l[i*6+j]=i===j?Math.sqrt(Math.max(v,1e-12)):v/l[j*6+j]!;
  }
  return l;
}
function solve(l:Float64Array,rhs:number[]):number[] {
  const x=[...rhs];
  for(let i=0;i<6;i++) {
    for(let j=0;j<i;j++) x[i]!-=l[i*6+j]!*x[j]!;
    x[i]!/=l[i*6+i]!;
  }
  for(let i=5;i>=0;i--) {
    for(let j=i+1;j<6;j++) x[i]!-=l[j*6+i]!*x[j]!;
    x[i]!/=l[i*6+i]!;
  }
  return x;
}

/** One external Rapier joint per connected, coplanar interface between rigid actors. */
export class CompliantConnections {
  /** Current sync's authored motor frequencies and the runtime stability clamp. */
  readonly motorStability={maxNaturalFrequencyHz:0,clampedAxes:0,configuredAxes:0,limitHz:0};
  private seams=new Map<string,Seam>();
  private movingBodies?:Set<number>;
  private worldAnchor?: RAPIER.RigidBody;
  private readonly indices:Map<number,number>;
  private readonly materials:Map<number,MaterialDef>;
  constructor(private readonly rapier:RapierModule,private readonly world:RAPIER.World,
    private readonly graph:StructuralGraph,private readonly callbacks:JointCallbacks) {
    this.indices=new Map(graph.manifest.fragments.map((f,i)=>[f.id,i]));
    this.materials=new Map(graph.manifest.materials.map(m=>[m.id,m]));
  }
  private assetPoint(chunk:number,point:Vec3):Vec3 {
    if(chunk<0) return point;
    const pose=this.callbacks.pose(chunk);
    return add(tuple(pose.position),rotate(pose.rotation,sub(point,this.graph.manifest.fragments[chunk]!.position)));
  }
  private anchor():RAPIER.RigidBody {
    return this.worldAnchor??=this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed());
  }
  sync():void {
    this.movingBodies=undefined;
    Object.assign(this.motorStability,{maxNaturalFrequencyHz:0,clampedAxes:0,configuredAxes:0,limitHz:0});
    const pairs=new Map<string,{first:RAPIER.RigidBody;second:RAPIER.RigidBody;connections:Connection[]}>();
    for(const index of this.graph.getCompliantBonds()) {
      const def=this.graph.manifest.bonds[index]!,a=this.indices.get(def.a)!,b=def.b===-1?-1:this.indices.get(def.b)!;
      const bodyA=this.callbacks.body(a),bodyB=b<0?this.anchor():this.callbacks.body(b);
      if(!bodyA||!bodyB||bodyA.handle===bodyB.handle) continue;
      const sign=b<0||bodyA.handle<bodyB.handle?1:-1;
      const first=sign===1?bodyA:bodyB,second=sign===1?bodyB:bodyA;
      const key=`${first.handle}:${second.handle}`;
      let pair=pairs.get(key);
      if(!pair) pairs.set(key,pair={first,second,connections:[]});
      const section=this.graph.sections[index]!;
      const ma=this.materials.get(this.graph.manifest.fragments[a]!.material)!,mb=b<0?ma:this.materials.get(this.graph.manifest.fragments[b]!.material)!;
      const k=stiffness(section,ma,mb),remaining=Math.max(0,1-this.graph.damage[index]!);
      const sa=materialStrengths(ma),sb=materialStrengths(mb);
      const shear=Math.min(sa.shear,sb.shear),bending=Math.min(sa.bending,sb.bending),tension=Math.min(sa.tension,sb.tension);
      const moments=[shear*section.torsionModulus,bending*section.sectionModulus1,bending*section.sectionModulus2].map(v=>v*remaining);
      pair.connections.push({index,a,b,sign,section,stiffness:k,
        angularLimits:moments.map((v,axis)=>Math.min(Math.PI/2,v/k[axis+3]!)),
        damping:Math.max(ma.compliantDampingRatio??1,mb.compliantDampingRatio??1),
        breakForce:tension*section.area*remaining,breakTorque:Math.min(...moments)});
    }
    const wanted=new Set<string>();
    for(const [pairKey,pair] of pairs) {
      const remaining=new Set(pair.connections);
      while(remaining.size) {
        const first=remaining.values().next().value as Connection;
        const group=[first]; remaining.delete(first);
        for(let i=0;i<group.length;i++) for(const candidate of remaining) {
          if(adjacent(group[i]!,candidate)) {remaining.delete(candidate);group.push(candidate);}
        }
        group.sort((a,b)=>a.index-b.index);
        const key=`${pairKey}:${group.map(c=>c.index).join(',')}`;
        wanted.add(key);
        let seam=this.seams.get(key);
        if(seam && !seam.joint.isValid()) {this.seams.delete(key);this.movingBodies=undefined;seam=undefined;}
        if(!seam) {seam=this.create(key,group,pair.first,pair.second);this.seams.set(key,seam);this.movingBodies=undefined;}
        else seam.connections=group;
      }
    }
    for(const [key,seam] of this.seams) if(!wanted.has(key)) {
      if(seam.joint.isValid()) this.world.removeImpulseJoint(seam.joint,true);
      this.callbacks.wake(seam.first);this.callbacks.wake(seam.second);
      this.seams.delete(key);
      this.movingBodies=undefined;
    }
    this.wakeMovingSeams();
    // Wake callbacks may turn a baked endpoint dynamic. Read mass properties only
    // after those transitions; repeat each step for rotation, mass and anchor changes.
    for(const seam of this.seams.values()) this.configure(seam);
  }
  private create(key:string,connections:Connection[],first:RAPIER.RigidBody,second:RAPIER.RigidBody):Seam {
    const firstConnection=connections[0]!,basis=[scale(firstConnection.section.normal,firstConnection.sign),firstConnection.section.tangent1,scale(firstConnection.section.tangent2,firstConnection.sign)];
    let area=0,point:Vec3=[0,0,0];
    for(const c of connections) {area+=c.section.area;point=add(point,scale(c.section.point,c.section.area));}
    point=scale(point,1/area);
    const firstChunk=firstConnection.sign===1?firstConnection.a:firstConnection.b,secondChunk=firstConnection.sign===1?firstConnection.b:firstConnection.a;
    const p1=this.assetPoint(firstChunk,point),p2=this.assetPoint(secondChunk,point);
    const a1=rotate(inverse(first.rotation()),sub(p1,tuple(first.translation()))),a2=rotate(inverse(second.rotation()),sub(p2,tuple(second.translation())));
    const joint=this.world.createImpulseJoint(this.rapier.JointData.generic(vec(a1),vec(a2),{x:1,y:0,z:0},0 as RAPIER.JointAxesMask),first,second,true) as MeasuredJoint;
    if(['setFrameX1','setFrameX2','appliedImpulses','motorImpulses','limitImpulses','angularJacobian'].some(method=>typeof (joint as unknown as Record<string,unknown>)[method]!=='function')) {
      this.world.removeImpulseJoint(joint,false);
      throw new Error('Compliant destruction requires the pinned Cascade Rapier build with native impulse, angular Jacobian and independent joint-frame access. DestructionSimulation.attach must receive that same patched host module.');
    }
    const q=frame(basis),q1=multiply(firstChunk<0?{x:0,y:0,z:0,w:1}:this.callbacks.pose(firstChunk).rotation,q),q2=multiply(secondChunk<0?{x:0,y:0,z:0,w:1}:this.callbacks.pose(secondChunk).rotation,q);
    joint.setFrameX1(multiply(inverse(first.rotation()),q1));
    joint.setFrameX2(multiply(inverse(second.rotation()),q2));
    // Rapier filters the entire actor pair, not just this interface. Keep
    // contacts so compliant motion cannot pass unrelated compound shapes through
    // each other and reveal deep overlaps when the seam later breaks.
    joint.setContactsEnabled(true);
    const seam:Seam={key,connections,first,second,firstChunk,secondChunk,joint,point,basis,stiffness:[],motorStiffness:[],motorDamping:[],effectiveMass:[],naturalFrequency:[],frequencyLimit:0,allocation:new Float64Array(),rows:[],moving:true};
    this.callbacks.wake(first);this.callbacks.wake(second);
    return seam;
  }
  private configure(seam:Seam):void {
    const matrix=new Float64Array(36);
    seam.rows=seam.connections.map(c=>{
      const r=inBasis(seam.basis,sub(c.section.point,seam.point));
      const localBasis=[scale(c.section.normal,c.sign),c.section.tangent1,scale(c.section.tangent2,c.sign)].map(v=>inBasis(seam.basis,v));
      const rows=Array.from({length:6},(_,axis)=>{
        const direction=localBasis[axis%3]!,angular=axis<3?cross(r,direction):direction;
        return [...(axis<3?direction:[0,0,0]),...angular];
      });
      for(let axis=0;axis<6;axis++) for(let i=0;i<6;i++) for(let j=0;j<6;j++) matrix[i*6+j]!+=c.stiffness[axis]!*rows[axis]![i]!*rows[axis]![j]!;
      return rows;
    });
    seam.stiffness=Array.from({length:6},(_,i)=>matrix[i*6+i]!);
    seam.allocation=factor(matrix);
    const q=multiply(seam.first.rotation(),seam.joint.frameX1());
    // Rapier's unlocked linear joint axes apply both reactions at anchor2. Match
    // its J M^-1 J^T, including the rotational response of these offset forces.
    const at=worldPoint(seam.second,seam.joint.anchor2());
    const bodies=[seam.first,seam.second].map(body=>({
      dynamic:body.isDynamic(),
      inverseMass:body.effectiveInvMass(),
      inverseInertia:body.effectiveWorldInvInertia(),
      arm:sub(at,tuple(body.worldCom())),
    }));
    const sampleDt=this.callbacks.sampleDt?.(seam.joint)??this.world.timestep/this.world.integrationParameters.numSolverIterations;
    if(!(sampleDt>0&&Number.isFinite(sampleDt))) throw new Error('Invalid compliant motor solver interval.');
    // ForceBased coefficients carry physical units: k in N/m (N m/rad for
    // angular axes), c in N s/m (N m s/rad). Five solver substeps per cycle.
    seam.frequencyLimit=1/(5*sampleDt);
    const omegaMax=2*Math.PI*seam.frequencyLimit;
    const zeta=Math.max(...seam.connections.map(c=>c.damping));
    const raw=this.world.impulseJoints.raw;
    for(let axis=0;axis<6;axis++) {
      const direction=rotate(q,axis%3===0?[1,0,0]:axis%3===1?[0,1,0]:[0,0,1]);
      let inverseMass=0;
      for(const body of bodies) if(body.dynamic) {
        const angular=axis<3?cross(body.arm,direction):direction;
        inverseMass+=quadratic(body.inverseInertia,angular);
        if(axis<3) inverseMass+=body.inverseMass.x*direction[0]**2+
          body.inverseMass.y*direction[1]**2+body.inverseMass.z*direction[2]**2;
      }
      const mass=inverseMass>0?1/inverseMass:0;
      const authored=seam.stiffness[axis]!;
      const k=mass>0?Math.min(authored,mass*omegaMax*omegaMax):0;
      const damping=mass>0?2*(k<authored?1:zeta)*Math.sqrt(k*mass):0;
      seam.effectiveMass[axis]=mass;
      seam.naturalFrequency[axis]=mass>0?Math.sqrt(authored/mass)/(2*Math.PI):0;
      seam.motorStiffness[axis]=k;
      seam.motorDamping[axis]=damping;
      if(mass>0) {
        const stats=this.motorStability;
        stats.maxNaturalFrequencyHz=Math.max(stats.maxNaturalFrequencyHz,seam.naturalFrequency[axis]!);
        stats.limitHz=stats.configuredAxes===0?seam.frequencyLimit:Math.min(stats.limitHz,seam.frequencyLimit);
        stats.configuredAxes++;
        if(k<authored) stats.clampedAxes++;
      }
      raw.jointConfigureMotorModel(seam.joint.handle,axis,1);
      raw.jointConfigureMotorPosition(seam.joint.handle,axis,0,k,damping);
      // Never cap the motor at break capacity: the real reaction must be able to exceed B2's baseline.
      if(axis>=3) {
        const limit=Math.min(...seam.connections.map(c=>c.angularLimits[axis-3]!));
        raw.jointSetLimits(seam.joint.handle,axis,-limit,limit);
      }
    }
  }
  /** Called immediately after native stepping, before bodies are baked or their poses are changed. */
  collect():void {
    if(!this.seams.size) return;
    const stepDt=this.world.timestep;
    const defaultSampleDt=stepDt/this.world.integrationParameters.numSolverIterations;
    if(!this.callbacks.sampleDt) {
      this.world.bodies.forEach(body=> {
        if(body.isDynamic()&&body.additionalSolverIterations()!==0) throw new Error('Compliant joint feedback with additionalSolverIterations requires DestructionHostPhysics.jointImpulseSampleDt to report the actual native island substep interval.');
      });
    }
    for(const seam of this.seams.values()) {
      if(!seam.joint.isValid()) continue;
      const sampleDt=this.callbacks.sampleDt?.(seam.joint)??defaultSampleDt;
      if(!(sampleDt>0&&Number.isFinite(sampleDt))) throw new Error('Invalid native joint impulse sample interval.');
      // Native writeback contains only the final solver substep's impulse. Normalize
      // its sampled reaction to the whole physics step before crossing the graph API,
      // where both the rigid score and stored baseline are expressed as force * stepDt.
      const wholeStepScale=stepDt/sampleDt;
      const applied=seam.joint.appliedImpulses(),motors=seam.joint.motorImpulses(),limits=seam.joint.limitImpulses(),jacobian=seam.joint.angularJacobian();
      const q=multiply(seam.first.rotation(),seam.joint.frameX1());
      const linear=rotate(q,[applied[0]!,applied[1]!,applied[2]!]);
      const angular=add(rotate(q,[motors[3]!,motors[4]!,motors[5]!]),[
        jacobian[0]!*limits[3]!+jacobian[3]!*limits[4]!+jacobian[6]!*limits[5]!,
        jacobian[1]!*limits[3]!+jacobian[4]!*limits[4]!+jacobian[7]!*limits[5]!,
        jacobian[2]!*limits[3]!+jacobian[5]!*limits[4]!+jacobian[8]!*limits[5]!,
      ]);
      // Rapier's free linear axes apply body1's force at anchor2. Preserve that moment arm.
      const at=worldPoint(seam.second,seam.joint.anchor2()),origin=this.assetPoint(seam.firstChunk,seam.point);
      const moment=add(angular,cross(sub(at,origin),linear));
      const assetRotation=inverse(this.callbacks.pose(seam.firstChunk).rotation);
      const f=inBasis(seam.basis,rotate(assetRotation,linear)),m=inBasis(seam.basis,rotate(assetRotation,moment));
      const distribution=solve(seam.allocation,[...f,...m]);
      seam.connections.forEach((c,i)=> {
        const channels=seam.rows[i]!.map((row,axis)=>c.stiffness[axis]!*row.reduce((sum,v,j)=>sum+v*distribution[j]!,0));
        const basis=[scale(c.section.normal,c.sign),c.section.tangent1,scale(c.section.tangent2,c.sign)];
        // Native positive impulse acts on joint body1. Reorient to the graph's original A endpoint.
        const localForce=scale(fromBasis(basis,channels),c.sign),localMoment=scale(fromBasis(basis,channels.slice(3)),c.sign);
        const worldForce=rotate(this.callbacks.pose(seam.firstChunk).rotation,localForce),worldMoment=rotate(this.callbacks.pose(seam.firstChunk).rotation,localMoment);
        const graphRotation=inverse(this.callbacks.pose(c.a).rotation);
        this.graph.setMeasuredImpulse(
          c.index,
          scale(rotate(graphRotation,worldForce),wholeStepScale),
          scale(rotate(graphRotation,worldMoment),wholeStepScale),
          stepDt,
        );
      });
    }
    this.wakeMovingSeams(true);
  }
  private wakeMovingSeams(afterStep=false):void {
    for(const seam of this.seams.values()) {
      if(!seam.joint.isValid()) continue;
      const p1=worldPoint(seam.first,seam.joint.anchor1()),p2=worldPoint(seam.second,seam.joint.anchor2()),q1=seam.first.rotation(),q2=seam.second.rotation();
      const current=[...p1,...p2,q1.x,q1.y,q1.z,q1.w,q2.x,q2.y,q2.z,q2.w];
      const moved=seam.lastPose!==undefined&&current.some((v,i)=>Math.abs(v-seam.lastPose![i]!)>1e-4);
      if (afterStep || moved) {
        if(seam.moving!==moved) this.movingBodies=undefined;
        seam.moving=moved;
      }
      seam.lastPose=current;
      if(seam.moving) {this.callbacks.wake(seam.first);this.callbacks.wake(seam.second);}
    }
  }
  canBake(body:RAPIER.RigidBody):boolean {
    // Many bodies ask between seam updates. Index the same predicate once,
    // without changing the movement threshold or any wake callback.
    if(!this.movingBodies) {
      this.movingBodies=new Set();
      for(const seam of this.seams.values()) if(seam.moving) {
        this.movingBodies.add(seam.first.handle);this.movingBodies.add(seam.second.handle);
      }
    }
    return !this.movingBodies.has(body.handle);
  }
  dispose():void {
    for(const seam of this.seams.values()) if(seam.joint.isValid()) this.world.removeImpulseJoint(seam.joint,false);
    this.seams.clear();
    this.movingBodies=undefined;
    if(this.worldAnchor?.isValid()) this.world.removeRigidBody(this.worldAnchor);
    this.worldAnchor=undefined;
  }
}
