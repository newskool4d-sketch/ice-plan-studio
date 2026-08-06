#!/usr/bin/env python3
"""9단계 적응 조판 게이트 — 경계 분량 fixture 4종.

3종(넘침/적정/부족)만으로는 게이트가 공허해진다. "원래 1쪽이던 문서로 통과"하거나
"간격만 조이면 뭐든 1쪽"이라는 거짓 수렴을 잡아내지 못하기 때문이다. 그래서 각
fixture는 **보정이 실제로 일을 했는지**를 양쪽에서 단정한다.

  A. 넘침(구제 가능)  — 보정 없이 3쪽 **이면서** 보정 후 2쪽. 둘 다 단정해야
                        보정이 load-bearing임이 증명된다.
  B. 적정             — 보정이 no-op. 과보정 차단.
  C. 부족             — 완화가 걸리되 **쪽수는 그대로**. 완화가 쪽을 늘리지 않음을 단정.
  D. 구제 불능 넘침   — 사다리 바닥에서도 못 줄이는 분량. 목표 쪽수를 강제하지 않고
                        원래 쪽수를 정직하게 보고하는지 단정. 이것이 거짓 수렴을
                        막는 가장 강한 테스트다.

쪽수 단정은 한글 COM 실측으로 한다(kordoc 측정치는 보정 판단용이고, 최종 게이트는
실물이다). COM 세션은 hwp_com_session 하네스를 쓴다 — 원시 COM 금지.

사용:
  py test-data/adaptive-layout/gate.py          # kordoc 측정만(빠른 확인)
  py test-data/adaptive-layout/gate.py --com    # COM 실측 단정까지(정식 게이트)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SCRIPTS = APP / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from hwp_com_session import HwpSession  # noqa: E402

MODELS = HERE / 'models'
OUT = HERE / 'out'
_ALL_TOKENS = json.loads((SCRIPTS / 'layout-tokens.json').read_text(encoding='utf-8'))
TOKENS = _ALL_TOKENS['adaptiveSpacing']
ADAPTIVE = TOKENS
TYPOGRAPHY = _ALL_TOKENS['typography']
BASE_SPACING = TOKENS['squeezeLadder'][0]['lineSpacingPercent']

# fixture는 calibrate.py가 만드는 sweep 모델을 그대로 쓴다(같은 분량 정의를 두 번
# 적지 않기 위함). calibrate.py를 먼저 한 번 돌려야 models/가 채워진다.
CASES = [
    {
        'id': 'A-overflow-rescuable',
        'model': 'sweep-p36',
        'expect': {'applied': True, 'reason': 'squeeze', 'basePages': 3, 'finalPages': 2},
        'why': '꼬리가 조금 넘쳐 쪽이 하나 늘어난 문서 — 조이면 원래 쪽수로 돌아온다.',
    },
    {
        'id': 'B-comfortable-noop',
        'model': 'sweep-p34',
        'expect': {'applied': False, 'reason': 'none', 'basePages': 2, 'finalPages': 2},
        'why': '이미 적정하게 찬 문서 — 손대지 않아야 한다(과보정 차단).',
    },
    {
        'id': 'C-underfilled-loosen',
        'model': 'sweep-p55',
        'expect': {'applied': True, 'reason': 'loosen', 'basePages': 3, 'finalPages': 3},
        'why': '마지막 쪽을 못 채운 문서 — 완화하되 쪽수는 늘리지 않는다.',
    },
    {
        'id': 'D-overflow-unrescuable',
        'model': 'sweep-p40',
        'expect': {'applied': False, 'reason': 'squeeze-exhausted', 'basePages': 3, 'finalPages': 3},
        'why': '바닥값에서도 못 줄이는 분량 — 목표 쪽수를 강제하지 않고 정직하게 보고한다.',
    },
]


def generate(model_path: Path, output: Path, line_spacing: int | None) -> None:
    args = [sys.executable, str(SCRIPTS / 'model_to_hwpx.py'), str(model_path), str(output),
            '--template', 'boncheong']
    if line_spacing:
        args += ['--line-spacing', str(line_spacing)]
    subprocess.run(args, check=True, capture_output=True)


def fit(model_path: Path, output: Path) -> dict:
    proc = subprocess.run(
        ['node', str(SCRIPTS / 'fit-layout.cjs'), str(model_path), str(output),
         '--template', 'boncheong'],
        capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=str(APP))
    if proc.returncode != 0:
        raise RuntimeError(f'fit-layout 실패: {(proc.stderr or "").strip()[:400]}')
    return json.loads(proc.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--com', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    missing = [case['model'] for case in CASES if not (MODELS / f'{case["model"]}.model.json').exists()]
    if missing:
        print(json.dumps({'error': 'fixture 모델 없음 — calibrate.py를 먼저 실행하세요.',
                          'missing': missing}, ensure_ascii=False))
        return 2

    # 측정기 교정이 만료되면 보정 루프 자체가 꺼진다(layout-fit.cjs
    # spacingCalibrationCurrent). 이 상태에서 기대값을 단정하면 게이트가 영구
    # 적색이 되어 진짜 회귀와 구분되지 않는다. 건너뛴다는 사실을 분명히 알리고
    # 통과로 처리하되, 재교정 전에는 이 게이트가 아무것도 보증하지 않음을 밝힌다.
    calibrated_for = ADAPTIVE.get('calibratedForBodySizePt')
    body_size = TYPOGRAPHY.get('body', {}).get('sizePt')
    if calibrated_for is not None and body_size is not None and calibrated_for != body_size:
        print(json.dumps({
            'gate': 'adaptive-layout',
            'skipped': True,
            'reason': 'calibration-pending',
            'detail': (f'safeFillThreshold는 본문 {calibrated_for}pt에서 실측한 값인데 현재 본문은 '
                       f'{body_size}pt다. 재교정 전까지 적응 조판을 사용하지 않으므로 '
                       f'{len(CASES)}개 사례를 건너뛴다.'),
            'skippedCases': [case['id'] for case in CASES],
            'howToRestore': ('py test-data/adaptive-layout/calibrate.py --com 으로 재교정한 뒤 '
                             'layout-tokens.json adaptiveSpacing.calibratedForBodySizePt를 '
                             f'{body_size}(으)로 올릴 것.'),
            'guarantees': 'none — 재교정 전에는 이 게이트가 적응 조판을 보증하지 않는다.',
        }, ensure_ascii=False, indent=2))
        return 0

    log = {'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'comChecked': args.com, 'cases': {}}
    results = []
    for case in CASES:
        model_path = MODELS / f'{case["model"]}.model.json'
        base_path = OUT / f'gate-{case["id"]}-base.hwpx'
        final_path = OUT / f'gate-{case["id"]}-final.hwpx'
        # 보정 없이 생성한 기준본과, 보정 루프를 태운 산출물을 **둘 다** 남긴다.
        # 최종본만 보면 "원래 그 쪽수였는데 통과"를 구분할 수 없다.
        generate(model_path, base_path, BASE_SPACING)
        report = fit(model_path, final_path)
        item = {'why': case['why'], 'expect': case['expect'],
                'fit': {'applied': report['applied'], 'reason': report['reason'],
                        'notice': report['notice'],
                        'baseSpacing': report['base']['spacing']['lineSpacingPercent'],
                        'finalSpacing': report['final']['spacing']['lineSpacingPercent'],
                        'measuredBasePages': report['base']['pageCount'],
                        'measuredFinalPages': report['final']['pageCount'],
                        'attempts': report['attempts']}}
        log['cases'][case['id']] = item
        results.append((case, item, base_path, final_path))

    if args.com:
        with HwpSession() as session:
            for case, item, base_path, final_path in results:
                base_com = session.verify(base_path, OUT / f'gate-{case["id"]}-base.pdf',
                                          case['expect']['basePages'])
                final_com = session.verify(final_path, OUT / f'gate-{case["id"]}-final.pdf',
                                           case['expect']['finalPages'])
                item['com'] = {'basePages': base_com.get('pages'), 'finalPages': final_com.get('pages'),
                               'baseError': base_com.get('error'), 'finalError': final_com.get('error')}

    failures = []
    for case, item, _base, _final in results:
        expect = case['expect']
        fit_result = item['fit']
        if fit_result['applied'] != expect['applied']:
            failures.append(f'{case["id"]}: applied {fit_result["applied"]} != {expect["applied"]}')
        if fit_result['reason'] != expect['reason']:
            failures.append(f'{case["id"]}: reason {fit_result["reason"]} != {expect["reason"]}')
        # 고지 규칙: 조정했으면 반드시 고지가 있어야 하고, 안 했으면 없어야 한다(묵시 변경 금지).
        if bool(fit_result['notice']) != expect['applied']:
            failures.append(f'{case["id"]}: 고지 유무가 조정 여부와 불일치')
        if args.com:
            com = item['com']
            if com['basePages'] != expect['basePages']:
                failures.append(f'{case["id"]}: COM 기준본 {com["basePages"]}쪽 != {expect["basePages"]}쪽')
            if com['finalPages'] != expect['finalPages']:
                failures.append(f'{case["id"]}: COM 최종본 {com["finalPages"]}쪽 != {expect["finalPages"]}쪽')

    log['failures'] = failures
    (HERE / 'gate-log.json').write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n',
                                        encoding='utf-8')
    print(json.dumps({
        'cases': {cid: {'applied': item['fit']['applied'], 'reason': item['fit']['reason'],
                        'spacing': f'{item["fit"]["baseSpacing"]}->{item["fit"]["finalSpacing"]}',
                        'com': item.get('com')}
                  for cid, item in log['cases'].items()},
        'failures': failures,
    }, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
