import { DM } from './diagnosticsMetrics';
import { diagInc, diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

export type SchedulerBlockReason =
  | 'MIN_BETWEEN'
  | 'RECENT_ACTION'
  | 'VRMA_BLOCK'
  | 'THINKING_SKIP'
  | 'IDLE_RANDOM';

let _blocksSinceFlush = 0;
let _lastBlockReasonLabel = 'NONE';

const LABEL: Record<SchedulerBlockReason, string> = {
  MIN_BETWEEN: 'min_between_scheduler_plays',
  RECENT_ACTION: 'recent_behavior_action',
  VRMA_BLOCK: 'vrma_blocks_ambient',
  THINKING_SKIP: 'thinking_skip_low_replay',
  IDLE_RANDOM: 'idle_random_hold_skip',
};

export function diagnosticsSchedulerBlocked(reason: SchedulerBlockReason): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.SCHEDULER;
  diagScalars.lastStageId = STAGE.SCHEDULER_TICK;
  diagScalars.lastFileId = FILE_ID.motionScheduler;
  _blocksSinceFlush++;
  _lastBlockReasonLabel = LABEL[reason];

  switch (reason) {
    case 'MIN_BETWEEN':
      diagInc(DM.SCHED_BLOCKED_MIN_BETWEEN);
      break;
    case 'RECENT_ACTION':
      diagInc(DM.SCHED_BLOCKED_RECENT_ACTION);
      break;
    case 'VRMA_BLOCK':
      diagInc(DM.SCHED_BLOCKED_VRMA);
      break;
    case 'THINKING_SKIP':
      diagInc(DM.SCHED_BLOCKED_THINKING);
      break;
    case 'IDLE_RANDOM':
      diagInc(DM.SCHED_BLOCKED_IDLE_RANDOM);
      break;
    default:
      break;
  }
}

export function diagnosticsSchedulerDispatched(): void {
  diagInc(DM.SCHED_DISPATCH_OK);
}

export function diagnosticsSchedulerConsumeFlush(): {
  blocksSinceFlush: number;
  lastBlockReasonLabel: string;
} {
  const out = { blocksSinceFlush: _blocksSinceFlush, lastBlockReasonLabel: _lastBlockReasonLabel };
  _blocksSinceFlush = 0;
  _lastBlockReasonLabel = 'NONE';
  return out;
}
