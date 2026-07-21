#!/usr/bin/env python3
"""Regenerate the sanitized A-G Stage 6 regression corpus."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SCRIPTS = APP / 'scripts'
sys.path.insert(0, str(SCRIPTS))
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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(model_path: Path, hwpx_path: Path, pdf_path: Path) -> dict:
    """회귀 신호로 쓸 수 있는 재현 가능한 지문만 기록한다.

    .hwpx 바이트 해시는 회귀 지표로 쓸 수 없다 — ZIP 항목 타임스탬프 때문에
    같은 모델을 두 번 생성하면 바이트 해시가 매번 달라진다(실측 확인).
    반면 Contents/section0.xml은 바이트 단위로 동일하므로 이것을 조판 결과의
    지문으로 쓴다. PDF도 한글이 생성 시각을 심어 재현되지 않으므로 해시 대신
    존재·크기만 남긴다.
    """
    result: dict = {}
    if model_path.exists():
        result['model.json'] = {'sha256': sha256(model_path)}
    if hwpx_path.exists():
        with zipfile.ZipFile(hwpx_path) as archive:
            section = archive.read('Contents/section0.xml')
        result['hwpx'] = {
            'section0Sha256': hashlib.sha256(section).hexdigest(),
            'note': 'ZIP 타임스탬프 때문에 .hwpx 바이트 해시는 재현되지 않는다. 조판 결과 비교는 section0.xml 해시로 한다.',
        }
    if pdf_path.exists():
        result['pdf'] = {'bytes': pdf_path.stat().st_size}
    return result


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
    return {
        'ok': True,
        'pageSequence': actual_sequence,
        'expectedPages': len(actual_sequence),
        'itemMarkers': spec['markers'],
        'previewEquivalence': preview_report,
    }


class HwpSession:
    """한글 COM 인스턴스 1개를 열어 전체 fixture를 처리한다.

    파일마다 Dispatch/Quit를 반복하면 한글 COM 서버가 불안정해져
    -2146959355(CO_E_SERVER_EXEC_FAILURE)로 일괄 실패하거나 프로세스가
    세그폴트한다(실측: 파일별 사이클은 3~7회 사이에서 크래시, 단일
    인스턴스는 7종 연속 통과). 그래서 인스턴스를 재사용한다.
    """

    def __init__(self) -> None:
        self.hwp = None
        self.error = None
        self.version = None
        self._pythoncom = None

    def __enter__(self) -> 'HwpSession':
        try:
            import pythoncom
            import win32com.client
        except ImportError as exc:
            self.error = f'pywin32 unavailable: {exc}'
            return self
        self._pythoncom = pythoncom
        self._client = win32com.client
        self._start()
        return self

    def _start(self) -> None:
        self._pythoncom.CoInitialize()
        try:
            self.hwp = self._client.Dispatch('HWPFrame.HwpObject')
            self.hwp.RegisterModule('FilePathCheckDLL', 'SecurityModule')
            self.version = str(self.hwp.Version)
            self.error = None
        except Exception as exc:
            self.error = f'{type(exc).__name__}: {exc}'
            self.hwp = None

    def _stop(self) -> None:
        if self.hwp is not None:
            try:
                self.hwp.Quit()
            except Exception:
                pass
            self.hwp = None
        if self._pythoncom is not None:
            try:
                self._pythoncom.CoUninitialize()
            except Exception:
                pass

    def restart(self) -> None:
        self._stop()
        time.sleep(2)  # 한글 프로세스가 완전히 내려갈 시간을 준다
        self._start()

    def __exit__(self, *_exc) -> None:
        self._stop()

    def _attempt(self, hwpx: Path, pdf: Path, expected_pages: int) -> dict:
        result: dict = {'expectedPages': expected_pages}
        if self.hwp is None:
            return {**result, 'ok': False, 'error': self.error or 'COM 세션을 열지 못했습니다.'}
        result['hwpVersion'] = self.version
        try:
            result['open'] = bool(self.hwp.Open(str(hwpx), 'HWPX', 'lock:false;forceopen:true'))
            if result['open']:
                result['pages'] = int(self.hwp.PageCount)
                result['pdfSaved'] = bool(self.hwp.SaveAs(str(pdf), 'PDF', '') and pdf.exists())
                self.hwp.Clear(1)
            result['pagesMatchExpected'] = result.get('pages') == expected_pages
            result['ok'] = bool(result.get('open') and result.get('pdfSaved') and result['pagesMatchExpected'])
        except Exception as exc:
            result['ok'] = False
            result['error'] = f'{type(exc).__name__}: {exc}'
        return result

    def verify(self, hwpx: Path, pdf: Path, expected_pages: int, attempts: int = 3) -> dict:
        """실패 시 COM 세션을 재시작해 재시도한다.

        단일 인스턴스로 바꿔도 처리 도중 세션이 오염되는 사례를 실측했다
        (E에서 SaveAs 실패 → 이후 F·G는 Open조차 실패). 한글 COM의 이런
        열화는 세션을 새로 띄우면 회복되므로, 실패한 항목만 재시작 후
        다시 시도한다. 재시도로 통과한 경우 로그에 남겨 은폐하지 않는다.
        """
        result = self._attempt(hwpx, pdf, expected_pages)
        for attempt in range(2, attempts + 1):
            if result.get('ok'):
                break
            self.restart()
            result = self._attempt(hwpx, pdf, expected_pages)
            result['recoveredOnAttempt'] = attempt
        return result


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
