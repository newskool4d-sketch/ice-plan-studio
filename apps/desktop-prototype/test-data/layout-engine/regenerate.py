#!/usr/bin/env python3
"""Regenerate Stage 2 cover/layout fixtures and optionally verify with Hancom COM."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SCRIPTS = APP / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from hwp_com_session import HwpSession, fingerprint
from layout_engine import BODY_WIDTH_HWPUNIT, TOKENS, page_sequence, resolve_profile, table_column_widths, table_row_heights
PROFILES = {
    'metropolitan-a': {'name': '인천광역시교육청', 'english': None, 'titleBox': True, 'bannerImage': True},
    'direct-b': {'name': '인천광역시교육청 학생교육원', 'english': 'Incheon Student Education Institute', 'titleBox': False, 'bannerImage': False},
    'direct-f': {'name': '인천광역시교육청 평생학습관', 'english': 'Incheon Lifelong Learning Center', 'titleBox': True, 'bannerImage': True},
    # titleBox: 사용자 실물 검토(2026-07-21)에서 직속기관 G형도 제목 틀 사용 결정
    'direct-g': {'name': '인천광역시교육청 학생교육원 교학과', 'english': 'Incheon Student Education Institute', 'titleBox': True, 'bannerImage': True},
}


def model_for(profile_id: str) -> dict:
    profile = PROFILES[profile_id]
    pages = [{'type': 'cover'}]
    if profile_id == 'metropolitan-a':
        pages += [{'type': name} for name in ('preflight', 'toc', 'summary')]
    pages += [{'type': 'body'}]
    if profile_id == 'metropolitan-a':
        pages += [
            {'type': 'task'},
            {'type': 'schedule', 'blocks': [{'type': 'table', 'header': ['월', '내용', '담당'], 'rows': [['7', '조판 검증', '교학팀'], ['8', '결과 확인', '담당자']]}]},
            {'type': 'appendix'},
        ]
    return {
        'schemaVersion': '0.2',
        'metadata': {
            'title': f'2026 {profile_id} 조판 검증 계획',
            'cover': {'title': f'2026 {profile_id} 조판 검증 계획', 'direction': '검증 방향', 'date': '2026. 7.', 'displayName': profile['name']},
            'layout': {'coverProfile': profile_id},
            'pages': pages,
        },
        'styles': {},
        'blocks': [
            {'type': 'heading', 'level': 1, 'text': 'Ⅰ. 일반 본문'},
            {'type': 'paragraph', 'text': '조판 엔진의 본문·줄바꿈·표 너비를 검증한다.'},
            {'type': 'table', 'header': ['구분', '내용'], 'rows': [['본문폭', '170mm'], ['표 머리글', '반복']]},
        ],
    }


def layout_check() -> dict:
    rows = [['구분', '내용'], ['긴 문장', '한글 조판에서 줄바꿈 높이 계산을 확인하기 위한 충분히 긴 설명 문장입니다.' * 3]]
    widths = table_column_widths(rows)
    heights = table_row_heights(rows, widths)
    assert sum(widths) == BODY_WIDTH_HWPUNIT
    assert heights[1] > heights[0], 'long table text did not receive additional row height'
    return {'ok': True, 'bodyWidthHwpUnit': BODY_WIDTH_HWPUNIT, 'widths': widths, 'rowHeights': heights}


def structure_check(path: Path, profile_id: str) -> dict:
    expected = PROFILES[profile_id]
    with zipfile.ZipFile(path) as archive:
        section = archive.read('Contents/section0.xml').decode('utf-8')
    assert 'Ⅰ. 일반 본문' in section
    assert f'width="{BODY_WIDTH_HWPUNIT}"' in section, '170mm table width missing'
    assert 'repeatHeader="1"' in section
    assert (('id="2063551796"' in section) is expected['titleBox'])
    assert (('binaryItemIDRef="image1"' in section) is expected['bannerImage']), 'banner-image profile mismatch'
    # The fixed reference anchor is reused, so an exact generated size is stricter than §9.2's ±0.5 mm (141 HWPUNIT).
    if expected['bannerImage']:
        assert '<hp:curSz width="23799" height="5769"/>' in section, 'banner anchor size drifted'
    # CI는 사용자 실물 검토(2026-07-21)로 26mm -> 36.4mm(1.4배) 확대, 날짜 위로 이동
    assert '<hp:curSz width="10318" height="10318"/>' in section, 'CI anchor size drifted'
    if expected['titleBox']:
        assert '<hp:sz width="49039" widthRelTo="ABSOLUTE" height="9050"' in section, 'title-box anchor size drifted'
    else:
        title = f'2026 {profile_id} 조판 검증 계획'
        assert f'<hp:run charPrIDRef="9"><hp:t>{title}</hp:t></hp:run>' in section, 'direct title style token missing'
    assert 'charPrIDRef="121"' in section, 'body style token missing'
    assert 'charPrIDRef="307"' in section and 'charPrIDRef="417"' in section, 'table style tokens missing'
    if expected['english']:
        assert expected['english'] in section
    if profile_id == 'direct-g':
        assert section.count(f'2026 {profile_id} 조판 검증 계획') >= 2, 'inner cover missing'
    if profile_id == 'metropolitan-a':
        for label in ('사전검토표', '목 차', '요약', '세부과제', '일정·예산·성과표', '부록·붙임'):
            assert label in section, f'{label} page type missing'
    return {
        'ok': True,
        'tableWidthHwpUnit': BODY_WIDTH_HWPUNIT,
        'anchorToleranceHwpUnit': 141,
        'bannerImage': expected['bannerImage'],
        'titleBox': expected['titleBox'],
        'englishName': expected['english'],
    }


ANCHOR_BASELINE = HERE / 'cover-anchors.json'
# §9.2 허용오차와 동일: ±0.5mm.
ANCHOR_TOLERANCE_MM = 0.5
PT_PER_MM = 72 / 25.4


def measure_anchors(hwpx_path: Path) -> list[dict]:
    """표지 배치 개체의 실제 좌표를 렌더에서 읽는다.

    표지 개체는 treatAsChar 흐름 배치라 XML에 절대 좌표가 없다. 최종 위치는
    문단 정렬·셀 여백으로 조판 엔진이 계산하므로 "XML이 같으니 위치도 같다"는
    검사로는 잡히지 않는다 — 실제로 CI가 셀 안에서 30mm 좌측으로 치우친 결함을
    구조 검사가 통과시켰다(2026-07-23 실사용 검수). 그래서 렌더 좌표를 잰다.
    """
    proc = subprocess.run(
        ['node', str(SCRIPTS / 'measure-cover-anchors.mjs'), str(hwpx_path)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=str(APP))
    if proc.returncode != 0:
        raise RuntimeError(f'앵커 측정 실패: {(proc.stderr or "").strip()[:300]}')
    images = json.loads(proc.stdout)['images']
    anchors = []
    for image in images:
        # 정사각형이면 CI, 가로로 긴 것은 슬로건 배너. 프로필마다 개체 수가 달라
        # 순서(bin0/bin1)로 구분하면 무배너형에서 어긋난다.
        square = image['heightMm'] is not None and abs(image['widthMm'] - image['heightMm']) < 1.0
        anchors.append({
            'role': 'ci' if square else 'slogan',
            'xMm': image['xMm'], 'yMm': image['yMm'],
            'widthMm': image['widthMm'], 'heightMm': image['heightMm'],
            'centerOffsetMm': image['centerOffsetMm'],
        })
    return sorted(anchors, key=lambda item: item['role'])


def measure_pdf_anchors(pdf_path: Path) -> list[dict]:
    """한글이 저장한 PDF에서 표지 이미지 배치를 읽는다.

    kordoc 렌더 좌표만으로는 부족하다. 가로 위치는 두 엔진이 0.1mm 안에서 맞지만
    **세로 위치는 약 9.5mm 어긋난다**(kordoc이 줄높이를 작게 잡는 알려진 차이의
    귀결 — memory: hwp-com-kordoc-known-limits). 그래서 세로 좌표는 한글 실물인
    PDF로 검증해야 한다.
    """
    import fitz  # PyMuPDF. COM 경로에서만 쓰므로 지연 import.
    anchors = []
    with fitz.open(pdf_path) as document:
        page = document[0]
        page_width = page.rect.width
        for image in page.get_images(full=True):
            for rect in page.get_image_rects(image[0]):
                width_mm = rect.width / PT_PER_MM
                height_mm = rect.height / PT_PER_MM
                anchors.append({
                    'role': 'ci' if abs(width_mm - height_mm) < 1.0 else 'slogan',
                    'xMm': round(rect.x0 / PT_PER_MM, 3),
                    'yMm': round(rect.y0 / PT_PER_MM, 3),
                    'widthMm': round(width_mm, 3),
                    'heightMm': round(height_mm, 3),
                    'centerOffsetMm': round(((rect.x0 + rect.x1) / 2 - page_width / 2) / PT_PER_MM, 3),
                })
    return sorted(anchors, key=lambda item: item['role'])


def compare_anchors(label: str, expected: list[dict], measured: list[dict]) -> list[str]:
    drifts = []
    if len(expected) != len(measured):
        drifts.append(f'{label}: 개체 수 {len(measured)} != 기준 {len(expected)}')
        return drifts
    for want, got in zip(expected, measured):
        if want['role'] != got['role']:
            drifts.append(f'{label}: 개체 종류 {got["role"]} != 기준 {want["role"]}')
            continue
        for key in ('xMm', 'yMm', 'widthMm', 'heightMm'):
            if want.get(key) is None or got.get(key) is None:
                continue
            delta = abs(got[key] - want[key])
            if delta > ANCHOR_TOLERANCE_MM:
                drifts.append(f'{label}: {got["role"]}.{key} {got[key]}mm '
                              f'(기준 {want[key]}mm, 오차 {delta:.3f}mm)')
    return drifts


def anchor_check(profile_id: str, hwpx_path: Path, pdf_path: Path | None,
                 baseline: dict, update: bool) -> dict:
    measured = {'render': measure_anchors(hwpx_path)}
    if pdf_path is not None and pdf_path.exists():
        measured['pdf'] = measure_pdf_anchors(pdf_path)
    if update:
        baseline[profile_id] = measured
        return {'ok': True, 'updated': True, 'anchors': measured}
    expected = baseline.get(profile_id)
    if expected is None:
        return {'ok': False, 'error': f'{profile_id} 앵커 기준값 없음 — --update-anchors로 먼저 기록하세요.',
                'anchors': measured}
    drifts = compare_anchors('render', expected.get('render', []), measured['render'])
    if 'pdf' in measured:
        if 'pdf' not in expected:
            drifts.append('pdf: 기준값 없음 — --com --update-anchors로 한글 실물 기준을 기록하세요.')
        else:
            drifts += compare_anchors('pdf', expected['pdf'], measured['pdf'])
    return {'ok': not drifts, 'toleranceMm': ANCHOR_TOLERANCE_MM,
            'pdfChecked': 'pdf' in measured, 'drifts': drifts, 'anchors': measured}


def expected_page_count(profile_id: str, model: dict) -> int:
    profile = resolve_profile(model['metadata'])
    return len(page_sequence(model['metadata'], profile))


def typography_check(hwpx_path: Path) -> dict:
    """layout-tokens.json에 선언된 폰트·자간이 실제 header.xml charPr 정의와 일치하는지 확인.

    라벨 텍스트 존재만 보던 이전 하네스는 폰트 토큰이 선언과 다르게 렌더되는
    결함(예: 맑은 고딕 선언·함초롬바탕 실제 렌더)을 놓쳤다 — 이 검사는 그 결함
    클래스를 다시 놓치지 않기 위한 것이다.
    """
    with zipfile.ZipFile(hwpx_path) as archive:
        header = archive.read('Contents/header.xml').decode('utf-8')
    faces = {}
    for family in re.finditer(r'<hh:fontface\b[^>]*lang="([^"]*)"[^>]*>(.*?)</hh:fontface>', header, re.S):
        for font in re.finditer(r'<hh:font\b[^>]*id="(\d+)"[^>]*face="([^"]*)"', family.group(2)):
            faces.setdefault(family.group(1), {})[font.group(1)] = font.group(2)
    mismatches = []
    for role, token in TOKENS['typography'].items():
        char_id = token['charPrId']
        match = re.search(r'<hh:charPr\b[^>]*id="%s"[^>]*>(.*?)</hh:charPr>' % re.escape(char_id), header, re.S)
        if not match:
            mismatches.append(f'{role}: charPr {char_id} not defined in header.xml')
            continue
        body = match.group(1)
        font_ref = re.search(r'<hh:fontRef\b[^>]*hangul="(\d+)"', body)
        actual_font = faces.get('HANGUL', {}).get(font_ref.group(1) if font_ref else None, None)
        if actual_font != token['font']:
            mismatches.append(f'{role} (charPr {char_id}): declared font={token["font"]!r}, actual={actual_font!r}')
        if 'charSpacingPercent' in token:
            spacing = re.search(r'<hh:spacing\b[^>]*hangul="(-?\d+)"', body)
            actual_spacing = int(spacing.group(1)) if spacing else 0
            if actual_spacing != token['charSpacingPercent']:
                mismatches.append(f'{role} (charPr {char_id}): declared spacing={token["charSpacingPercent"]}, actual={actual_spacing}')
    return {'ok': not mismatches, 'mismatches': mismatches}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--com', action='store_true')
    parser.add_argument('--update-anchors', action='store_true',
                        help='표지 앵커 기준 좌표를 현재 렌더 결과로 갱신한다(의도된 표지 변경 시에만).')
    args = parser.parse_args()
    baseline = json.loads(ANCHOR_BASELINE.read_text(encoding='utf-8')) if ANCHOR_BASELINE.exists() else {}
    log = {'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'fixtures': {}}
    # COM 세션은 전체 fixture에 걸쳐 하나만 연다(hwp_com_session.HwpSession 참조 —
    # 파일별 Dispatch/Quit 반복은 -2146959355 일괄 실패·세그폴트를 유발한다).
    with HwpSession() as session:
        for profile_id in PROFILES:
            model_path = HERE / f'{profile_id}.model.json'
            hwpx_path = HERE / f'{profile_id}.hwpx'
            pdf_path = HERE / f'{profile_id}.pdf'
            model = model_for(profile_id)
            model_path.write_text(json.dumps(model, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            proc = subprocess.run([sys.executable, str(SCRIPTS / 'model_to_hwpx.py'), str(model_path), str(hwpx_path), '--template', 'boncheong'], capture_output=True, text=True, encoding='utf-8', errors='replace')
            item = {'layout': layout_check(), 'generate': {'ok': proc.returncode == 0, 'exitCode': proc.returncode}}
            if proc.returncode == 0:
                try:
                    item['structure'] = structure_check(hwpx_path, profile_id)
                except AssertionError as exc:
                    item['structure'] = {'ok': False, 'error': str(exc)}
                item['typography'] = typography_check(hwpx_path)
            if args.com and item.get('structure', {}).get('ok'):
                item['com'] = session.verify(hwpx_path, pdf_path, expected_page_count(profile_id, model))
            else:
                item['com'] = {'skipped': not args.com}
            # 앵커 검사는 COM 뒤에 온다 — 한글이 저장한 PDF가 있어야 세로 좌표를
            # 실물로 대조할 수 있기 때문이다(kordoc 세로 좌표는 약 9.5mm 어긋난다).
            if item.get('structure', {}).get('ok'):
                item['anchors'] = anchor_check(
                    profile_id, hwpx_path, pdf_path if item['com'].get('ok') else None,
                    baseline, args.update_anchors)
            item['fingerprint'] = fingerprint(model_path, hwpx_path, pdf_path)
            log['fixtures'][profile_id] = item
    if args.update_anchors:
        ANCHOR_BASELINE.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (HERE / 'verification-log.json').write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    failed = [name for name, item in log['fixtures'].items() if not item.get('layout', {}).get('ok') or not item['generate']['ok'] or not item.get('structure', {}).get('ok') or not item.get('typography', {}).get('ok') or not item.get('anchors', {}).get('ok') or (args.com and not item['com'].get('ok'))]
    print(json.dumps({'fixtures': list(log['fixtures']), 'failed': failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
