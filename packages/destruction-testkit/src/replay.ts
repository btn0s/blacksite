import {
  SIMULATION_VERSION,
  type DestructibleManifest,
  type ReplayLog,
  type ScenarioId,
} from "../../destruction-domain/src/index";
import { createScenario } from "./index";
import { createOrganicScenario } from "./organic";
const LEGACY_HASHES: Partial<Record<ScenarioId, string>> = {
  building: "cascade-v1-687ff7cb",
  wall: "cascade-v1-07209612",
  cantilever: "cascade-v1-c79c882f",
  bridge: "cascade-v1-90eaefea",
};
export function prepareFixtureReplay(
  log: ReplayLog,
  manifest: DestructibleManifest,
): { log: ReplayLog; upgraded: boolean; geometryChanged?: boolean } {
  if (log.scenario !== manifest.scenario)
    throw new Error("Select the replay’s test structure before importing.");
  if (log.assetHash === manifest.assetHash) return { log, upgraded: false };
  const canonicalHash = createScenario(log.scenario).assetHash;
  const legacy = !log.simulationVersion && log.assetHash === LEGACY_HASHES[log.scenario];
  const geometryChanged =
    log.scenario === "building" &&
    manifest.assetHash === createOrganicScenario("building").assetHash &&
    (legacy ||
      (log.assetHash === canonicalHash &&
        (!log.simulationVersion ||
          log.simulationVersion === SIMULATION_VERSION ||
          log.simulationVersion === "rigid-bond-equilibrium-1")));
  if (!geometryChanged && !(legacy && manifest.assetHash === canonicalHash))
    throw new Error("Replay content hash does not match the loaded structure.");
  return {
    log: {
      ...log,
      assetHash: manifest.assetHash,
      simulationVersion: SIMULATION_VERSION,
    },
    upgraded: true,
    ...(geometryChanged ? { geometryChanged: true } : {}),
  };
}
