# ICE Plan Studio

인천광역시교육청 계획 문서를 검토하고 HWPX로 내보내는 Windows 데스크톱 MVP입니다.

## 실행

설치 파일을 실행하거나 개발 환경에서 다음 명령을 사용합니다.

```powershell
cd "C:\Users\홍주형\Projects\ice-plan-studio\apps\desktop-prototype"
npm run dev
```

Electron 실행 파일은 `release/win-unpacked/ICE Plan Studio.exe`, 설치 파일은 `release/ICE Plan Studio Setup 0.1.0.exe`입니다.

## 사용 흐름

1. 기관 프로필을 선택합니다.
2. 필요하면 `CI 등록`, `슬로건 등록`으로 브랜딩 자산을 교체합니다.
3. `파일 불러오기`에서 `.md`, `.txt`, `.hwpx`를 선택합니다.
4. 문서 모델·규칙 검사 결과를 확인합니다.
5. `HWPX 내보내기`로 새 HWPX를 저장합니다.
6. `프로필 저장`은 `.iceprofile`, `프로젝트 저장`은 `.iceplan`으로 작업 상태를 보존합니다.

## 지원 범위

- Markdown·텍스트·HWPX 입력
- 공문서 제목·날짜·끝 표시·표 배치 규칙 검사
- 내용 기반 표 열 너비 및 줄바꿈 기반 행 높이 계산
- 표 `글자처럼 취급하지 않음`, 반복 머리글, 페이지 분할 속성
- 기관별 CI·슬로건 프로필
- HWPX 구조 후처리·검증 자동화

## 설치 요구사항

- Windows 10 이상
- **Python 3.11 이상** (`py` 런처 또는 PATH의 `python`) — HWPX 변환 엔진이 사용.
  서드파티 패키지는 필요 없습니다(표준 라이브러리만 사용).
- HWPX 변환 도구는 앱에 내장되어 있어(`hwpx-toolkit/`) 별도 설치가 필요 없습니다.

## 제한사항

- `.hwp` 바이너리 변환은 지원하지 않습니다. 한글에서 HWPX로 저장한 뒤 불러오세요.
- 한글 프로그램이 설치되지 않은 환경에서는 실제 화면 렌더링·페이지 넘김 검증을 수행할 수 없습니다. 수동 검증 절차는 `apps/desktop-prototype/HANCOM_MANUAL_QA.md`에 있습니다.
- 현재 표 생성기는 HWPX 네이티브 표를 생성하지만, 최종 페이지 배치는 한글에서 확인해야 합니다.

## 주요 파일

- `apps/desktop-prototype/src/domain/documentModel.js`: 문서·스타일·표 모델
- `apps/desktop-prototype/src/domain/markdownParser.js`: Markdown 구조화
- `apps/desktop-prototype/src/domain/ruleEngine.js`: 공문서 규칙 검사
- `apps/desktop-prototype/scripts/model_to_hwpx.py`: 문서 모델 → HWPX
- `apps/desktop-prototype/scripts/verify_hwpx_output.py`: HWPX 자동 회귀 검사
- `docs/`: MVP 구현계획·UI/UX·와이어프레임
