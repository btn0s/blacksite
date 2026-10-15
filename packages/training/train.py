#!/usr/bin/env python3
"""Offline consented behavioral cloning. Exports UNSIGNED research artifacts only."""
import argparse
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCHEMA, PATCH, FEATURE_COUNT, SPLITS = "belief-1", "sim-1", 16, ("train", "validation", "test")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value)


def preflight(rows, consents, splits, now=None):
    """Stdlib-only admission: no torch import or model artifact before this succeeds."""
    now = now or datetime.now(timezone.utc)
    require(now.tzinfo is not None, "Consent evaluation needs a timezone-aware clock")
    require(isinstance(splits, dict) and set(splits) == set(SPLITS), "Invalid split manifest")
    require(all(isinstance(splits[s], dict) for s in SPLITS), "Invalid split entries")
    for axis in ("participants", "matches", "maps"):
        seen = set()
        for split in SPLITS:
            values = splits[split].get(axis, [])
            require(isinstance(values, list) and values and all(isinstance(v, str) and v for v in values), f"Invalid {axis}")
            require(len(set(values)) == len(values) and not seen.intersection(values), f"{axis} leakage")
            seen.update(values)
    require(isinstance(consents, list), "Consent must be a JSON list")
    approvals = {}
    for consent in consents:
        require(isinstance(consent, dict), "Invalid consent record")
        require(isinstance(consent.get("datasetVersion"), str) and consent["datasetVersion"], "Invalid consent datasetVersion")
        participant = consent.get("participantId")
        require(isinstance(participant, str) and participant and participant not in approvals, "Duplicate/invalid consent")
        approvals[participant] = consent
    admitted, identities = {s: [] for s in SPLITS}, set()
    for row in rows:
        require(isinstance(row, dict), "Invalid trace row")
        participant, match, map_version = row.get("participantId"), row.get("matchId"), row.get("mapVersion")
        require(all(isinstance(x, str) and x for x in (participant, match, map_version)), "Missing trace identity")
        consent = approvals.get(participant, {})
        try:
            expiry = datetime.fromisoformat(consent.get("expiresAt", "").replace("Z", "+00:00"))
        except (TypeError, ValueError, AttributeError):
            expiry = datetime.min.replace(tzinfo=timezone.utc)
        require(consent.get("approved") is True and expiry.tzinfo and expiry > now and bool(consent.get("datasetVersion")), "No current participant consent")
        require(row.get("featureSchemaVersion") == SCHEMA and row.get("patchVersion") == PATCH, "Unknown schema or patch")
        features, command = row.get("features"), row.get("command", {})
        require(isinstance(features, list) and len(features) == FEATURE_COUNT and all(numeric(v) and abs(v) <= 1e6 for v in features), "Invalid/non-finite features")
        require(isinstance(command, dict) and command.get("source") == "human", "Bot or missing human labels")
        tick, agent = command.get("tick"), command.get("agentId")
        require(type(tick) is int and tick >= 0 and isinstance(agent, str) and agent, "Invalid command identity")
        require(type(command.get("sourceSequence")) is int and command["sourceSequence"] >= 0, "Invalid sequence")
        require(type(command.get("buttons")) is int and 0 <= command["buttons"] <= 1023 and command.get("stance") in ("stand", "crouch", "prone"), "Invalid buttons/stance")
        move, look = command.get("move", {}), command.get("lookDelta", {})
        require(isinstance(move, dict) and isinstance(look, dict), "Invalid movement/look records")
        values = [move.get("x"), move.get("y"), look.get("yaw"), look.get("pitch")]
        require(all(numeric(v) for v in values), "Non-finite command")
        require(math.hypot(*values[:2]) <= 1.000001 and abs(values[2]) <= .5 and abs(values[3]) <= .3, "Command outside authority bounds")
        owners = [s for s in SPLITS if participant in splits[s]["participants"] and match in splits[s]["matches"] and map_version in splits[s]["maps"]]
        require(len(owners) == 1, "Row outside a consistent disjoint split")
        identity = (participant, match, tick)
        require(identity not in identities, "Duplicate participant/match/tick")
        identities.add(identity)
        admitted[owners[0]].append(row)
    require(all(admitted.values()), "Every split needs observed rows")
    return admitted


def build_windows(rows, window=16):
    """Causal windows include current features; reset at any tick gap or player/match change."""
    require(type(window) is int and window > 0, "Invalid window")
    groups = defaultdict(list)
    for row in rows:
        groups[(row["participantId"], row["matchId"], row["command"]["agentId"], row["mapVersion"], row["patchVersion"])].append(row)
    samples = []
    for key in sorted(groups):
        history, previous = [], None
        for row in sorted(groups[key], key=lambda r: r["command"]["tick"]):
            command = row["command"]
            if previous is None or command["tick"] != previous + 1:
                history = []
            history = (history + [list(row["features"])])[-window:]
            previous = command["tick"]
            if len(history) == window:
                samples.append((list(history), [command["move"]["x"], command["move"]["y"], command["lookDelta"]["yaw"], command["lookDelta"]["pitch"], float(bool(command["buttons"] & 1))]))
    return samples


def train(args, admitted, consents):
    samples = {s: build_windows(admitted[s], args.window) for s in SPLITS}
    require(all(samples.values()), "Each split needs a contiguous full window; no padded/fabricated traces")
    require(not args.out.exists(), "Output directory must be new")
    if args.onnx:
        import importlib.util
        require(importlib.util.find_spec("onnx") is not None, "--onnx requires the optional onnx package")
    import torch  # Deliberately after all stdlib admission checks.
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    tensors = {s: (torch.tensor([x for x, _ in samples[s]], dtype=torch.float32), torch.tensor([y for _, y in samples[s]], dtype=torch.float32)) for s in SPLITS}
    train_x, train_y = tensors["train"]
    mean, scale = train_x.mean((0, 1)), train_x.std((0, 1), unbiased=False).clamp_min(.01)

    class MotorPrior(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("mean", mean)
            self.register_buffer("scale", scale)
            self.gru, self.head = torch.nn.GRU(FEATURE_COUNT, 32, batch_first=True), torch.nn.Linear(32, 5)
            self.register_buffer("look_bounds", torch.tensor([.5, .3]))

        def forward(self, features):
            sequence, _ = self.gru(((features - self.mean) / self.scale).clamp(-10, 10))
            raw = self.head(sequence[:, -1])
            move = raw[:, :2].tanh()
            move = move / torch.linalg.vector_norm(move, dim=1, keepdim=True).clamp_min(1)
            return torch.cat((move, raw[:, 2:4].tanh() * self.look_bounds, raw[:, 4:5]), dim=1)

    model = MotorPrior().cpu()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    def losses(predicted, expected):
        regression = (predicted[:, :4] - expected[:, :4]).square().mean()
        fire = torch.nn.functional.binary_cross_entropy_with_logits(predicted[:, 4], expected[:, 4])
        return regression, fire
    def evaluate(split):
        model.eval()
        with torch.no_grad():
            x, y = tensors[split]
            prediction = torch.cat([model(batch) for batch in x.split(256)])
            mse, bce = losses(prediction, y)
            return {"commandMse": mse.item(), "moveMae": (prediction[:, :2] - y[:, :2]).abs().mean().item(), "lookMae": (prediction[:, 2:4] - y[:, 2:4]).abs().mean().item(), "fireBce": bce.item()}
    best, checkpoint, selected_epoch = math.inf, None, 0
    for epoch in range(args.epochs):
        model.train()
        for indices in torch.randperm(len(train_x)).split(64):
            optimizer.zero_grad()
            regression, fire = losses(model(train_x[indices]), train_y[indices])
            loss = regression + .2 * fire
            require(bool(torch.isfinite(loss)), "Non-finite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
        validation = evaluate("validation")
        score = validation["commandMse"] + .2 * validation["fireBce"]
        if score < best:
            best, selected_epoch = score, epoch + 1
            checkpoint = {k: v.detach().clone() for k, v in model.state_dict().items()}
    require(checkpoint is not None, "No finite validated checkpoint")
    model.load_state_dict(checkpoint)
    metrics = {s: evaluate(s) for s in ("validation", "test")}
    args.out.mkdir(parents=True, exist_ok=False)
    example = train_x[:1]
    artifact = args.out / "motor-prior.pt"
    torch.jit.trace(model.eval(), example, check_trace=True).save(str(artifact))
    if args.onnx:
        torch.onnx.export(model, example, str(args.out / "motor-prior.onnx"), input_names=["features"], output_names=["motor_and_fire_logit"], dynamic_axes={"features": {0: "batch"}, "motor_and_fire_logit": {0: "batch"}}, opset_version=17, dynamo=False)
    participants = {r["participantId"] for split in SPLITS for r in admitted[split]}
    manifest = {"status": "UNSIGNED_RESEARCH_ONLY", "signature": None, "deployable": False, "requires": ["human-likeness-evaluation", "safety-calibration", "target-hardware-benchmark", "artifact-signing"], "featureSchemaVersion": SCHEMA, "patchVersion": PATCH, "architecture": "GRU(16,32)+linear(32,5)", "window": args.window, "outputs": ["move.x", "move.y", "look.yaw", "look.pitch", "fire.logit"], "seed": args.seed, "selectedEpoch": selected_epoch, "torchVersion": torch.__version__, "determinismScope": "same CPU/software versions", "counts": {s: len(samples[s]) for s in SPLITS}, "metrics": metrics, "inputSha256": {name: hashlib.sha256(getattr(args, name).read_bytes()).hexdigest() for name in ("traces", "consent", "splits")}, "consentDatasetVersions": sorted({c["datasetVersion"] for c in consents if c["participantId"] in participants}), "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in args.out.iterdir()}}
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"status": manifest["status"], "metrics": metrics}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("traces", "consent", "splits", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--seed", type=int, default=2048)
    parser.add_argument("--window", type=int, default=16)
    parser.add_argument("--onnx", action="store_true", help="Also export ONNX; requires optional onnx package")
    args = parser.parse_args()
    require(args.epochs > 0 and 0 <= args.seed < 2**63 and args.window > 0, "Invalid training settings")
    consents, splits = json.loads(args.consent.read_text()), json.loads(args.splits.read_text())
    rows = (json.loads(line) for line in args.traces.read_text().splitlines() if line.strip())
    train(args, preflight(rows, consents, splits), consents)


if __name__ == "__main__":
    main()
