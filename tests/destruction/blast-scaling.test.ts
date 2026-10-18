import { describe, expect, it } from "vitest";
import {
  MAX_CHARGE,
  MIN_CHARGE,
  blastImpulse,
  blastLoad,
  blastOverpressure,
  blastRange,
  blastReflection,
  validateCommand,
  type DestructionCommand,
} from "../../packages/destruction-domain/src/index";

const explosion = (charge: number): DestructionCommand => ({
  type: "explosion",
  id: 1,
  tick: 1,
  source: 1,
  position: [0, 1, 0],
  direction: [0, -1, 0],
  charge,
});

describe("charge-mass blast scaling", () => {
  it("matches the Kinney–Graham free-air overpressure curve", () => {
    for (const [scaled, kilopascals] of [
      [0.5, 4004],
      [1, 1009],
      [2, 208],
      [3, 82.3],
      [5, 29.2],
      [10, 10.0],
    ]) {
      expect(blastOverpressure(scaled!) / 1000).toBeCloseTo(kilopascals!, -Math.floor(Math.log10(kilopascals!)) + 2);
    }
  });
  it("matches the Kinney–Graham scaled impulse curve", () => {
    for (const [scaled, pascalSeconds] of [
      [1, 117.2],
      [3, 62.7],
      [10, 19.6],
    ]) {
      expect(blastImpulse(1, scaled!)).toBeCloseTo(pascalSeconds!, 0);
    }
  });
  it("scales by the cube root of the charge", () => {
    for (const distance of [2, 6, 15]) {
      const small = blastLoad(25, distance), large = blastLoad(200, distance * 2);
      expect(large.pressure).toBeCloseTo(small.pressure, 6);
      expect(large.impulse / small.impulse).toBeCloseTo(2, 6);
    }
    expect(blastRange(200, 2e6) / blastRange(25, 2e6)).toBeCloseTo(2, 6);
  });
  it("reflects between the acoustic and strong-shock Rankine–Hugoniot limits", () => {
    expect(blastReflection(1)).toBeCloseTo(2, 4);
    expect(blastReflection(1e12)).toBeCloseTo(8, 4);
  });
  it("inverts the reflected pressure curve", () => {
    for (const pressure of [1.8e5, 2e6, 2.8e7]) {
      expect(blastLoad(200, blastRange(200, pressure)).pressure / pressure).toBeCloseTo(1, 6);
    }
  });
  it("bounds the charge mass and rejects the removed blast knobs", () => {
    expect(validateCommand(explosion(200))).toBe(true);
    expect(validateCommand(explosion(MIN_CHARGE / 2))).toBe(false);
    expect(validateCommand(explosion(MAX_CHARGE * 2))).toBe(false);
    expect(validateCommand(explosion(Number.NaN))).toBe(false);
    const legacy = { type: "explosion", id: 1, tick: 1, source: 1, position: [0, 1, 0], direction: [0, -1, 0], radius: 10, strength: 10 };
    expect(validateCommand(legacy as unknown as DestructionCommand)).toBe(false);
  });
});
