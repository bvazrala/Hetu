"""Typed shapes of the API's requests and responses.

`ChatResponse` is what `POST /chat` returns and `Analysis` is what
`POST /analyze` returns. The TypeScript mirror of these types is
`frontend/src/lib/types.ts`.
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


# Conversation limits. A request carries recent turns only, so its size and
# cost stay bounded however long the session runs.
MAX_MESSAGE_CHARS = 6000
MAX_MESSAGES = 24
MAX_NOTE_CHARS = 200
MAX_NOTES = 8

Specialist = Literal["mathematics", "science", "programming", "humanities", "logic"]

# What Hetu decided to do in a turn. Internal: the student sees the reply, not this label.
Action = Literal[
    "teach",
    "explain",
    "demonstrate",
    "explore",
    "inspect_reasoning",
    "challenge_assumption",
    "correct_misconception",
    "practice",
    "check_understanding",
    "answer_directly",
    "reconsider",
]


class ChatMessage(BaseModel):
    role: Literal["student", "hetu"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class LearningState(BaseModel):
    """Rough notes about one session. They are estimates, not measurements."""

    topic: str | None = Field(default=None, max_length=MAX_NOTE_CHARS)
    goal: str | None = Field(default=None, max_length=MAX_NOTE_CHARS)
    concepts: list[str] = Field(default_factory=list, description="Concepts discussed so far.")
    # Only what the student has shown in their own messages, not what was explained to them.
    understood: list[str] = Field(default_factory=list, description="What the student has demonstrated.")
    misconceptions: list[str] = Field(default_factory=list, description="Possible mix-ups. Uncertain.")

    @field_validator("concepts", "understood", "misconceptions")
    @classmethod
    def _keep_notes_short(cls, notes: list[str]) -> list[str]:
        return [note.strip()[:MAX_NOTE_CHARS] for note in notes if note.strip()][:MAX_NOTES]


class WorkspaceContext(BaseModel):
    """The student's workspace draft, when they chose to share it with a message."""

    problem: str = Field(default="", max_length=MAX_PROBLEM_CHARS)
    draft: str = Field(min_length=1, max_length=MAX_DRAFT_CHARS)


class ProofContext(BaseModel):
    """The open question from the latest proof inspection, so a disagreement can be reconsidered."""

    problem: str = Field(default="", max_length=MAX_PROBLEM_CHARS)
    draft: str = Field(min_length=1, max_length=MAX_DRAFT_CHARS)
    step_text: str = Field(min_length=1, max_length=MAX_DRAFT_CHARS)
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    learning_state: LearningState | None = None
    workspace: WorkspaceContext | None = None
    proof_context: ProofContext | None = None

    @field_validator("messages")
    @classmethod
    def _student_speaks_last(cls, messages: list[ChatMessage]) -> list[ChatMessage]:
        if messages[-1].role != "student":
            raise ValueError("The last message must come from the student.")
        return messages


class Inspection(BaseModel):
    """A proof analysis together with the exact text it was made for."""

    problem: str
    draft: str
    analysis: Analysis


class ToolCheck(BaseModel):
    """The result of one deterministic check. This is computed, not a model's opinion."""

    tool: str
    result: str


class ChatResponse(BaseModel):
    reply: str
    action: Action
    # Who answered: the lead first, then anyone it consulted. Empty when the coach answered alone.
    specialists: list[Specialist]
    learning_state: LearningState
    inspection: Inspection | None = None
    checks: list[ToolCheck] = Field(default_factory=list)
