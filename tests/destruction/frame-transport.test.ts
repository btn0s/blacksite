import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import { applyListPatch } from "../../packages/destruction-domain/src/index";
import { GPUTransformPool } from "../../packages/destruction-render/src/gpu-pool";

describe("frame transport", () => {
  it("patches lists in place of resending them", () => {
    const base = ["a", "b", "c", "d"];
    expect(applyListPatch(base, { length: 4, indices: [1, 3], values: ["B", "D"] })).toEqual(["a", "B", "c", "D"]);
    expect(applyListPatch(base, { length: 5, indices: [4], values: ["e"] })).toEqual(["a", "b", "c", "d", "e"]);
    expect(applyListPatch(base, { length: 2, indices: [], values: [] })).toEqual(["a", "b"]);
    expect(base).toEqual(["a", "b", "c", "d"]);
  });

  it("uploads one range per touched texture row after the first full upload", () => {
    const pool = new GPUTransformPool(4096);
    const texture = pool.matrices, rowSlots = texture.image.width / 4;
    pool.write(1, new Matrix4().makeTranslation(1, 0, 0));
    pool.flush();
    expect(texture.updateRanges).toHaveLength(0);
    texture.onUpdate!(texture);
    pool.write(2, new Matrix4().makeTranslation(2, 0, 0));
    pool.write(5, new Matrix4().makeTranslation(5, 0, 0));
    pool.write(rowSlots + 1, new Matrix4().makeTranslation(3, 0, 0));
    pool.flush();
    expect(texture.updateRanges).toEqual([{ start: 32, count: 64 }, { start: (rowSlots + 1) * 16, count: 16 }]);
    texture.clearUpdateRanges();
    for (let slot = 1; slot < pool.capacity; slot += rowSlots) pool.write(slot, new Matrix4().makeTranslation(slot, 0, 0));
    pool.flush();
    expect(texture.updateRanges).toHaveLength(0);
    pool.dispose();
  });
});
