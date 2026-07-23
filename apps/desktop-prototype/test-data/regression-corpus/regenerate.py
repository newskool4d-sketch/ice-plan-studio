#!/usr/bin/env python3
"""Regenerate the sanitized A-G Stage 6 regression corpus."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SCRIPTS = APP / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from hwp_com_session import HwpSession, fingerprint  # noqa: E402
from layout_engine import PAGE_LABELS, page_sequence, resolve_profile  # noqa: E402

REFERENCES = {
    'a': {
        'type': '본청 기본계획', 'profile': 'metropolitan-a',
        'pages': ['cover', 'toc', 'body', 'appendix'],
        'markers': ['■', '□', '❍', '−', '·'],
    },
    'b': {
        'type': '직속기관 실무형', 'profile': 'direct-b',
        'pages': ['cover', 'body', 'appendix'],
        'markers': ['❍', '1.', '가.', '−'],
    },
    'c': {
        'type': '본청 정책브랜드형', 'profile': 'metropolitan-a',
        'pages': ['cover', 'preflight', 'toc', 'summary', 'body', 'task', 'schedule'],
        'markers': ['❍', '❖', '￭', '−'],
    },
    'd': {
        'type': '본청 기본계획', 'profile': 'metropolitan-a',
        'pages': ['cover', 'preflight', 'toc', 'summary', 'inner-cover', 'body', 'task', 'schedule', 'appendix'],
        'markers': ['◈', '□', '❍', '−', '∙'],
    },
    'e': {
        'type': '본청 기본계획', 'profile': 'metropolitan-a',
        'pages': ['cover', 'toc', 'preflight', 'summary', 'summary', 'inner-cover', 'body', 'task', 'schedule', 'appendix'],
        'markers': ['■', '□', '❍', '−', '·'],
    },
    'f': {
        'type': '직속기관 종합계획', 'profile': 'direct-f',
        'pages': ['cover', 'body', 'schedule'],
        'markers': ['❍', '−', 'ㆍ'],
    },
    'g': {
        'type': '직속기관 운영계획', 'profile': 'direct-g',
        'pages': ['cover', 'inner-cover', 'body', 'schedule'],
        'markers': ['◎', '◦', '−', '1.', '가.'],
    },
}

DISPLAY_NAMES = {
    'metropolitan-a': '인천광역시교육청',
    'direct-b': '인천광역시교육청 학생교육원',
    'direct-f': '인천광역시교육청 평생학습관',
    'direct-g': '인천광역시교육청 학생교육원 교학과',
}


def model_for(reference_id: str, spec: dict) -> dict:
    title = f'2026 레퍼런스 {reference_id.upper()} 회귀 검증 계획'
    pages = [{'type': page_type} for page_type in spec['pages']]
    for page in pages:
        if page['type'] == 'schedule':
            page['blocks'] = [{'type': 'table', 'header': ['월', '내용', '담당'], 'rows': [['7', '회귀 검증', '교학팀']]}]
    return {
        'schemaVersion': '0.2',
        'kind': 'plan-ir',
        'metadata': {
            'title': title,
            'reference': {'id': reference_id.upper(), 'documentType': spec['type'], 'sanitized': True},
            'cover': {'title': title, 'direction': '기준선 회귀', 'date': '2026. 7.', 'displayName': DISPLAY_NAMES[spec['profile']]},
            'layout': {'coverProfile': spec['profile']},
            'rules': {'itemMarkers': spec['markers']},
            'pages': pages,
        },
        'source': {'format': 'regression-fixture', 'filePath': None},
        'approval': {'status': 'unapproved'},
        'pageTypes': spec['pages'],
        'diagnostics': [],
        'blocks': [
            {'id': f'{reference_id}-heading', 'type': 'heading', 'role': 'heading', 'level': 1, 'text': 'Ⅰ. 회귀 검증'},
            {'id': f'{reference_id}-body', 'type': 'paragraph', 'role': 'body', 'text': f'레퍼런스 {reference_id.upper()}의 페이지 시퀀스와 조판 토큰을 검증한다.'},
            {'id': f'{reference_id}-list', 'type': 'listItem', 'role': 'list', 'level': 0, 'marker': spec['markers'][0], 'text': '항목기호 계열 확인'},
            {'id': f'{reference_id}-table', 'type': 'table', 'role': 'table', 'header': ['구분', '내용'], 'rows': [['문서 유형', spec['type']], ['본문폭', '170mm']]},
        ],
    }


def run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')


def structural_checks(model: dict, hwpx: Path, spec: dict) -> dict:
    profile = resolve_profile(model['metadata'])
    actual_sequence = [page['type'] for page in page_sequence(model['metadata'], profile)]
    assert actual_sequence == spec['pages'], f'page sequence drift: {actual_sequence}'
    verify = run([sys.executable, str(SCRIPTS / 'verify_hwpx_output.py'), str(hwpx), '회귀 검증'])
    assert verify.returncode == 0, verify.stdout + verify.stderr
    preview = run(['node', str(SCRIPTS / 'verify-preview-equivalence.mjs'), str(hwpx.with_suffix('.model.json')), str(hwpx)])
    assert preview.returncode == 0, preview.stdout + preview.stderr
    preview_report = json.loads(preview.stdout)
    with zipfile.ZipFile(hwpx) as archive:
        section = archive.read('Contents/section0.xml').decode('utf-8')
    for page_type in set(spec['pages']) - {'cover', 'body', 'inner-cover'}:
        assert PAGE_LABELS[page_type] in section, f'{page_type} page label missing'
    if profile.english_name:
        assert profile.english_name in section, 'English organization name missing'
    # 목록 기호가 실제 출력에 살아있는지 확인한다. 과거엔 생성기가 block.marker를
    # 버리고 '- '로 하드코딩해, 모델의 markers[0](예: ■)가 출력에서 뭉개져도
    # 하네스가 통과했다(marker 소실 버그). model_for가 markers[0]을 목록 블록에
    # 넣으므로 그 기호가 목록 텍스트와 함께 나타나야 한다.
    list_marker = spec['markers'][0]
    assert f'{list_marker} 항목기호 계열 확인' in section, f'list marker not rendered: {list_marker!r}'
    # 실제 조판 쪽수가 의도한 페이지 시퀀스와 같은지 본다(과제 G). 구조 검사는
    # "어떤 페이지 유형을 넣었는가"만 보므로, 내용이 넘쳐 쪽이 늘어나도 통과한다.
    # COM 없이도 도는 검사여야 하므로 kordoc 측정기를 쓴다 — 채움률 안전 임계로
    # 보정된 값이라 한글 실측과 맞는다(test-data/adaptive-layout/calibration.json).
    measured = run(['node', str(SCRIPTS / 'measure-layout.mjs'), str(hwpx)])
    assert measured.returncode == 0, measured.stdout + measured.stderr
    measured_report = json.loads(measured.stdout)
    assert measured_report['pageCount'] == len(actual_sequence), (
        f'조판 쪽수 {measured_report["pageCount"]} != 의도 쪽수 {len(actual_sequence)} '
        f'(kordoc 원값 {measured_report["rawPageCount"]})')
    return {
        'ok': True,
        'pageSequence': actual_sequence,
        'expectedPages': len(actual_sequence),
        'measuredPages': measured_report['pageCount'],
        'measuredRawPages': measured_report['rawPageCount'],
        'itemMarkers': spec['markers'],
        'previewEquivalence': preview_report,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--com', action='store_true')
    args = parser.parse_args()
    log = {'schemaVersion': '0.2', 'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'references': {}}
    failed = []
    # COM 세션은 전체 fixture에 걸쳐 하나만 연다(HwpSession docstring 참조).
    with HwpSession() as session:
        for reference_id, spec in REFERENCES.items():
            slug = f'reference-{reference_id}'
            model_path = HERE / f'{slug}.model.json'
            hwpx_path = HERE / f'{slug}.hwpx'
            pdf_path = HERE / f'{slug}.pdf'
            model = model_for(reference_id, spec)
            model_path.write_text(json.dumps(model, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            generated = run([sys.executable, str(SCRIPTS / 'model_to_hwpx.py'), str(model_path), str(hwpx_path), '--template', 'boncheong'])
            item = {'documentType': spec['type'], 'profile': spec['profile'], 'generate': {'ok': generated.returncode == 0, 'exitCode': generated.returncode}}
            if generated.returncode == 0:
                try:
                    item['structure'] = structural_checks(model, hwpx_path, spec)
                except (AssertionError, ValueError, json.JSONDecodeError) as exc:
                    item['structure'] = {'ok': False, 'error': str(exc)}
            else:
                item['generate']['output'] = (generated.stdout + generated.stderr)[-2000:]
            if args.com and item.get('structure', {}).get('ok'):
                item['com'] = session.verify(hwpx_path, pdf_path, item['structure']['expectedPages'])
            else:
                item['com'] = {'skipped': not args.com}
            item['fingerprint'] = fingerprint(model_path, hwpx_path, pdf_path)
            if not item['generate']['ok'] or not item.get('structure', {}).get('ok') or (args.com and not item['com'].get('ok')):
                failed.append(reference_id.upper())
            log['references'][reference_id.upper()] = item
    (HERE / 'verification-log.json').write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'gate': 'reference-regression-corpus', 'references': list(log['references']), 'failed': failed, 'com': args.com, 'passed': not failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
