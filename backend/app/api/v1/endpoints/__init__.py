from fastapi import APIRouter

router = APIRouter()

from . import assessment, tutor

router.include_router(assessment.router, prefix="/assessment", tags=["assessment"])
router.include_router(tutor.router, prefix="/tutor", tags=["tutor"])