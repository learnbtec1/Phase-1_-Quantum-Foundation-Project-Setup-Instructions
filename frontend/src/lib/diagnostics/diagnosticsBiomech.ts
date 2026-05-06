import { diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

export function diagnosticsBiomechEnter(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.BIOMECH;
  diagScalars.lastStageId = STAGE.BIOMECH;
  diagScalars.lastFileId = FILE_ID.biomechanicalCorrectionLayer;
}
