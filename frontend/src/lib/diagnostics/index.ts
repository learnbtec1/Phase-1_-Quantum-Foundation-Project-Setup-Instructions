/**
 * Central diagnostics mesh — import submodules as needed.
 * Primary consumer hook: {@link diagnosticsFrameEnd} from `./diagnosticsApi`.
 */
export * from './diagnosticsSeverity';
export * from './diagnosticsTypes';
export * from './diagnosticsMetrics';
export * from './diagnosticsRegistry';
export * from './diagnosticsStore';
export * from './diagnosticsBus';
export * from './diagnosticsReporter';
export * from './diagnosticsRuntime';
export * from './diagnosticsMotion';
export * from './diagnosticsExecution';
export * from './diagnosticsScheduler';
export * from './diagnosticsVRM';
export * from './diagnosticsSpeech';
export * from './diagnosticsSemantic';
export * from './diagnosticsTimeline';
export * from './diagnosticsPoseStage';
export * from './diagnosticsBiomech';
export * from './diagnosticsApi';
export {
  startDiagnosticsAnalyzer,
  stopDiagnosticsAnalyzer,
  buildRuntimeSummaryTxt,
  __runDiagnosticsAnalyzerOnceForTests,
} from './diagnosticsAnalyzer';
export {
  startRuntimeTimelineRecorder,
  stopRuntimeTimelineRecorder,
  getTimelineVisualHealthPenalty,
  getBehavioralForensicsChains,
} from './runtimeTimelineRecorder';
export * from './diagnosticsTimelineProbe';
export { DiagnosticsOverlay } from './diagnosticsOverlay';
