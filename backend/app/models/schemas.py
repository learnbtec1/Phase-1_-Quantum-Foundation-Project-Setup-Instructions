from pydantic import BaseModel
from typing import List

class EvaluationRequest(BaseModel):
    assignmentText: str
    studentText: str

class CriterionResult(BaseModel):
    code: str
    band: str
    achieved: bool
    evidence_quote: str
    verification_score: float

class EvaluationResponse(BaseModel):
    criteria: List[CriterionResult]
    feedback: str