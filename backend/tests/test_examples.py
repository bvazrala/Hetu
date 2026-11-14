"""Checks that the example fixture stays consistent with the API schema."""

import json
from pathlib import Path

from app.schemas import Analysis

FIXTURE = Path(__file__).resolve().parents[2] / "examples" / "sample_proofs.json"
EXAMPLES = json.loads(FIXTURE.read_text(encoding="utf-8"))["examples"]


def test_fixture_covers_each_expected_judgment():
    assert {e["expected"] for e in EXAMPLES} == {"correct", "incomplete", "invalid"}


def test_example_ids_are_unique():
    ids = [e["id"] for e in EXAMPLES]
    assert len(ids) == len(set(ids))


def test_sample_analyses_match_schema_and_draft():
    samples = [e for e in EXAMPLES if "sample_analysis" in e]
    assert samples, "expected at least one hand-written sample analysis"

    for example in samples:
        draft = example["draft"]
        analysis = Analysis.model_validate(example["sample_analysis"])
        assert analysis.source == "sample"

        node_ids = {node.id for node in analysis.nodes}
        for node in analysis.nodes:
            # Each span must point at the exact text it claims to quote.
            assert node.span is not None
            assert draft[node.span.start : node.span.end] == node.text
        for edge in analysis.edges:
            assert {edge.source, edge.target} <= node_ids
        for observation in analysis.observations:
            assert observation.target in node_ids
            assert observation.evidence in draft
