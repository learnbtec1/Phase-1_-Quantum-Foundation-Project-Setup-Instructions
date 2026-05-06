import { DM } from './diagnosticsMetrics';
import { diagInc, diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

export function diagnosticsSemanticCooldownHit(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.SEMANTIC;
  diagScalars.lastStageId = STAGE.SEMANTIC_RESOLVE;
  diagScalars.lastFileId = FILE_ID.semanticGestureBridge;
  diagInc(DM.SEMANTIC_COOLDOWN_STARVE);
}

export function diagnosticsSemanticIdleChosen(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.SEMANTIC;
  diagScalars.lastStageId = STAGE.SEMANTIC_RESOLVE;
  diagScalars.lastFileId = FILE_ID.semanticGestureBridge;
  diagInc(DM.SEMANTIC_IDLE_FALLBACK);
}
