#!/usr/bin/env python3
"""
Minimal headless probe: attaches to a running Next.js page that exposes the shared TTS playback <audio>.

Usage (Python Playwright installed: pip install playwright && playwright install chromium):
  set BASE_URL=http://localhost:3001
  set AVATAR_PATH=/avatar-agent
  python scripts/tts_playwright_audio_probe.py

The script mocks HTMLMediaElement.play to increment a counter, then invokes window.__cogniSpeakWithTTS('Probe …')
via page.evaluate — asserts play() ran at least once after the mocked chain resolves.

If LIP_SYNC_VALIDATE=1 is set, after speak it runs await window.__cogniLipSyncValidateBurst(...)
(requires avatar scene + JWT + visemes — may fail headless if Cognie not started or no LipSync frame yet).

When COGNI_VALIDATE_WRITE_JSON=1, writes artifacts/cogni-validate-report.json (or COGNI_VALIDATE_REPORT path)
with production-style gates: audioTimeDelta, morphPositiveFrames, playbackDominant.

If __cogniSpeakWithTTS is missing or TTS HARD FAILs (no JWT / no backend / no audio), the assertion fails visibly.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def _compute_gates(
    lip: dict | None, *, lip_validate: bool
) -> tuple[bool, list[str], dict]:
    """Production-style numeric checks layered on burst result."""
    reasons: list[str] = []
    ok = True
    detail: dict = {}

    audio_min = float(os.environ.get('COGNI_GATE_AUDIO_TIME_DELTA_MIN', '0.028'))
    morph_min = int(os.environ.get('COGNI_GATE_MORPH_POSITIVE_MIN', '1'))

    if not lip_validate:
        return True, [], {'skipped': True}

    if not lip:
        return False, ['lip_sync_result_null'], {}

    detail['lip_burst_ok'] = lip.get('ok')
    detail['audio_time_delta'] = lip.get('audioTimeDelta')
    detail['morph_positive_frames'] = lip.get('morphPositiveFrames')
    detail['strict_frame_pass_count'] = lip.get('strictFramePassCount')

    last_probe = lip.get('lastProbe') if isinstance(lip.get('lastProbe'), dict) else {}
    detail['playback_dominant_last'] = last_probe.get('playbackDominant')

    if lip.get('err'):
        ok = False
        reasons.append(f"lip_eval_err:{lip.get('err')}")

    if not lip.get('ok'):
        ok = False
        reasons.append('lip_burst_ok_false')
        if lip.get('failures'):
            reasons.append(f"failures:{';'.join(map(str, lip['failures']))}")

    atd = lip.get('audioTimeDelta')
    if isinstance(atd, (int, float)):
        if float(atd) < audio_min:
            ok = False
            reasons.append(f'audio_time_delta_below_{audio_min}')
    elif lip.get('activeSampleCount', 0):
        ok = False
        reasons.append('audio_time_delta_missing')

    mpos = lip.get('morphPositiveFrames')
    if isinstance(mpos, int):
        if mpos < morph_min:
            ok = False
            reasons.append(f'morph_positive_frames_below_{morph_min}')
    elif lip.get('activeSampleCount', 0):
        ok = False
        reasons.append('morph_positive_frames_missing')

    strict_n = lip.get('strictFramePassCount')
    if lip.get('activeSampleCount', 0) > 0:
        if not isinstance(strict_n, int) or strict_n < 1:
            ok = False
            reasons.append('playback_dominant_strict_frames_zero')

    return ok, reasons, detail


def _recovery_ci_gates(
    metrics: dict | None, *, lip_validate: bool
) -> tuple[bool, list[str], dict]:
    """CI / validate — recovery churn, burst quality, morph motion."""
    reasons: list[str] = []
    ok = True
    detail: dict = {}
    if not lip_validate or metrics is None:
        return True, [], {'skipped': True}

    max_trig = int(os.environ.get('COGNI_CI_MAX_RECOVERY_TRIGGERS', '2'))
    trig = metrics.get('recoveryTriggersSession')
    detail['recovery_triggers_session'] = trig
    if isinstance(trig, (int, float)) and int(trig) > max_trig:
        ok = False
        reasons.append(f'recovery_triggers_gt_{max_trig}')

    brate = metrics.get('burstStrictPassRateLast')
    detail['burst_strict_pass_rate_snapshot'] = brate
    if isinstance(brate, (int, float)) and float(brate) < 0.6:
        ok = False
        reasons.append('burst_strict_pass_rate_below_0.6')

    morph = metrics.get('morphActivityRateEwma')
    msw = metrics.get('morphSamplesLastWindow')
    detail['morph_activity_rate_ewma'] = morph
    detail['morph_samples_last_window'] = msw
    if isinstance(morph, (int, float)) and float(morph) == 0.0:
        if isinstance(msw, (int, float)) and float(msw) > 12:
            ok = False
            reasons.append('morph_activity_rate_zero_while_sampling')

    return ok, reasons, detail


def main() -> int:
    base = os.environ.get('BASE_URL', 'http://localhost:3001').rstrip('/')
    path = os.environ.get('AVATAR_PATH', '/avatar-agent')
    url = f'{base}{path}'
    probe_text = os.environ.get('TTS_PROBE_TEXT', 'audio pipeline probe.')
    lip_sync_validate = os.environ.get('LIP_SYNC_VALIDATE', '').lower() in (
        '1',
        'true',
        'yes',
    )
    write_json = os.environ.get('COGNI_VALIDATE_WRITE_JSON', '').lower() in (
        '1',
        'true',
        'yes',
    )
    repo_root = Path(__file__).resolve().parent.parent
    report_path = Path(
        os.environ.get(
            'COGNI_VALIDATE_REPORT',
            str(repo_root / 'artifacts' / 'cogni-validate-report.json'),
        )
    )

    report: dict = {
        'url': url,
        'probe_text': probe_text,
        'lip_sync_validate': lip_sync_validate,
    }

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(ignore_https_errors=True)
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=60_000)
            plays: dict[str, int] = {'n': 0}

            def _on_play() -> None:
                plays['n'] += 1

            page.expose_function('__tts_play_hook', _on_play)
            page.evaluate(
                '''() => {
                  const Proto = HTMLMediaElement.prototype;
                  const orig = Proto.play.bind(Proto);
                  Proto.play = function () {
                    try { window.__tts_play_hook && window.__tts_play_hook(); } catch (e) {}
                    return orig.apply(this, arguments);
                  };
                }'''
            )
            ok = page.evaluate(
                '''async (text) => {
                  try {
                    if (typeof window.__cogniSpeakWithTTS !== 'function')
                      return { ok:false, err:'missing __cogniSpeakWithTTS' };
                    await window.__cogniSpeakWithTTS(text);
                    return { ok:true };
                  } catch (e) {
                    return { ok:false, err: String(e) };
                  }
                }''',
                probe_text,
            )
            lip_result: dict | None = None
            metrics_snapshot = None

            def _evaluate_metrics() -> object:
                return page.evaluate(
                    '''() => {
                      const m = window.__cogniMetrics;
                      if (!m || typeof m.snapshot !== 'function') return null;
                      try { return m.snapshot(); } catch (e) { return { error: String(e) }; }
                    }'''
                )

            if lip_sync_validate:
                lip_result = page.evaluate(
                    '''async () => {
                      try {
                        if (typeof window.__cogniLipSyncValidateBurst !== 'function')
                          return { ok: false, err: 'missing __cogniLipSyncValidateBurst' };
                        return await window.__cogniLipSyncValidateBurst({
                          durationMs: 2600,
                          intervalMs: 120,
                        });
                      } catch (e) {
                        return { ok: false, err: String(e) };
                      }
                    }'''
                )
                metrics_snapshot = _evaluate_metrics()
            browser.close()

            n = plays['n']
            print('[tts_playwright_probe] url=', url)
            print('[tts_playwright_probe] speak_invoke=', ok)
            print('[tts_playwright_probe] play_call_count=', n)
            if lip_sync_validate:
                print('[tts_playwright_probe] lip_sync_burst=', lip_result)

            gate_reasons: list[str] = []
            gates_detail: dict = {}
            metrics_ok = None

            if lip_sync_validate:
                if not isinstance(metrics_snapshot, dict):
                    metrics_ok = False
                else:
                    vc = metrics_snapshot.get('visemeCountLast')
                    lat = metrics_snapshot.get('ttsRequestLatencyMsLast')
                    metrics_ok = (
                        vc is not None
                        and isinstance(vc, (int, float))
                        and vc > 0
                        and lat is not None
                        and isinstance(lat, (int, float))
                        and lat >= 0
                    )

            gates_ok, gate_reasons, gates_detail = _compute_gates(
                lip_result if isinstance(lip_result, dict) else None,
                lip_validate=lip_sync_validate,
            )

            ci_recovery_ok, ci_recovery_reasons, ci_recovery_detail = _recovery_ci_gates(
                metrics_snapshot if isinstance(metrics_snapshot, dict) else None,
                lip_validate=lip_sync_validate,
            )
            if lip_sync_validate and not ci_recovery_ok:
                gates_ok = False
                gate_reasons.extend(ci_recovery_reasons)
                gates_detail['ci_recovery'] = ci_recovery_detail

            # When lip_validate: also enforce metrics_contract if we captured a snapshot dict
            if lip_sync_validate and metrics_ok is False:
                gates_ok = False
                gate_reasons.append(
                    'metrics_contract: need visemeCountLast>0 and ttsRequestLatencyMsLast numeric'
                )

            report.update(
                {
                    'speak_invoke': ok,
                    'play_call_count': n,
                    'lip_sync_burst': lip_result,
                    'metrics_snapshot': metrics_snapshot,
                    'metrics_contract_ok': metrics_ok,
                    'gates': {
                        'ok': gates_ok and ok.get('ok') and n >= 1,
                        'reasons': gate_reasons,
                        **gates_detail,
                    },
                    'overall': (
                        'PASS'
                        if gates_ok and ok.get('ok') and n >= 1
                        and (not lip_sync_validate or lip_result and lip_result.get('ok'))
                        else 'FAIL'
                    ),
                }
            )

            if write_json:
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(
                    json.dumps(report, indent=2, ensure_ascii=False) + '\n',
                    encoding='utf-8',
                )
                print('[tts_playwright_probe] wrote', report_path)

            assert ok.get('ok'), f"speakWithTTS failed: {ok.get('err')}"
            assert n >= 1, f'expected HTMLMediaElement.play() >= 1, got {n}'
            if lip_sync_validate:
                assert isinstance(lip_result, dict), 'lip sync result must be dict'
                assert lip_result.get('ok'), (
                    f"LIP_SYNC_VALIDATE failed: {lip_result!r}"
                )
                assert gates_ok, f'gates failed: {"; ".join(gate_reasons)}'
                assert metrics_ok is True, (
                    '__cogniMetrics snapshot missing latency/viseme contract after burst'
                )
            print('[tts_playwright_probe] PASS — play() was invoked.')
            if lip_sync_validate:
                print('[tts_playwright_probe] PASS — lip sync burst ok.')
                print('[tts_playwright_probe] PASS — production gates.')
            report['overall'] = 'PASS'
            return 0
    except AssertionError:
        report['overall'] = 'FAIL'
        if (
            os.environ.get('COGNI_VALIDATE_WRITE_JSON', '').lower()
            in ('1', 'true', 'yes')
        ):
            rp = Path(
                os.environ.get(
                    'COGNI_VALIDATE_REPORT',
                    str(repo_root / 'artifacts' / 'cogni-validate-report.json'),
                )
            )
            rp.parent.mkdir(parents=True, exist_ok=True)
            rp.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + '\n',
                encoding='utf-8',
            )
        raise
    except Exception as e:
        report['overall'] = 'FAIL'
        report['error'] = repr(e)
        if write_json:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + '\n',
                encoding='utf-8',
            )
        print('[tts_playwright_probe] FAIL:', e, file=sys.stderr)
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except AssertionError as ae:
        print('[tts_playwright_probe] FAIL:', ae, file=sys.stderr)
        sys.exit(1)
