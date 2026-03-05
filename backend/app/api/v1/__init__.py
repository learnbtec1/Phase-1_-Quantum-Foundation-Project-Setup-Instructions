from fastapi import APIRouter

router = APIRouter()

from .endpoints import assessment, tutor

router.include_router(assessment.router, prefix="/evaluate", tags=["evaluation"])
router.include_router(tutor.router, prefix="/tutor", tags=["tutor"])