import { resetSystemHealthMonitor } from './systemHealthMonitor';
import { resetMemoryWatcher } from './memoryWatcher';
import { resetMotionDiagnostics } from './motionDiagnostics';
import { resetAudioLipSyncMonitor } from './audioLipSyncMonitor';
import { resetBehaviorAnalyzer } from './behaviorAnalyzer';
import { resetEventStream } from './eventStream';
import { resetAlerts } from './alertStore';
import { resetObservabilityHub } from './observabilityHub';
import { resetSelfHealingState } from './selfHealingEngine';
import { resetPredictiveEngineState } from './predictiveEngine';

/** Reset metric buffers when toggling observability on (keeps UI subscribers intact). */
export function resetAllObservability(): void {
  resetSystemHealthMonitor();
  resetMemoryWatcher();
  resetMotionDiagnostics();
  resetAudioLipSyncMonitor();
  resetBehaviorAnalyzer();
  resetEventStream();
  resetAlerts();
  resetSelfHealingState();
  resetPredictiveEngineState();
  resetObservabilityHub();
}
