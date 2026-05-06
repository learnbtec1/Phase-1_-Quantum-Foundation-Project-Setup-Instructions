import { DM } from './diagnosticsMetrics';
import { diagInc, diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

/** Unusually deep FIFO — possible stall / churn. */
export function diagnosticsTimelineQueueDepth(depth: number): void {
  if (depth <= 24) return;
  diagScalars.lastSubsystemId = SUBSYSTEM.TIMELINE;
  diagScalars.lastStageId = STAGE.TIMELINE_TICK;
  diagScalars.lastFileId = FILE_ID.behaviorTimeline;
  diagInc(DM.TIMELINE_QUEUE_BACKLOG);
}

export function diagnosticsTimelineSnapShort(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.TIMELINE;
  diagScalars.lastStageId = STAGE.TIMELINE_TICK;
  diagScalars.lastFileId = FILE_ID.behaviorTimeline;
  diagInc(DM.TIMELINE_SNAP_SHORT_EVENT);
}
