#!/usr/bin/env python3
"""Regenerate Stage 2 cover/layout fixtures and optionally verify with Hancom COM."""
from __future__ import annotations

import argparse
import hashlib
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
from layout_engine import BODY_WIDTH_HWPUNIT, TOKENS, page_sequence, resolve_profile, table_column_widths, table_row_heights
PROFILES = {
    'metropolitan-a': {'name': '인천광역시교육청', 'english': None, 'titleBox': True, 'bannerImage': True},
    'direct-b': {'name': '인천광역시교육청 학생교육원', 'english': 'Incheon Student Education Institute', 'titleBox': False, 'bannerImage': False},
    'direct-f': {'name': '인천광역시교육청 평생학습관', 'english': 'Incheon Lifelong Learning Center', 'titleBox': True, 'bannerImage': True},
    'direct-g': {'name': '인천광역시교육청 학생교육원 교학과', 'english': 'Incheon Student Education Institute', 'titleBox': False, 'bannerImage': True},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    assert '<hp:curSz width="7370" height="7370"/>' in section, 'CI anchor size drifted'
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


def com_verify(hwpx: Path, pdf: Path, expected_pages: int) -> dict:
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        return {'ok': False, 'error': f'pywin32 unavailable: {exc}'}
    result: dict = {'expectedPages': expected_pages}
    pythoncom.CoInitialize()
    try:
        hwp = win32com.client.Dispatch('HWPFrame.HwpObject')
        hwp.RegisterModule('FilePathCheckDLL', 'SecurityModule')
        result['hwpVersion'] = str(hwp.Version)
        result['open'] = bool(hwp.Open(str(hwpx), 'HWPX', 'lock:false;forceopen:true'))
        if result['open']:
            result['pages'] = int(hwp.PageCount)
            result['pdfSaved'] = bool(hwp.SaveAs(str(pdf), 'PDF', '') and pdf.exists())
            hwp.Clear(1)
        # 라벨 텍스트 존재만 확인하던 이전 하네스는 페이지 유형이 병합되는
        # 결함(쪽 나눔 누락)을 놓쳤다 — 실제 쪽수를 기대 페이지 유형 수와
        # 직접 대조한다.
        result['pagesMatchExpected'] = result.get('pages') == expected_pages
        result['ok'] = bool(result.get('open') and result.get('pdfSaved') and result['pagesMatchExpected'])
        hwp.Quit()
    except Exception as exc:
        result['ok'] = False
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        pythoncom.CoUninitialize()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--com', action='store_true')
    args = parser.parse_args()
    log = {'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'fixtures': {}}
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
            item['com'] = com_verify(hwpx_path, pdf_path, expected_page_count(profile_id, model))
        else:
            item['com'] = {'skipped': not args.com}
        item['sha256'] = {p.name: sha256(p) for p in (model_path, hwpx_path, pdf_path) if p.exists()}
        log['fixtures'][profile_id] = item
    (HERE / 'verification-log.json').write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    failed = [name for name, item in log['fixtures'].items() if not item.get('layout', {}).get('ok') or not item['generate']['ok'] or not item.get('structure', {}).get('ok') or not item.get('typography', {}).get('ok') or (args.com and not item['com'].get('ok'))]
    print(json.dumps({'fixtures': list(log['fixtures']), 'failed': failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
