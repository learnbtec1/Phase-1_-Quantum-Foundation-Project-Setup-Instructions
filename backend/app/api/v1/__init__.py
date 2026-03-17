from fastapi import APIRouter

router = APIRouter()

from .endpoints import assessment, tutor, btec_ingest

router.include_router(assessment.router, prefix="/evaluate", tags=["evaluation"])
router.include_router(tutor.router, prefix="/tutor", tags=["tutor"])
router.include_router(btec_ingest.router, tags=["BTEC Knowledge"])