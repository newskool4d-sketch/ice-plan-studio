# ICE Plan Studio MVP 체크포인트

기준일: 2026-07-19 (한글 실물 검증 + 실전 샘플 검증 + 렌더링 크래시 수정 + CI·슬로건 표지 페이지 반영)

## 완료된 자동 검증

- Markdown → 문서 모델 파싱
- 제목·날짜·끝 표시·표 배치 규칙 검사
- 스타일 토큰 생성 (`**굵게**` 인라인 서식 반영, 2026-07-19 추가)
- HWPX 네이티브 표 생성
- 내용 기반 열 너비 계산
- 줄바꿈 기반 행 높이 계산
- `treatAsChar="0"` 및 `repeatHeader="1"` 확인
- `rowCnt`·`colCnt`·머리글 셀 `header="1"` 확인 (2026-07-19 추가)
- `fix_namespaces.py`, `finalize_hwpx.py`, `validate.py` 통과
- 긴 표 fixture 6행 + 다중 페이지 fixture 30행 + 실전 샘플(96블록, 8표) 검증 통과
- Electron Vite 빌드 통과
- Windows NSIS 설치 파일 생성 확인

## 설치본 상태

`ICE Plan Studio Setup 0.1.0.exe`는 아래 모든 수정(HWPX 결함 3건, 렌더러 크래시 2건)을
반영해 **2026-07-19 20:00에 재빌드 완료**. 재빌드 직후 패키징된 `win-unpacked` 실행 파일을
CDP로 재검증(콘솔 예외 0건, `#root` 정상 렌더)했고, 아래 GUI 전 과정 실물 검증도 이
재빌드본 기준으로 수행했다.

## 한글 실물 검증 (2026-07-19, 한글 2020 COM 자동화)

검증 환경: 한글 2020 (`C:\Program Files (x86)\Hnc\Office 2020\HOffice110\Bin\Hwp.exe`),
COM 자동화(`HWPFrame.HwpObject`)로 실제 열기·페이지 수·PDF 렌더링 확인.

### 발견·수정한 결함 (HWPX 생성, 3건)

1. **한글 열기 실패 (치명)**: 생성된 `hp:tbl`에 필수 속성 `rowCnt`·`colCnt`가 없어
   한글이 모든 표 포함 문서의 열기를 거부했다. 자동 XML 검증(validate.py)은 통과했으나
   실물 열기에서만 드러난 결함. → `model_to_hwpx.py`에 `rowCnt`/`colCnt` 추가로 해결.
   (이분 탐색: 표 제거 시 열림, rowCnt/colCnt 추가 시 열림으로 원인 확정)
2. **머리글 반복 미작동**: `repeatHeader="1"`만으로는 반복되지 않고, 머리글 행 셀에
   `header="1"` 표시가 있어야 한글이 반복 대상 행을 인식한다.
   → 첫 행 `hp:tc`에 `name="" header="1" hasMargin="0" protect="0" editable="0" dirty="0"` 추가로 해결.
3. **본문 자동번호 오작동 (관찰사항 → 해결)**: 본문·목록 문단이 gonmun 템플릿의 `paraPrIDRef="4"`
   (OUTLINE 자동번호 문단)를 재사용해, 모든 문단에 `1) 2) 3)…` 번호가 강제로 붙고 수동
   하이픈과 겹쳐 `3) - 표는…` 형태로 이중 표기됐다. 또 `**굵게**` 마커가 그대로 텍스트로
   노출됐다. → `model_to_hwpx.py`에 스타일 매핑 테이블(`HEADING_STYLES`/`BODY_PARAPR`/
   `LIST_PARAPR`, 번호 없는 paraPr만 사용) 및 `**text**` → bold run 변환(`runs_xml`)을
   추가. 실전 샘플 재검증에서 자동번호 소멸·굵게 렌더링 확인.

두 번째 라운드(위 1·2건)까지 `verify_hwpx_output.py`에 회귀 검사를 추가했다.
3번(스타일 매핑)은 구조 검증 항목이 아니라 렌더링 결과라 회귀 검사에 넣지 않았고,
재발 시 실물 재검증으로만 잡을 수 있다.

### 검증 결과표

| ID | 확인 항목 | 결과 | 증거 |
|---|---|---|---|
| H-01 | 표 개체 `글자처럼 취급` 해제 | 통과(XML) + 열기 정상 | `treatAsChar="0"`, 한글 COM 열기 성공 |
| H-02 | 표 본문 너비 A4 안쪽 | 통과 | PDF 렌더링에서 표가 본문 영역 내 배치 |
| H-03 | 표 페이지 넘김 + 머리글 반복 | 통과 | `multipage-table.hwpx`(30행, 2페이지), 실전 샘플(9→8페이지, 19행 표) 모두 반복 확인 |
| H-04 | 긴 셀 줄바꿈 | 통과 | 셀 내 줄바꿈 정상, 잘림 없음. 셀 여백 밀착은 남은 관찰사항 |
| H-05 | 문단 스타일 | 통과 | 제목 대자·굵게, 본문 들여쓰기, `**굵게**` 인라인 서식 렌더링 확인 |
| H-06 | 프로필 복원(CI·슬로건) | **통과** | GUI 실물 확인 완료(아래 GUI 검증 섹션) |
| H-07 | 원본 보존 | 통과 | 검증 전후 원본 mtime 불변 |

검증 fixture: `sample-plan-semantic.hwpx`, `long-table.hwpx`, `paragraph-style.hwpx`,
`integration.hwpx`, `multipage-table.hwpx`, 실전 샘플(`학생교육원_교육프로그램_교육요원_재구조화안_2026.md`,
96블록·8표) — 전부 한글 COM 열기 성공, PDF 변환 성공.

### 실전 샘플 검증 메모

- 원본은 절대 수정하지 않고 복사본(`scratchpad/restructuring-sample.md`)으로 작업.
- 초회 변환에서 `table cell 141 has long single-paragraph text (199 chars)` 경고 발생
  — 셀 내용이 매우 긴 경우 build_hwpx.py의 관찰용 경고이며 열기·렌더링에는 지장 없음.
- 19행 후속 확인 계획 표가 페이지 경계를 넘어가며 머리글 행이 정상 반복됨(2페이지 상단).
- `§`·`△`·`①②③`·`※`·전각 대시 등 특수문자 글리프 깨짐 없이 렌더링됨.
- 마지막 `끝.` 표시는 규칙 검사(`ruleEngine.js` END-001)에서 정상 인식.

### 남은 관찰사항 (미해결, 차기 개선 후보)

1. 셀 여백이 좁아 긴 텍스트가 셀 우측 경계에 밀착. 행 높이도 3줄 기준으로 빠듯함.
2. 표가 행 중간에서 분할됨(`pageBreak="CELL"`). 행 단위 분할을 원하면 `TABLE` 검토.

## 렌더러(GUI) 결함 및 수정 (2026-07-19)

Electron 패키징 후 CDP(Chrome DevTools Protocol) 자동화로 실제 렌더러 화면을 검증하는
과정에서 발견. **기존 "Electron 실행 파일 시작 확인" 스모크 테스트는 프로세스 생존만
확인해 아래 결함들을 전혀 잡지 못했다** — 창은 뜨지만 화면은 완전히 비어 있었다.

### 발견·수정한 결함 3건

1. **자산 경로 결함 (치명)**: Vite 기본 설정이 `/assets/...` 절대경로로 번들을 출력해,
   `file://` 프로토콜로 로드하는 Electron 패키지에서 JS·CSS가 전혀 로드되지 않았다
   (`net::ERR_FILE_NOT_FOUND`). 화면은 완전히 빈 채로 "정상 실행 중"처럼 보였다.
   → `vite.config.mjs`에 `base: "./"` 추가로 해결.
2. **브랜딩 자산 절대경로**: `agencyProfiles.js`의 CI·슬로건 이미지 경로(`/branding/...`)도
   동일한 이유로 깨졌다. → 상대경로(`./branding/...`)로 교체.
3. **렌더링 크래시 (치명)**: `App.jsx`에서 `handleSaveProfile`·`handleLoadProfile`·
   `handleSaveProject`·`handleLoadProject` 4개 핸들러 함수 정의가 실수로 `steps.map()`
   콜백(JSX 리스트 렌더링) 내부에 삽입되어 있었다. 컴포넌트 최상위 스코프에는 이 이름들이
   존재하지 않아, 툴바 버튼(`프로젝트 저장` 등)이 렌더링되는 순간
   `ReferenceError: handleSaveProject is not defined`로 React 트리 전체가 크래시했다.
   화면은 완전히 빈 채로 유지되고 콘솔 외에는 어떤 오류 표시도 없었다.
   → 4개 함수를 `App()` 컴포넌트 최상위(다른 핸들러들과 같은 위치)로 이동.

1·3번은 자동 XML 검증·유닛 테스트·프로세스 생존 스모크 테스트 어느 것으로도 잡히지
않았고, **CDP로 콘솔 예외(`Runtime.exceptionThrown`)를 직접 수집해야만 드러났다.**
향후 스모크 테스트는 프로세스 생존이 아니라 "콘솔 예외 0건 + `#root` 자식 노드 존재"를
기준으로 삼아야 한다.

## GUI 실물 검증 (CDP 자동화, 2026-07-19)

패키징된 `win-unpacked` 실행 파일을 `--remote-debugging-port`로 띄우고 CDP로 검증.

| 항목 | 결과 |
|---|---|
| 초기 화면 렌더링 | 통과 — 콘솔 예외 0건, `#root` 정상 렌더 |
| 기관 프로필 셀렉트(본청/교육지원청/직속기관) | 통과 |
| 슬로건 이미지 로드(`incheon-slogan.png`) | 통과 — `naturalWidth > 0` 확인 |
| 실전 샘플 MD 파일 주입 → 파싱 | 통과 — "96개 블록 · 규칙 0건 · HWPX 내보내기 가능" 표시 |
| 프로필 전환(본청 → 교육지원청) | 통과 — 슬로건 유지, 헤더 기관명 "인천광역시교육지원청"으로 갱신 |

**H-06(프로필 복원 CI·슬로건)은 위 GUI 검증으로 통과 확정.**

### 기능 격차 발견 및 해소 (2026-07-19)

`document-stage`(중앙 A4 미리보기 본문)와 `inspector` 패널(우측 "검토 항목 01" 카드)이
**완전히 하드코딩된 정적 JSX**임을 코드 확인으로 확정했었다. 실제 `loadedModel`을 반영하는
것은 좌측 사이드의 요약 카드(`imported-model-card`, `rule-findings-card`)뿐이었다.

발견 당시 화면에 나타났던 모순:
- 사이드 카드: "96개 블록 · **규칙 0건**" (실제 `loadedModel.ruleFindings` 반영, 정확함)
- 중앙 미리보기: "1. 교육비전 / 모두가 성장하는 포용교육으로…" (실전 샘플에 없는 내용 — 정적 mock)
- 우측 패널: "검토 항목 01 · **표 너비 초과** · 오류" (항상 고정 표시 — 정적 mock)
- 하단 상태바: "페이지: N / **28**" (28 고정값)

**같은 세션에서 해소함** — 아래 "문서 미리보기·검토 패널 실데이터 연결" 섹션 참조.

부수 발견 → 해소: `ruleEngine.js`가 반환하는 finding 객체에 `title` 필드가 없는데
`App.jsx`는 `finding.title`을 참조하고 있었다. 각 규칙 코드(TITLE-001·DATE-001·END-001·
TABLE-N·TABLE-HEADER-N)에 한글 제목을 추가해 해소함.

## 문서 미리보기·검토 패널 실데이터 연결 (2026-07-19)

기존 "남은 수동 QA" 1·2번을 해소한 기능 작업.

### 변경 내용

1. **`ruleEngine.js`**: 5개 finding 코드 전부에 `title` 필드 추가
   (예: `TITLE-001` → "문서 제목 누락").
2. **`App.jsx`**: `loadedModel`이 있을 때 우선 렌더링되도록 3개 영역을 재작성
   - 중앙 A4 미리보기(`document-stage`): 고정 데모 JSX 대신 `loadedModel.blocks`를
     순회해 실제 heading·paragraph·listItem·table을 렌더링. `**굵게**` 마커는
     `<strong>`으로 변환(HWPX 출력과 동일 규칙).
   - 우측 검토 패널(`rule-inspector`): 고정 "표 너비 초과" 데모 대신
     `imported-model-card` + `rule-findings-card`(위반 있음) 또는
     "규칙 위반 없음" 카드(위반 0건)를 표시. 데모 콘텐츠와의 동시 노출(스택) 문제 해소.
   - 좌측 페이지 썸네일: 고정 5페이지 데모 대신 "실제 페이지 수는 HWPX 내보내기 시
     한글 편집기가 계산합니다"라는 정직한 안내문으로 교체 — 실제 페이지 수를 아는
     척 가짜 썸네일을 만들지 않음.
   - 하단 상태바·좌측 "검토 항목" 버튼: 데모용 카운트 대신 `loadedModel.ruleFindings.length`
     실측치 표시.
   - `loadedModel`이 없는 초기/데모 상태는 **기존 인터랙티브 데모(표 너비 조정
     적용/되돌리기, Ctrl+Z 등)를 그대로 유지** — 온보딩용 데모 가치를 보존.

### 실물 검증 (CDP, 재빌드된 `win-unpacked`)

| 검증 항목 | 결과 |
|---|---|
| 실전 샘플(96블록) 로드 후 중앙 미리보기 | 통과 — 실제 제목·표·본문 렌더링, 정적 mock 문구 완전 소멸 |
| 표·문단·목록 렌더링 개수 | 표 11개, 문단 3개, 목록 항목 59개 (실전 샘플 구조와 일치) |
| 규칙 0건 케이스 우측 패널 | 통과 — "규칙 위반 없음" 카드 표시, 가짜 "표 너비 초과" 카드 완전 소멸 |
| 규칙 위반 있는 문서(제목·날짜·끝 표시 3건 위반) 로드 | 통과 — `rule-findings-card`에 3건 정확히 표시, `title` 필드 정상 렌더링 |
| 하단 상태바 | 통과 — "블록: 96개", "규칙 검토 완료/필요 N건", "검토 항목: N" 실측치로 정확히 갱신 |
| 좌측 썸네일 영역 | 통과 — 정직한 안내문으로 교체 확인 |
| 콘솔 예외 | 0건 (변경 전/후 모두) |

의도적으로 규칙 위반 3건(제목 없음·날짜 형식 오류·끝 표시 없음)을 포함한 테스트 MD를
만들어 로드했고, `TITLE-001 · 문서 제목 누락`처럼 코드+제목+메시지가 모두 정상
표시됨을 확인했다.

**결론: "남은 수동 QA" 1·2번 모두 완료.**

## 패키징 결함 수정 (2026-07-19)

- 설치본에 `scripts/`(Python 변환기)가 포함되지 않아 설치 후 HWPX 내보내기가 실패하는
  결함 발견 → `build.files`에 `scripts/**/*` 추가, `asarUnpack` 지정,
  `main.cjs`에서 asar → `app.asar.unpacked` 경로 치환 적용.
- 참고: 설치 대상 PC에 Python(py 런처)과 `hwpx변환` 스킬 경로가 필요하다 (MVP 제약).

## 주요 산출물

- `release/ICE Plan Studio Setup 0.1.0.exe` (최신 재빌드 완료, 문서 미리보기 연결 반영)
- `scripts/model_to_hwpx.py`
- `scripts/verify_hwpx_output.py`
- `scripts/extract_hwpx_text.py`
- `src/domain/documentModel.js`
- `src/domain/ruleEngine.js`
- `HANCOM_MANUAL_QA.md`

## GUI 전 과정 실물 검증 (computer-use, 2026-07-19)

재빌드된 설치본(패키징 기준 동일본)을 실제 클릭으로 조작해 사용자 시나리오 전체를 검증.

1. 앱 실행 → "파일 불러오기" 클릭 → 네이티브 열기 다이얼로그에서 실전 샘플
   (`restructuring-sample.md`) 선택 → "96개 블록을 분석했습니다" 알림 확인
2. "HWPX 내보내기" 클릭 → 네이티브 저장 다이얼로그(파일명 자동 채움, 형식 "HWPX 문서"
   자동 지정) → 경로 지정 후 저장 → "HWPX로 내보냈습니다: …" 알림 확인
3. 생성된 파일 실물 확인: `gui-export-test.hwpx`, 23,959 bytes
4. 한글 COM으로 재열기 → **열기 성공, 8페이지 렌더링 확인**

**결론**: GUI 클릭 기반 전체 워크플로(불러오기 → 규칙 계산 → HWPX 내보내기 → 한글에서
열람)가 실물로 검증됐다. 이것으로 "남은 수동 QA" 2번(설치본 전 과정 시나리오)이 완료됐다.

## 한글 편집→재저장 라운드트립 검증 (2026-07-19)

GUI로 내보낸 `gui-export-test.hwpx`(실전 샘플, 8페이지)를 한글 COM으로 열어 실제 편집 후
재저장하는 시나리오를 검증.

1. 한글에서 열기 → 문서 끝으로 이동 → 새 문단 추가 → 마커 텍스트(`ROUNDTRIP_EDIT_MARKER_
   2026_한글편집검증`) 입력 → `SaveAs`로 같은 경로에 HWPX 재저장 → 닫기
2. **새 프로세스**로 재열기 → 페이지 수 동일(8페이지) 확인
3. `extract_hwpx_text.py`로 텍스트 추출 → 마커 텍스트 보존 확인, 원본 표 헤더 8종
   (`구분`·`내용`·`담당`·`재편 후`·`팀A`·`항목`·`확인처`·`시한`) 전부 보존 확인,
   `끝.` 표시 보존 확인
4. PDF 재변환으로 시각 검증 → **8페이지 전체에서 모든 표 구조·서식·특수문자(§·△·①②③)
   완전 보존**, 마커 텍스트가 문서 끝(8페이지, "끝." 표시 다음 줄)에 정상 추가됨

**결론: 한글에서 편집 후 재저장해도 표·서식·내용이 손실 없이 보존됨을 확인.**
"남은 수동 QA" 1번(편집 후 재저장 서식 유지)이 완료됐다.

주의: `hwp.Save()`는 COM에서 인자 없이 호출 시 `매개 변수 개수가 틀렸습니다` 오류가 난다 —
`hwp.SaveAs(path, 'HWPX', 'lock:false')`로 명시적 재저장해야 한다.

## CI·슬로건 표지 페이지 구현 (2026-07-19)

### 발견한 문제

사용자 피드백: "슬로건이나 CI는 맨처음 표지에만 활용되고, 표지가 없는 일반 계획서에는
반영되지 않는다." 코드를 확인한 결과 더 근본적인 문제였다 — **CI·슬로건은 실제 HWPX
내보내기 파일에 전혀 포함되지 않았다.** `App.jsx`의 `document-header` `<img>`는 GUI
편집기 미리보기 화면에만 존재하는 장식이었고, `handleExport`가 `window.icePlan.exportHwpx
(loadedModel)`를 호출할 때 `agencyId`/`customBranding`을 아예 넘기지 않았으며,
`model_to_hwpx.py`·`build_hwpx.py`·`hwpx_helpers.py` 어디에도 이미지 임베드 로직이
없었다. 이전에 "H-06 통과"로 기록한 것은 GUI 화면 표시만 검증한 것이었다.

사용자에게 배치 방식 3안(표지 전용/매 페이지 반복/혼합)을 제시해 확인한 결과
**"표지 페이지 방식"**으로 결정.

### 구현

1. **`hwpx변환` 스킬 재사용**: `hwpx_helpers.py`에 이미 완성된 이미지 임베드 함수
   (`make_image_para`, `add_images_to_hwpx`, `update_content_hpf`)가 있었으나
   `model_to_hwpx.py`가 import하지 않고 있었다. 표지 배너 헬퍼(`make_cover_banner` 등)는
   government 템플릿 전용 스타일 ID(charPr 144 등)를 써서 gonmun에는 dangling 참조로
   위험 — 재사용하지 않고, 검증된 gonmun 안전 스타일(charPr 0·7·10, paraPr 0·19·20)로
   표지 문단을 직접 구성.
2. **`App.jsx`**: `handleExport`에서 내보내기 직전 CI·슬로건 이미지를 base64 data URL로
   변환(`resolveImageDataUrl` — 커스텀 업로드는 이미 data URL, 기본 자산은 `fetch()`로
   읽어 변환)해 `loadedModel.metadata.cover`에 실어 IPC로 전달.
3. **`model_to_hwpx.py`**: `metadata.cover`가 있으면 표지 파트(CI 로고 30mm 정사각형
   박스, 슬로건 배너 150×40mm 박스 — Pillow로 원본 비율 유지 스케일, 제목, 기관명,
   페이지 나눔)를 본문 앞에 삽입. `build_hwpx.py` 실행 후 `add_images_to_hwpx()` +
   `update_content_hpf()`로 이미지를 zip에 등록. section0.xml 루트에 누락됐던
   `xmlns:hc` 네임스페이스 선언 추가(이미지 요소가 요구, 없으면 build 단계에서 실패).
4. **`verify_hwpx_output.py`**: `hp:pic` 존재 시 `BinData/` 항목과 `content.hpf`
   manifest 등록이 일치하는지 확인하는 회귀 검사 추가.

### 실물 검증

| 항목 | 결과 |
|---|---|
| 표지 없는 기존 fixture 5종 회귀 | 통과 — 전부 한글 열기·PDF 렌더링 그대로 유지 |
| 표지 포함 HWPX 생성(스크립트 직접 호출) | 통과 — 한글 COM 9페이지(표지 1 + 본문 8) 열기 성공 |
| PDF 렌더링 | 통과 — 표지에 CI 로고·슬로건 배너·제목·기관명 정상 배치, 2페이지부터 본문 정상 이어짐 |
| **GUI 실클릭 end-to-end**(computer-use) | 통과 — 파일 불러오기 → HWPX 내보내기 클릭 → 네이티브 저장 다이얼로그 → 실제 519,953 bytes 파일 생성(표지 없을 때 23,959 bytes 대비 이미지 임베드로 크기 급증) → 한글 재열기 9페이지 확인 |

컴퓨터유즈 검증 중 발견: Electron `contextIsolation` 환경에서 `window.icePlan.exportHwpx`를
CDP로 몽키패치해 payload를 가로채려는 시도는 조용히 무시되고 원본 함수가 그대로
호출된다(진짜 네이티브 저장 다이얼로그가 열림) — 이 자체가 `handleExport` 로직이
정상 실행되어 실제 IPC까지 도달했다는 증거였다. 이후 실제 클릭으로 저장을 완료해
검증했다.

## 남은 수동 QA

없음 — 이번 세션에서 파악·요청된 항목은 전부 해소됨. `ICE Plan Studio Setup 0.1.0.exe`는
문서 미리보기·검토 패널 연결, CI·슬로건 표지 페이지 임베드까지 전부 반영해 재빌드
완료했고, CDP로 콘솔 예외 0건을 재확인했다.

향후 개선 후보(이번 세션 범위 밖, 요청 시 진행): 표지 없이 매 페이지 CI 반복 옵션,
슬로건 없이 CI만 있는 경우 레이아웃, 커스텀 CI 이미지가 극단적 종횡비일 때의 표지 균형.
