import { readFile } from "node:fs/promises";
import { validateManifest } from "./index";
import { createScenario, createOrganicScenario } from "../../destruction-testkit/src/index";
import type { ScenarioId } from "../../destruction-domain/src/index";

const paths = process.argv.slice(2);
const inputs = paths.length
  ? await Promise.all(
      paths.map(async (path) => ({
        name: path,
        manifest: JSON.parse(await readFile(path, "utf8")) as unknown,
      })),
    )
  : (["building", "wall", "cantilever", "bridge", "complex"] as ScenarioId[]).map((scenario) => ({
      name: scenario,
      manifest: createScenario(scenario),
    }));
if (!paths.length)
  inputs.push({
    name: "building / organic",
    manifest: createOrganicScenario("building"),
  });
let valid = true;
for (const { name, manifest } of inputs) {
  const report = validateManifest(manifest);
  valid &&= report.valid;
  console.log(JSON.stringify({ name, ...report }, null, 2));
}
if (!valid) process.exitCode = 1;
