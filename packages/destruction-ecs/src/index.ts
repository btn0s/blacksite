import { createWorld, trait, type Entity } from 'koota';
import type { DestructibleManifest, SimulationFrame } from '../../destruction-domain/src/index';
export const Transform = trait({
  px: 0,
  py: 0,
  pz: 0,
  qw: 1,
  qx: 0,
  qy: 0,
  qz: 0,
});
export const Fragment = trait({ generation: 0, local: 0, region: 0 });
export const Integrity = trait({ damage: 0, state: 0 });
export const RenderSlot = trait({ slot: -1 });
export class PresentationWorld {
  readonly world = createWorld();
  readonly entities: Array<Entity>;
  readonly secondaryEntities = new Map<number, Entity>();
  constructor(manifest: DestructibleManifest) {
    this.entities = manifest.fragments.map((f, slot) =>
      this.world.spawn(
        Fragment({ local: f.id, region: f.region }),
        Transform({ px: f.position[0], py: f.position[1], pz: f.position[2] }),
        Integrity,
        RenderSlot({ slot }),
      ),
    );
  }
  accept(frame: SimulationFrame) {
    for (let i = 0; i < this.entities.length; i++) {
      const t = i * 8,
        a = frame.transforms;
      this.entities[i]!.set(Transform, {
        px: a[t]!,
        py: a[t + 1]!,
        pz: a[t + 2]!,
        qw: a[t + 6]!,
        qx: a[t + 3]!,
        qy: a[t + 4]!,
        qz: a[t + 5]!,
      });
      this.entities[i]!.set(Integrity, {
        damage: a[t + 7]!,
        state: frame.states[i]!,
      });
    }
    const secondary = frame.secondary;
    const live = new Set(secondary?.fragments.map((fragment) => fragment.id));
    for (const [id, entity] of this.secondaryEntities) {
      if (live.has(id)) {
        continue;
      }
      entity.destroy();
      this.secondaryEntities.delete(id);
    }
    secondary?.fragments.forEach((fragment, slot) => {
      let entity = this.secondaryEntities.get(fragment.id);
      if (!entity) {
        entity = this.world.spawn(
          Fragment({
            generation: fragment.generation,
            local: fragment.id,
            region: fragment.region,
          }),
          Transform,
          Integrity,
          RenderSlot({ slot }),
        );
        this.secondaryEntities.set(fragment.id, entity);
      } else {
        entity.set(RenderSlot, { slot });
      }
      const a = secondary.transforms,
        t = slot * 8;
      entity.set(Transform, {
        px: a[t]!,
        py: a[t + 1]!,
        pz: a[t + 2]!,
        qw: a[t + 6]!,
        qx: a[t + 3]!,
        qy: a[t + 4]!,
        qz: a[t + 5]!,
      });
      entity.set(Integrity, {
        damage: a[t + 7]!,
        state: secondary.states[slot]!,
      });
    });
  }
  dispose() {
    this.world.destroy();
  }
}
