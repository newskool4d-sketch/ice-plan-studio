"""한글 COM 검증 세션과 재현 가능한 fixture 지문.

test-data/regression-corpus·layout-engine 두 재생성 하네스가 공유한다.
(같은 결함을 두 곳에서 각각 고치다 한쪽이 누락된 이력이 있어 공용화.)
"""
from __future__ import annotations

import hashlib
import time
import zipfile
from pathlib import Path


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
