# 본문 레이아웃 v2 단계 6 실물 검증 기록

검증일: 2026-07-29 (재검증 라운드 — 전 라운드 BLOCKED/FAIL 항목 해소)  
대상: `worldschool-stage6.model.json` → `stage6-worldschool.hwpx` → `stage6-worldschool.pdf`

## 판정 요약

| 게이트 | 판정 | 근거 |
|---|---|---|
| HWPX 생성 | PASS | `model_to_hwpx.py --template boncheong` 종료 코드 0, finalize·내장 validate 통과 |
| HWPX 구조 (`verify_hwpx_output.py`) | PASS | 표 게이트 스코프 수정 후 통과 (아래 조치 1) — `zip_entries=13 table_rows=4 content_tables=0` |
| 한글 COM 열기·페이지 수·PDF | PASS | `verify-stage6-com.py` `open:true, pages:5(기대 5), pdfSaved:true` — 경로 절대화 수정 후 상대 경로 호출도 통과 (조치 2) |
| 패키징 앱 CDP 렌더 (`verify:app-render`) | PASS | `passed:true` — ipcPreview·ipcAdaptive 쪽수 일치, 간격 보정 알림 확인 |
| 6단계 워크플로 실주행 (`verify:workflow-walk`) | PASS | `passed:true` 2회 연속 — 6패널 전부 도달, 결정 게이트·비교 모드·스플리터·테마 포함 (조치 3~5) |
| PDF 실물 대조 (5쪽) | PASS | 아래 실물 대조표 |

## PDF 실물 대조 (110dpi 렌더 이미지 5쪽 전수 확인)

| 항목 | 결과 |
|---|---|
| 1쪽 표지 | 슬로건 이미지·CI 로고·색띠 제목 프레임·"2026. 3."·기관명 정상 |
| 2쪽 목차 | "목 차" + 점선 리더·쪽번호 3항목 정상 |
| 3쪽 요약 | "요약" + 비전·목표 문단 정상 |
| 4쪽 본문 시작 제목 틀 | 방향 문구 대형 볼드 → 계획명 → 기관명 위계 정상, `Ⅰ. 추진 근거` 본문 시작 |
| 5쪽 본문 후속 | `Ⅱ. 추진 배경` + 본문, 쪽번호 정상 |
| 폰트 크기 | 제목/부제/본문 위계 뚜렷, 이상 없음 |
| 검은색 마킹 | 전 쪽 없음 (글리프 깨짐·검은 박스 미발생) |

## 이번 라운드에서 찾은 결함과 조치

1. **`verify_hwpx_output.py` 거짓 양성** — 문서 전체에 `header="1"` 존재를 요구해, 자료 표가 없는 stage6 문서(표지 장식 표 2개뿐, 셀은 정당하게 `header="0"`)가 실패했다. 표 검사를 "내용 표"(표지 장식 표 id `2063551796`·`2063551804` 제외) 단위로 좁혔다. 교차 검증: 표 fixture 4종 통과 유지 + 내용 표의 `header="1"`/`repeatHeader`/`rowCnt` 훼손 3종 모두 검출 유지 + 표 없는 문서 통과.
2. **COM `Open` 상대 경로 실패** — COM은 한글 프로세스 자신의 cwd 기준으로 경로를 풀어 `..\..\tmp\...`가 조용히 `open:false`가 됐다(전 라운드 행업과 별개 증상). `verify-stage6-com.py`에서 인자 경로를 `resolve()`로 절대화. 전 라운드의 "Open 90초 행업"은 이번 깨끗한 세션에서 재현되지 않았다.
3. **분석 확정 게이트로 워크플로 정지 + 알림 문구 결함** — `verify:workflow-walk`가 2단계에서 멈춘 원인은 새 결정 게이트(`planDecisionGate`: 문서 성격·목차·요약)를 하네스가 통과시키지 않아서다. 하네스에 결정 단계를 추가했다. 함께 발견한 실결함: `WorkflowApp.jsx` 알림 2곳이 `\${...}` 이스케이프로 템플릿 문자열이 그대로 사용자에게 노출됐고, 차단 사유가 내부 코드명(`toc-decision` 등)으로 표기됐다 → 리터럴 수정 + 한글 라벨 매핑.
4. **앞부분(목차·요약) 결정이 산출물에서 조용히 탈락** — 결정·문서성격 변경 시 `pageDrafts`만 갱신하고 `metadata.pages`를 동기화하지 않아 구조 패널은 4쪽, 미리보기·내보내기는 2쪽으로 어긋났다(사용자가 결정한 목차·요약 쪽이 내보내기에서 소실). `withPagePlan()` 헬퍼로 로드·결정·문서성격·프로젝트 복원 경로 전부 동기화. 부수 결함 2건도 수정: 쪽 확정 시 페이지 인덱스가 미리보기 범위를 초과(`페이지 4/2`)해 비교 모드가 영구 잠기던 문제(클램프 추가), 썸네일 검토 배지가 `body` 유형만 인식해 `body-opening` 문서에서 사라지던 문제(`BODY_PAGE_TYPES` 공용화).
5. **하네스 고정 대기 경합** — 렌더러 바쁜 구간에서 `data-theme`/스플리터 상태 커밋과 계산 스타일 반영이 최대 ~2초 벌어지는 것을 실측(50ms 간격 추적: 속성 50ms, 색 1900ms). 테마·스플리터·비교 모드 검사를 고정 300ms 대기에서 조건 대기(폴링)로 교체.

## 재현 명령

```powershell
py -3 scripts/model_to_hwpx.py `
  test-data/body-layout-v2/worldschool-stage6.model.json `
  ..\..\tmp\stage6-worldschool.hwpx --template boncheong

py -3 scripts/verify_hwpx_output.py ..\..\tmp\stage6-worldschool.hwpx

py -3 scripts/verify-stage6-com.py `
  ..\..\tmp\stage6-worldschool.hwpx ..\..\tmp\stage6-worldschool.pdf --expected-pages 5

npm run build
npx electron-builder --win --dir
npm run verify:app-render
npm run verify:workflow-walk
```

## 회귀 확인

- `verify:plan-ir`·`verify:preview-equivalence`·`verify:rules`·`verify:body-layout-v2-decisions`·`verify:body-layout-v2-rendering` 전부 PASS.
- `verify:body-layout-v2-baseline`은 "구현 전 공백 기록" 모드(`passed:false`가 기능 실패를 뜻하지 않음) — 변화 없음.
- `verify:workflow-walk` 2회 연속 PASS로 플레이크 아님을 확인.
