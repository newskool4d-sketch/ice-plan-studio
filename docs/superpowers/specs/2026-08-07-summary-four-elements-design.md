# 요약 페이지 4요소 파생 설계 (2026-08-07)

## 배경
실물 양식 판정(memory `front-matter-format-rulings`)에 따라 요약 페이지의 정격은
빈 입력 틀이 아니라 **본문의 근거·목적·세부운영(과제)·기대효과 4요소 요약**이다.
현행 `front_matter_frame_block()`의 3행 빈 표(추진 배경/주요 내용/기대 효과)와
미리보기의 빈 페이지를 4요소 파생 표로 교체한다.

## 확정 전제 (사용자 미응답으로 합리적 가정 명시 후 착수)
- **문안 생성 수준 = 혼합(권장안)**: 과제 요소는 과제 제목 목록(그 자체가 요약),
  근거·목적·기대효과는 해당 장 본문 원문 발췌 + 글자 수 상한 절단. LLM식
  재작성 없음 — 파이프라인 전 구간 결정적 유지(미리보기·HWPX·게이트 정합).
- 색 태그 상자류는 작성자 자율(판정 2항)이므로 재현하지 않는다. 기존 표 조판
  계약(표 11pt, 본문 13pt/170%)은 유지한다.
- 수준 변경(전문 발췌·축약 등)은 추출 함수 한 곳만 고치면 되도록 격리한다.

## 추출 규칙 (Python·JS 동일 — 동등성 게이트로 강제)
- 본문 소스: `page_sequence`의 body·body-opening·body-continuation 페이지 블록
  (`blocks` 키 없으면 model.blocks 폴백) — `toc_entries`와 같은 수집 규칙.
- 장 경계: 구조 제목 분류(`STRUCTURED_HEADING_PATTERNS` /
  `classifyStructuredHeading`) 결과 kind == `roman-chapter`인 블록.
- 요소 매핑 (장 제목 키워드, 요소별 첫 일치 장 1개):
  - 추진 근거 ← /근거|배경/
  - 추진 목적 ← /목적|목표/
  - 기대 효과 ← /기대\s*효과/
  - 추진 과제 ← kind == `task-section` 제목 전체 목록 (`라벨 제목` 형식, 중복 제거)
- 발췌 내용: 해당 장 제목 다음부터 다음 roman-chapter 전까지의
  paragraph·listItem 블록 텍스트(marker 제외, `**` 강조 마커 제거, 구분선 제외).
- 결합: ' / ' 구분자로 이어붙이되 총 120자 상한. 첫 항목 단독 초과 시
  119자 + '…' 절단. 요소 미발견 시 빈 칸(수기 입력 여지 유지).

## 산출 구조
`[구분/내용]` 2열 5행(머리글 포함) 표 — 행: 추진 근거 / 추진 목적 / 추진 과제 /
기대 효과. HWPX(`front_matter_frame_block`)와 미리보기(projection 자동 주입,
빈 요약 페이지일 때) 양쪽 동일.

## 변경 파일
1. `scripts/model_to_hwpx.py` — 본문 블록 수집 헬퍼 분리(toc_entries 재사용),
   `summary_rows(model)` 추가, summary 분기 교체.
2. `src/domain/previewProjection.js` — 미러 구현(`automaticSummaryBlock`),
   빈 요약 페이지에 주입. `src/components/PlanPreview.jsx` — 요약용
   FrontMatterFrame 분기 고아화 → 제거.
3. `scripts/verify-body-layout-v2-hwpx.py` — 픽스처에 근거·목적·기대효과 장 본문
   추가, 요약 표 4요소 라벨·발췌 내용·과제 목록 단정 추가.
4. `test-data/layout-engine/metropolitan-a.hwpx` — 생성기 재실행으로 재생성
   (verify-preview-equivalence 기준물). COM 필요한 regression-corpus 재생성은
   COM Open 멈춤 이력으로 보류— 스테일 명시.

## 검증
`verify:body-layout-v2-hwpx`(신규 단정 포함), `verify:preview-equivalence`,
`verify:body-layout-v2-baseline/decisions/rendering`, `verify:plan-ir*`,
`verify:rules` 전부 통과 + kordoc 렌더로 요약 쪽 실물 확인.
