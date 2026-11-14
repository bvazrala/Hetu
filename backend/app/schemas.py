"""Typed shapes shared by the API and its tests.

`Analysis` is a draft of what `POST /analyze` will return. No endpoint
returns it yet. Today it is used to validate the hand-written sample in
`examples/sample_proofs.json`, which the frontend renders in Structured mode.
The TypeScript mirror of these types is `frontend/src/lib/types.ts`.
"""

from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]


class Span(BaseModel):
    """Character offsets into the student's draft. `end` is exclusive.

    Python counts code points and JavaScript counts UTF-16 units. They agree
    for ordinary math text such as "n²" and "√". Revisit before accepting
    characters outside the Basic Multilingual Plane.
    """

    start: int = Field(ge=0)
    end: int = Field(ge=0)


class Node(BaseModel):
    """One statement recognized in the draft."""

    id: str
    type: Literal["assumption", "claim", "inference", "conclusion"]
    text: str
    span: Span | None = None


class Edge(BaseModel):
    """`source` relies on `target`."""

    source: str
    target: str
    relation: Literal["depends_on"]


class Observation(BaseModel):
    """One gap in the reasoning, phrased as a question for the student."""

    target: str  # id of the node the question is about
    issue_type: Literal["unjustified_step", "invalid_step"]
    evidence: str  # text quoted from the draft
    # "tool_verified" is reserved for results confirmed by a deterministic
    # check. Everything else, including model judgments, is "not_verified".
    verification: Literal["tool_verified", "not_verified"]
    question: str
    hint: str | None = None


class Analysis(BaseModel):
    # "sample" marks hand-written fixture content. "live" is reserved for
    # real analysis results once inference exists.
    source: Literal["sample", "live"]
    nodes: list[Node]
    edges: list[Edge]
    observations: list[Observation]
    limitations: list[str]
