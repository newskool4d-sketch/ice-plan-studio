#!/usr/bin/env python3
"""boncheong 게이트 증거 재생성 스크립트.

REBASELINE_PLAN §8 재작업 5번: 0단계 게이트 증거를 세션 임시 폴더가 아니라
저장소에 남겨 누구나 재현할 수 있게 한다.

사용:
    py regenerate.py            # HWPX 생성 + 구조 검증 + 해시 기록
    py regenerate.py --com      # 위 + 한글 COM 실물 열기·PDF 변환 (한컴 설치 필요)

산출물은 모두 이 폴더에 생성된다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent.parent / 'scripts'
MODEL = HERE / 'boncheong-minimal.model.json'
HWPX = HERE / 'boncheong-minimal.hwpx'
PDF = HERE / 'boncheong-minimal.pdf'
LOG = HERE / 'verification-log.json'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args: list[str]) -> tuple[int, str]:
    proc = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return proc.returncode, (proc.stdout or '') + (proc.stderr or '')


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='boncheong 게이트 증거 재생성')
    parser.add_argument('--com', action='store_true', help='한글 COM 실물 검증까지 수행')
    args = parser.parse_args()

    log: dict = {'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}

    print('[1/3] HWPX 생성 (--template boncheong)')
    code, out = run([sys.executable, str(SCRIPTS / 'model_to_hwpx.py'),
                     str(MODEL), str(HWPX), '--template', 'boncheong'])
    log['generate'] = {'exitCode': code, 'ok': code == 0}
    if code != 0:
        log['generate']['output'] = out[-2000:]
        LOG.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding='utf-8')
        print(out)
        return 1

    print('[2/3] 구조 검증')
    code, out = run([sys.executable, str(SCRIPTS / 'verify_hwpx_output.py'), str(HWPX)])
    log['structuralVerify'] = {'exitCode': code, 'ok': code == 0, 'summary': out.strip().splitlines()[-1] if out.strip() else ''}

    if args.com:
        print('[3/3] 한글 COM 실물 열기 + PDF 변환')
        log['com'] = com_verify()
    else:
        print('[3/3] COM 검증 건너뜀 (--com으로 활성화)')
        log['com'] = {'skipped': True}

    log['sha256'] = {p.name: sha256(p) for p in [MODEL, HWPX] if p.exists()}
    if PDF.exists():
        log['sha256'][PDF.name] = sha256(PDF)
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n기록: {LOG.name}')
    return 0 if log['structuralVerify']['ok'] else 1


def com_verify() -> dict:
    """한글 COM으로 열기·페이지 수·PDF 변환을 확인한다."""
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        return {'ok': False, 'error': f'pywin32 미설치: {exc}'}

    result: dict = {}
    pythoncom.CoInitialize()
    try:
        hwp = win32com.client.Dispatch('HWPFrame.HwpObject')
        hwp.RegisterModule('FilePathCheckDLL', 'SecurityModule')
        result['hwpVersion'] = str(hwp.Version)
        opened = hwp.Open(str(HWPX), 'HWPX', 'lock:false;forceopen:true')
        result['open'] = bool(opened)
        if opened:
            result['pages'] = hwp.PageCount
            saved = hwp.SaveAs(str(PDF), 'PDF', '')
            result['pdfSaved'] = bool(saved and PDF.exists())
            hwp.Clear(1)
        try:
            hwp.Quit()
        except Exception:
            pass
        result['ok'] = bool(result.get('open') and result.get('pdfSaved'))
    except Exception as exc:  # COM 서버 기동 실패 등
        result['ok'] = False
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        pythoncom.CoUninitialize()
    return result


if __name__ == '__main__':
    raise SystemExit(main())
