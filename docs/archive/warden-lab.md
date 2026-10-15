# Warden

Games consume Warden through the Blacksite Git submodule and select `packages/warden` and `packages/warden-react` in their pnpm workspaces. See [Warden integration](warden.md).

A runnable tactical squad AI research foundation in TypeScript. The same fixed-step simulation runs headlessly, in a browser worker, or behind a WebSocket server. React Three Fiber renders an inspector; Koota owns physical state, XState owns skill lifecycles, and Effect owns session resources and asynchronous boundaries.

**This release is a symbolic baseline, not a validated human-indistinguishable FPS agent.** There are no trained weights, human datasets, or fabricated evaluation results. The learned-policy interface, safety gate, signed registry, and consented feature pipeline are implemented, but the live controller uses deterministic fallbacks. The arena uses planar collision and a tactical visibility graph, not a general production navmesh or complete FPS physics.

## Run

Requires Node 22.12+ (tested on Node 24).

```sh
npm ci
corepack pnpm dev
```

The inspector starts paused. Run a match, step one fixed tick, select an agent, switch between private belief, squad picture, and explicit debug truth, inspect decision scores and observation provenance, and export the replay. Scenario and seed changes reset the match. The interface supports keyboard focus, reduced motion, and narrow viewports.

```sh
corepack pnpm build             # strict TypeScript + production browser/worker bundles
npm test                  # cognition, authority, replay, model trust, networking
corepack pnpm test:training     # Python data-governance and sequence preflight checks
corepack pnpm check:boundaries  # dependency directions and uncontrolled cognition RNG/clock
corepack pnpm scenarios         # six scenarios × three seeds + invariants
corepack pnpm layouts -- current # visibility, contact timing, and engagement-distance report
corepack pnpm benchmark         # 16 initial agents; includes debug snapshot overhead
corepack pnpm bake -- crossfire # static map/visibility/edge annotations
corepack pnpm counterfactual    # saved snapshot vs one changed danger fact
corepack pnpm replay:verify -- path/to/exported-replay.json
corepack pnpm dogleg:report -- path/to/exported-replay.json # doorway timing and buddy geometry
corepack pnpm server           # isolated research sessions at ws://127.0.0.1:8787/session
```

Generated reports and reproducible decision snapshots go to `artifacts/` (gitignored). Performance is measured on the running machine; it is not a certification for a target hardware tier. CI runs typechecking, tests, boundary checks, and the production build.

## Implemented behavior

| Boundary | Working implementation |
| --- | --- |
| Authority | Fixed 30 Hz Koota simulation; bounded acceleration, stance speed, swept wall/agent collision, shared command validation, hitscan weapons, ammunition, reload timing, recoil, health, objective capture, round completion |
| Perception | View/FOV and occlusion tests, accumulated recognition, noisy vision positions, anonymous uncertain gunshot evidence, suppression, observation registry |
| Beliefs | Provenance-bearing private tracks; evidence validation; uncertainty growth and confidence decay; expiry; delayed, lossy, bounded radio; radio-only squad contact picture |
| Strategy/squad | Region/objective orders; bounded readiness/risk; exact role allocation with hysteresis; exclusive leased tactical slots; support-before-move contract and repair; safe regroup positions and visible buddy readiness before blind entries; bounded casualty-lane coverage with one responsible survivor |
| Deliberation | Snapshot-only utility-ranked methods, bounded symbolic action search, decision alternatives and terms, deterministic near-optimal selection, safe hold fallback |
| Execution | Parallel XState agent channels and interruptible sequential skill runner; progress/failure reporting; resource release on success, failure, interrupt, replacement, and disposal |
| Navigation/motor | Cached tactical visibility graph with obstacle-corner augmentation, bounded A*, bounded exact-start query reuse, body-safe recovery into route comfort margins, leased narrow-passage right-of-way, recent-threat attention during repositioning, acceleration-limited steering/aim, acquisition latency, correlated endpoint drift, burst discipline, swept friendly-fire gate |
| Learning boundary | Finite/schema/confidence/uncertainty/deadline/legal-output gate; deterministic fallback; immutable SHA-256 + Ed25519 artifact registration; cancellable inference service |
| Operations | Scoped Effect sessions, validated serialized worker protocol, isolated WebSocket sessions, command replay and checksums, headless scenarios, map baker, counterfactual API |
| Presentation | R3F scene, interpolated agents, beliefs and paths, live telemetry, decision/skill inspector, event log, replay export |
| Data/evaluation | Observation-only feature extraction, consent/retention gate, human-label guard, participant/match/map split validation, Wilson identification intervals, explicit unmet evidence manifest |

The six arenas have independently authored geometry: an offset-building courtyard, a breach room with a vestibule and service exit, twelve connected search chambers, protected recovery pockets with switchback approaches, warehouse aisles with endcaps, and a narrow dogleg with longer service routes. Objectives are offset, staging areas are screened, and primary/flank approaches follow different valid region routes when available. Region centers, entrances, objective positions, and nearby cover become tactical slots. Layout tests check spawn visibility, navigation connectivity, and approach divergence. Scenario names describe stress conditions; they do not claim a complete production breach/revive/search doctrine.

## Information and determinism rules

- Cognition cannot import simulation authority or receive its ECS world. Planners receive immutable `DecisionSnapshot` values.
- Own-squad positions and vitals are an explicit public team-HUD rule in this harness. Opponent coordinates reach cognition only through simulation-produced observations and delayed communications.
- A casualty creates a temporary lane-watch responsibility from own-team status and can use received radio evidence. It chooses reachable cover for the lost lane or reported sector, can transfer when the responder becomes unavailable, and expires. A watch does not identify an unseen killer or authorize firing; ordinary perception and weapon gates still apply.
- Private and shared inspector modes draw enemy estimates at belief means. **Truth is privileged debug data**, available only in the local research inspector. The server never broadcasts the inspector snapshot.
- Human and bot commands enter the same movement and weapon simulation. Bots cannot submit a damage or teleport operation.
- Decision random draws are keyed by seed/agent/system/tick. Instrumentation clocks never enter decision inputs. Stable ordering and quantized numeric boundaries support replay on the tested runtime; cross-engine floating-point equivalence is not yet certified.
- Recorded normalized commands replay through authority without rerunning planners. Replays record simulation, map, planner, feature-schema, and model versions and validate per-tick checksums. Command verification requires matching installed simulation/map content; historical controller versions remain provenance, so a controller fix does not invalidate a physics-compatible bug recording. These hashes detect regression; they are not cryptographic anti-cheat proofs.
- Expensive path connectivity is cached for immutable map geometry. Geometry changes require a new version/map object; incremental destructible geometry is not implemented.

## Packages

Logical packages use TypeScript `@blacksite/*` aliases; boundary rules run in CI. They share one pinned npm dependency graph.

```text
packages/
  ai-schema/      serializable observations, commands, snapshots, replay contracts
  sim-core/       simulation authority and observation generation
  ai-belief/      tracks and radio transport
  ai-nav/         geometry, cached visibility graph, paths
  ai-tactics/     reservations and scored tactical positions
  ai-squad/       director, roles, position commitments
  ai-planning/    utility/HTN methods and bounded GOAP
  ai-execution/   XState skill and agent lifecycles
  ai-motor/       movement, aim, reaction and fire gates
  ai-policy/      learned-output validation and fallback
  ai-runtime/     deterministic scheduling and orchestration
  ai-services/    Effect layers, signed model registry, inference deadlines
  ai-worker/      browser authority and validated message protocol
  ai-telemetry/   replay recorder and performance samples
  ai-scenarios/   authored arenas and tactical graph bake
  ai-tools/       isolated counterfactual planner experiments
  client-r3f/     presentation-only inspector
  server/         isolated headless WebSocket research sessions
  training/       features, consent/split guards, evaluation manifest
```

The core follows the libraries' documented boundaries: [Koota traits and worlds](https://github.com/pmndrs/koota), [XState actors](https://stately.ai/docs/actors), [Effect services](https://effect.website/docs/context-management/services/), and [R3F frame-loop performance](https://r3f.docs.pmnd.rs/advanced/pitfalls).

## Offline training

`packages/training/train.py` is an optional CPU PyTorch GRU trainer for movement, view deltas, and trigger suggestions. It consumes consented human `TraceRow` JSONL produced from the observation-only feature schema, a consent-record array, and a disjoint participant/match/map split manifest. Its windows are causal and do not cross players, matches, or tick gaps. Preflight validation has no ML dependency.

```sh
python3 -m venv .venv
.venv/bin/pip install -r packages/training/requirements.txt
.venv/bin/python packages/training/train.py --help
# Supply real consented traces, consent records, and the pre-registered split manifest.
```

Training produces unsigned research artifacts and held-out prediction errors; it does not register, sign, deploy, or certify the model. An optional ONNX export is provided for runtime integration. No training run was performed on human data, and the numerical PyTorch training/export path has not been executed in this workspace because PyTorch and the dataset are not installed. Only the dependency-free data preflight is tested here. The architecture follows the documented [PyTorch GRU interface](https://docs.pytorch.org/docs/stable/generated/torch.nn.GRU.html).

## Server protocol

The research server binds to loopback by default. Each WebSocket receives an independent match and ownership of one alpha seat, announced in `welcome`. Submit normalized `AgentCommand` JSON with that `agentId`, `source: "human"`, a monotonically increasing `sourceSequence`, and a tick in the next six ticks. Missing commands become neutral input. Other seats remain bots. Invalid, stale, oversized, or unowned commands are rejected. Snapshots include the owned seat, public team-HUD state, and belief-based contacts. Sessions are capped at eight, with payload and outgoing backpressure limits.

This is not a ranked multiplayer backend: there is no account authentication, matchmaking, cross-session combat, durable storage, lag compensation, reconnect protocol, or anti-cheat. Do not expose it as a production game service without adding those integrations.

## Remaining production and research work

1. Integrate the target game's true command, physics, weapons, interaction, and observation interfaces. Add polygon navmesh/floor hierarchy, acoustic portals, smoke/utility/destruction, incapacitation/revive rules, portal capacity reservations, and a complete set of joint maneuvers.
2. Collect consented cohort-specific human traces, register retention/deletion policies, pre-register evaluation margins and power, and train movement/aim/timing priors. Connect an ONNX/WASM inference adapter to the verified registry and policy gate; add shadow/canary/rollback controls. Selecting a hybrid config currently reports a symbolic fallback because no model is installed.
3. Run opponent, teammate, and replay studies, distributional equivalence tests, ablations, and adversarial panels. An identification interval containing 50% alone does **not** prove equivalence or adequate statistical power.
4. Add production authority/security/persistence, asynchronous path batching, incremental tactical fields, per-layer overload/degradation policies, target-hardware profiling, and cross-runtime replay validation.

`packages/training/evaluation-manifest.json` records these missing gates and explicitly disallows a human-indistinguishability claim. Runtime functionality and experimental evidence are separate deliverables.
