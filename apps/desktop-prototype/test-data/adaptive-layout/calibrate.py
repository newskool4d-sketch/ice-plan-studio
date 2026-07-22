#!/usr/bin/env python3
"""9단계 Phase 0 — 조판 측정기 교정 (go/no-go 스파이크).

2-pass 간격 보정 루프 전체가 "kordoc reflow의 쪽수가 한글 COM 실측을 추종한다"는
가정 위에 서 있다. 그런데 memory `hwp-com-kordoc-known-limits`가 kordoc 드리프트를
알려진 결함 클래스로 기록하고 있으므로, 보정 사다리를 짓기 **전에** 이 가정을
검증한다. 어긋난 측정기 위에 사다리를 쌓으면 루프가 엉뚱한 목표로 수렴한 뒤에야
발견하게 된다.

측정 대상은 두 부류다.
  1) sweep-*  : 본문 분량을 단계적으로 늘린 신규 모델 — 보정 루프가 실제로
                동작할 1~3쪽 구간을 직접 훑는다.
  2) anchor-* : 기존 layout-engine fixture — 이미 COM으로 검증된 조판이라
                측정기가 기존 결과를 재현하는지 확인하는 대조군.

사용:
  py test-data/adaptive-layout/calibrate.py          # kordoc 측정만
  py test-data/adaptive-layout/calibrate.py --com    # COM 대조까지(게이트)
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

# 한 문단이 본문 폭에서 대략 한 줄을 차지하는 길이. 분량을 문단 수로만 조절해
# 쪽수 경계를 훑기 위한 것이며, 정확한 줄 수 자체는 측정기가 알려준다.
ONE_LINE = '조판 측정기 교정을 위한 본문 문단으로 분량 경계를 확인한다'
# 여러 줄로 접히는 문단 — 줄바꿈이 섞인 조판에서도 두 측정이 일치하는지 본다.
MULTI_LINE = ONE_LINE * 3

# (이름, 문단 수, 여러 줄 문단 여부, 표 행 수, 줄간격)
# 채움률 0.86~1.18 구간을 촘촘히 덮는다 — 여기가 kordoc과 한글이 갈리는 경계이며,
# 안전 임계(safeFillThreshold)의 근거가 되는 구간이다. 표 행 fixture는 kordoc이
# 표 넘침을 쪽으로 나누지 않는 것을 드러내기 위한 것이다.
SWEEPS = [
    ('sweep-p10', 10, False, 0, None),
    ('sweep-p25', 25, False, 0, None),
    ('sweep-p34', 34, False, 0, None),
    ('sweep-p36', 36, False, 0, None),
    ('sweep-p40', 40, False, 0, None),
    ('sweep-p55', 55, False, 0, None),
    ('sweep-w08', 8, True, 0, None),
    ('sweep-w20', 20, True, 0, None),
    ('ladder-p40-150', 40, False, 0, 150),
    ('ladder-p40-140', 40, False, 0, 140),
    ('ladder-p40-135', 40, False, 0, 135),
    ('table-r24', 0, False, 24, None),
    ('table-r32', 0, False, 32, None),
    ('table-r42', 0, False, 42, None),
]

ANCHORS = ('metropolitan-a', 'direct-b', 'direct-f', 'direct-g')


def sweep_model(name: str, paragraphs: int, wrapped: bool, table_rows: int = 0) -> dict:
    text = MULTI_LINE if wrapped else ONE_LINE
    blocks = [{'type': 'heading', 'level': 1, 'text': 'Ⅰ. 측정기 교정'}]
    for index in range(paragraphs):
        blocks.append({'type': 'paragraph', 'text': f'{index + 1}. {text}'})
    if table_rows:
        blocks.append({
            'type': 'table',
            'header': ['연번', '과제명', '담당'],
            'rows': [[str(i + 1), f'세부 추진과제 {i + 1}', '교학팀'] for i in range(table_rows)],
        })
    return {
        'schemaVersion': '0.2',
        'metadata': {
            'title': f'조판 측정기 교정 {name}',
            'cover': {
                'title': f'조판 측정기 교정 {name}',
                'direction': '측정기 교정',
                'date': '2026. 7.',
                'displayName': '인천광역시교육청',
            },
            'layout': {'coverProfile': 'metropolitan-a'},
            'pages': [{'type': 'cover'}, {'type': 'body'}],
        },
        'styles': {},
        'blocks': blocks,
    }


def generate(model_path: Path, hwpx_path: Path, line_spacing: int | None = None) -> dict:
    args = [sys.executable, str(SCRIPTS / 'model_to_hwpx.py'), str(model_path), str(hwpx_path),
            '--template', 'boncheong']
    if line_spacing:
        args += ['--line-spacing', str(line_spacing)]
    proc = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return {'ok': proc.returncode == 0, 'exitCode': proc.returncode,
            'stderr': (proc.stderr or '').strip()[:500]}


def measure(hwpx_path: Path) -> dict:
    """kordoc reflow 측정 — 미리보기와 같은 경로(preview-split)를 쓴다."""
    proc = subprocess.run(
        ['node', str(SCRIPTS / 'measure-layout.mjs'), str(hwpx_path)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=str(APP),
    )
    if proc.returncode != 0:
        return {'ok': False, 'error': (proc.stderr or '').strip()[:500]}
    data = json.loads(proc.stdout)
    return {'ok': True, **data}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--com', action='store_true', help='한글 COM 실측 쪽수와 대조한다')
    args = parser.parse_args()

    MODELS.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    targets: list[tuple[str, Path]] = []
    for name, paragraphs, wrapped, table_rows, line_spacing in SWEEPS:
        model_path = MODELS / f'{name}.model.json'
        hwpx_path = OUT / f'{name}.hwpx'
        model_path.write_text(
            json.dumps(sweep_model(name, paragraphs, wrapped, table_rows),
                       ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8')
        result = generate(model_path, hwpx_path, line_spacing)
        if not result['ok']:
            print(json.dumps({'fixture': name, 'generate': result}, ensure_ascii=False))
            return 1
        targets.append((name, hwpx_path))
    for name in ANCHORS:
        anchor = APP / 'test-data' / 'layout-engine' / f'{name}.hwpx'
        if anchor.exists():
            targets.append((f'anchor-{name}', anchor))

    log = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'purpose': '9단계 Phase 0 — kordoc reflow 측정치와 한글 COM 실측 쪽수의 일치 여부 확인',
        'comChecked': args.com,
        'fixtures': {},
    }

    measured = [(name, path, measure(path)) for name, path in targets]

    # COM 세션은 전체 fixture에 걸쳐 하나만 연다(hwp_com_session 참조 —
    # 파일별 Dispatch/Quit 반복은 -2146959355 일괄 실패·세그폴트를 유발한다).
    if args.com:
        with HwpSession() as session:
            for name, path, kordoc in measured:
                item = {'kordoc': kordoc}
                if kordoc.get('ok'):
                    # expected를 kordoc 쪽수로 넘기므로 pagesMatchExpected가 곧 두 측정의 일치 여부다.
                    item['com'] = session.verify(path, OUT / f'{name}.pdf', kordoc['pageCount'])
                    item['agrees'] = bool(item['com'].get('pagesMatchExpected'))
                    item['comPages'] = item['com'].get('pages')
                log['fixtures'][name] = item
    else:
        for name, _path, kordoc in measured:
            log['fixtures'][name] = {'kordoc': kordoc, 'com': {'skipped': True}}

    (HERE / 'calibration.json').write_text(
        json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    summary = {
        name: {
            # rawPages = kordoc 원값, kordocPages = 안전 임계로 보정한 값.
            # 두 값을 나란히 남겨야 보정이 실제로 필요했는지 사후에 확인할 수 있다.
            'rawPages': item['kordoc'].get('rawPageCount'),
            'kordocPages': item['kordoc'].get('pageCount'),
            'comPages': item.get('comPages'),
            'agrees': item.get('agrees'),
            'bodyFillRatio': round(item['kordoc']['chunks'][-1]['lastPageFillRatio'], 4)
            if item['kordoc'].get('ok') and item['kordoc']['chunks'] else None,
        }
        for name, item in log['fixtures'].items()
    }
    disagreed = [name for name, item in log['fixtures'].items()
                 if args.com and not item.get('agrees')]
    print(json.dumps({'summary': summary, 'disagreed': disagreed}, ensure_ascii=False, indent=2))
    return 1 if disagreed else 0


if __name__ == '__main__':
    raise SystemExit(main())
