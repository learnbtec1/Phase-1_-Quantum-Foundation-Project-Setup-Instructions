import { DM } from './diagnosticsMetrics';
import { diagInc } from './diagnosticsStore';

/** Speaking but unified motion energy is effectively zero — desync risk. */
export function diagnosticsSpeechEnergyMismatch(speaking: boolean, motionEnergyUnified: number): void {
  if (speaking && motionEnergyUnified < 1e-4) {
    diagInc(DM.ENERGY_SPEAKING_ZERO_RAW);
  }
}
