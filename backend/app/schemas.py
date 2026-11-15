"""Typed shapes of the API's requests and responses.

`Analysis` is what `POST /analyze` returns. The hand-written sample in
`examples/sample_proofs.json` uses the same shape, and a test keeps the two
in step. The TypeScript mirror of these types is `frontend/src/lib/types.ts`.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok"]


# Input caps keep one request small and its cost predictable.
MAX_PROBLEM_CHARS = 1000
MAX_DRAFT_CHARS = 4000
MAX_QUESTION_CHARS = 1000
MAX_CHALLENGE_CHARS = 600


def _require_content(value: str) -> str:
    if not value.strip():
        raise ValueError("This field is empty.")
    return value


class Challenge(BaseModel):
    """A student's disagreement with one question from an earlier analysis."""

    step_text: str = Field(min_length=1, max_length=MAX_DRAFT_CHARS)
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    reason: str = Field(min_length=1, max_length=MAX_CHALLENGE_CHARS)

    _reason_has_content = field_validator("reason")(_require_content)


class AnalyzeRequest(BaseModel):
    problem: str = Field(default="", max_length=MAX_PROBLEM_CHARS)
    draft: str = Field(min_length=1, max_length=MAX_DRAFT_CHARS)
    challenge: Challenge | None = None

    _draft_has_content = field_validator("draft")(_require_content)


class Span(BaseModel):
    """Offsets into the student's draft, counted in Unicode code points. `end` is exclusive.

    JavaScript strings count UTF-16 units instead. The frontend converts in
    `frontend/src/lib/spans.ts` before it highlights or selects text.
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


class ChallengeResult(BaseModel):
    """How the workflow answered a student's challenge."""

    # "withdrawn": the challenged step is no longer questioned.
    # "maintained": the same step is still questioned.
    outcome: Literal["withdrawn", "maintained"]
    response: str


class Analysis(BaseModel):
    # "sample" marks hand-written fixture content. "live" marks a result
    # produced by the model workflow for this request.
    source: Literal["sample", "live"]
    nodes: list[Node]
    edges: list[Edge]
    observations: list[Observation]
    limitations: list[str]
    # Present only when the request carried a challenge.
    challenge: ChallengeResult | None = None
