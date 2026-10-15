"""Explicitly synthetic fixtures test admission only; they are never trained/exported."""
import copy
import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("ce_offline_train", Path(__file__).parents[1] / "packages/training/train.py")
TRAIN = importlib.util.module_from_spec(SPEC)
TORCH_WAS_LOADED = "torch" in sys.modules
SPEC.loader.exec_module(TRAIN)
NOW = datetime(2026, 10, 5, tzinfo=timezone.utc)


def fixtures():
    splits, consents, rows = {}, [], []
    for split in ("train", "validation", "test"):
        participant, match, map_version = f"synthetic-{split}", f"fixture-match-{split}", f"fixture-map-{split}"
        splits[split] = {"participants": [participant], "matches": [match], "maps": [map_version]}
        consents.append({"participantId": participant, "approved": True, "expiresAt": "2027-01-01T00:00:00Z", "datasetVersion": "SYNTHETIC_TEST_ONLY"})
        for tick in (0, 1, 2, 5, 6):
            rows.append({"participantId": participant, "matchId": match, "mapVersion": map_version, "patchVersion": "sim-1", "featureSchemaVersion": "belief-1", "features": [float(tick)] * 16, "command": {"tick": tick, "agentId": "fixture-actor", "sourceSequence": tick, "source": "human", "move": {"x": .5, "y": 0}, "lookDelta": {"yaw": .1, "pitch": 0}, "buttons": tick % 2, "stance": "stand"}})
    return rows, consents, splits


class TrainingPreflightTests(unittest.TestCase):
    def test_module_and_admission_need_no_torch(self):
        self.assertEqual(TORCH_WAS_LOADED, "torch" in sys.modules)
        rows, consent, splits = fixtures()
        admitted = TRAIN.preflight(iter(rows), consent, splits, NOW)
        self.assertEqual([len(admitted[s]) for s in TRAIN.SPLITS], [5, 5, 5])

    def test_current_consent_is_required_and_revocation_wins(self):
        for patch in ({"approved": False}, {"expiresAt": "2026-10-05T00:00:00Z"}, {"expiresAt": "not-a-date"}, {"expiresAt": "2027-01-01"}, {"datasetVersion": ""}):
            rows, consent, splits = fixtures()
            consent[0].update(patch)
            with self.subTest(patch=patch), self.assertRaisesRegex(ValueError, "consent"):
                TRAIN.preflight(rows, consent, splits, NOW)
        rows, consent, splits = fixtures()
        with self.assertRaisesRegex(ValueError, "consent"):
            TRAIN.preflight(rows, consent[1:], splits, NOW)

    def test_bot_unknown_schema_and_nonfinite_labels_are_rejected(self):
        patches = [lambda r: r["command"].update(source="ai"), lambda r: r["command"].update(buttons=1024), lambda r: r["command"].update(move=[]), lambda r: r["command"].update(lookDelta=None), lambda r: r.update(featureSchemaVersion="unknown"), lambda r: r.update(patchVersion="unknown"), lambda r: r["features"].__setitem__(0, float("nan")), lambda r: r["features"].__setitem__(0, float("inf")), lambda r: r["command"]["move"].update(x=float("nan")), lambda r: r["command"]["move"].update(x=1, y=1), lambda r: r["command"]["lookDelta"].update(yaw=.6), lambda r: r.update(features=[0] * 15)]
        for patch in patches:
            rows, consent, splits = fixtures()
            patch(rows[0])
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                TRAIN.preflight(rows, consent, splits, NOW)

    def test_malformed_metadata_produces_clean_admission_errors(self):
        rows, consent, splits = fixtures()
        with self.assertRaisesRegex(ValueError, "consent"):
            TRAIN.preflight(rows, consent + [{"participantId": "unused"}], splits, NOW)
        with self.assertRaisesRegex(ValueError, "consent"):
            TRAIN.preflight(rows, [None], splits, NOW)
        splits["train"] = None
        with self.assertRaisesRegex(ValueError, "split"):
            TRAIN.preflight(rows, consent, splits, NOW)

    def test_all_three_split_axes_are_disjoint(self):
        for axis in ("participants", "matches", "maps"):
            rows, consent, splits = fixtures()
            splits["validation"][axis] = copy.deepcopy(splits["train"][axis])
            with self.subTest(axis=axis), self.assertRaisesRegex(ValueError, "leakage"):
                TRAIN.preflight(rows, consent, splits, NOW)

    def test_mixed_split_membership_and_duplicate_ticks_are_rejected(self):
        rows, consent, splits = fixtures()
        rows[0]["mapVersion"] = splits["validation"]["maps"][0]
        with self.assertRaisesRegex(ValueError, "consistent disjoint split"):
            TRAIN.preflight(rows, consent, splits, NOW)
        rows, consent, splits = fixtures()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            TRAIN.preflight(rows + [copy.deepcopy(rows[0])], consent, splits, NOW)

    def test_causal_windows_reset_at_gaps_and_never_use_future_features(self):
        rows, consent, splits = fixtures()
        admitted = TRAIN.preflight(rows, consent, splits, NOW)
        windows = TRAIN.build_windows(admitted["train"], window=2)
        self.assertEqual([[frame[0] for frame in x] for x, _ in windows], [[0, 1], [1, 2], [5, 6]])
        self.assertEqual([y[4] for _, y in windows], [1, 0, 0])
        self.assertEqual(TRAIN.build_windows(admitted["train"], window=4), [])
        separated = [copy.deepcopy(admitted["train"][0]), copy.deepcopy(admitted["train"][1])]
        separated[1]["matchId"] = "other-match"
        self.assertEqual(TRAIN.build_windows(separated, window=2), [])


if __name__ == "__main__":
    unittest.main()
