# 항목 위계·간격 척도(v0.12.12 포함) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한글 실물 PDF에서 확인된 간격 결함 — 빈 쪽(다음 문단과 함께 연쇄 19문단), 간격 위계 역전, 줄간격 혼재, 들여쓰기 무위계, 항목 병합 — 을 고친다.

**Architecture:** 블록 목록에 '조판 주석'(역할·표시 단계·기호·내어쓰기·위 간격·다음 문단과 함께·줄간격)을 붙이는 순수 함수 `layoutBlocks`를 JS(`src/domain/itemLayout.js`)·Python(`scripts/item_layout.py`) 쌍둥이로 만든다. HWPX 변환기는 주석으로 문단 속성을 고르고(항목은 (단계·내어쓰기·위 간격·다음 문단과 함께) 조합별 동적 paraPr 248~ — 고정 238~247 바로 뒤에서 빈 번호 없이), 빠른 미리보기는 같은 주석을 인라인 스타일로 그린다. 파서는 공문서 항목기호(1)·가)·(1)·①…)와 전각 공백 들여쓰기를 인식하고, 항목보다 깊게 들여쓴 이어지는 줄을 그 항목에 합친다.

**Tech Stack:** Node 22 ESM 게이트, Python 3(`model_to_hwpx.py`), React 19, PyMuPDF(한글 PDF 실측).

**Spec:** `docs/IMPROVEMENT_PLAN_V4_공문서무결성_디자인.md` §2-2(G-1·G-2) + 2026-09-27 한글 PDF 실측 결과·사용자 승인(권장 간격 척도)

## Global Constraints

- 간격 척도(승인값, HWPUNIT 100=1pt): 장 제목틀 앞 1200 / 짧은 번호 제목 `1.` 앞 800 / 짧은 소제목 `가.` 앞 400 / 1단계 항목·최상위 □○ 앞 300 / 하위 항목 0
- 줄간격: 항목·본문 170%(적응 조판 `--line-spacing` 지정 시 그 값), 짧은 제목 160%
- 서술형 판별: 번호 뒤 본문이 `.` 또는 `함·음·됨·임`으로 끝나면 항목. **길이는 기준 아님**(2026-08-14 판정: 번호 제목은 길이와 무관하게 같은 조판 — `verify-numbered-heading-layout.py` ARABIC_LONG/SHORT 동일 paraPr 단정 유지)
- 들여쓰기(2026-09-27 사용자 샘플 PDF 실측·승인): 기호 시작 위치 = `levelIndentHalfSpaces[단계]` × 648(반각 공백 1칸), 단계 0~7 → 0·1·3·4·6·7·9·10칸 — `1.`=0, `가.`=1, `1)`=3, `가)`=4, `①`=6, `㉮`=7칸. 내어쓰기 = 기호+공백 실측 폭(한글 PDF, 함초롬바탕 13pt: 한글 1260·숫자 708·`.`/`)` 420·`(` 408·공백 648·`-` 660)
- paraPr 번호 = 목록 위치(0부터 빈칸 없이): 한글은 `paraPrIDRef`를 id가 아니라 목록 위치로 찾는다. 참조 없는 239·242도 자리 유지용 정의로 남긴다(2026-09-28 한글 PDF 실측 — 빈칸 시 이후 참조가 전부 밀림)
- 다음 문단과 함께 연속 최대 3문단(넘치면 해제), 표 앵커(paraPr 1)는 연쇄를 끊음
- 쌍둥이: `itemLayout.js` ↔ `item_layout.py` 결과가 같아야 함(게이트로 단정)
- 새 의존성 금지, 합성 fixture만 커밋, 커밋은 사용자 확인 후
- gonmun 템플릿 경로는 변경하지 않음(boncheong만)

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `scripts/layout-tokens.json` | `itemLayout` 토큰(척도·글자폭·단계·연쇄 상한), 옛 `topicGroupLeader`·`numberedHeading` 제거 | 수정 |
| `scripts/item_layout.py` | 서술형 판별·내어쓰기·표시 단계·연쇄 제한(Python) | 신규 |
| `src/domain/itemLayout.js` | 같은 규칙(JS) | 신규 |
| `scripts/model_to_hwpx.py` | 주석 기반 paraPr 선택, 동적 항목 paraPr 등록·정의(248~), 243·240·245 값 갱신, 239·242 자리 유지, 번호 연속 가드 | 수정 |
| `src/components/PlanPreview.jsx` | 주석 기반 인라인 스타일 | 수정 |
| `electron/plan-ir.cjs`, `src/domain/markdownParser.js` | 공문서 항목기호·전각 들여쓰기 인식(G-1), 깊게 들여쓴 이어지는 줄 병합 | 수정 |
| `scripts/verify-item-layout.mjs` | 규칙·쌍둥이·HWPX 실출력 게이트 | 신규 |
| `test-data/item-layout/item-hierarchy.md` | 합성 fixture | 신규 |
| `scripts/verify-body-layout-v2-hwpx.py` | 240 기대값 갱신 | 수정 |
| `scripts/inspect_pdf_spacing.py` | 한글 PDF 실측 도구(정의값 대조) | 신규 |
| `package.json` | `verify:item-layout`, dist 게이트 편입 | 수정 |

## Interfaces (쌍둥이 공통)

- `isSentenceTitle(title) → bool` / `is_sentence_title(title)`
- `markerHang(marker) → int(HWPUNIT)` / `marker_hang(marker)`
- `layoutBlocks(blocks) → Annotation[]` / `layout_blocks(blocks)` — 블록과 같은 길이. Annotation:
  `{ role: 'frame'|'heading1'|'heading2'|'heading'|'item'|'body'|'quote'|'table', level, marker, text, hang, prev, keep, lineSpacing }`
  - frame(로마숫자 장·과제 틀): base←0, keep=True, prev=chapter(로마숫자만)
  - heading1(짧은 `1.`): level 0, base←1, keep=True, prev 800, 160%
  - heading2(짧은 `가.`): level 1, base←2, keep=True, prev 400, 160%
  - item(목록 항목 + 서술형 제목): 서술형 제목은 기호 고유 단계(1.→0, 가.→1, 1)→2, 가)→3, ①·(1)→4, ㉮·(가)→5 — 샘플 순서 1. 가. 1) 가) ① ㉮), 목록 항목은 base + (파서 단계 − 묶음 첫 항목 파서 단계); prev 0단계 300·그 외 0; keep=False; 170%. 서술형 제목 뒤 base←level+1
  - 연쇄 제한: keep=True가 4번째로 연속되면 keep=False

---

### Task 1: 쌍둥이 규칙 모듈 + 토큰 (JS·Python)
- [x] fixture·게이트(규칙 구역) 작성 → 실패 확인(모듈 없음)
- [x] `layout-tokens.json` `itemLayout` 추가, `item_layout.py`·`itemLayout.js` 구현 → 규칙 구역 통과
- 단정: `isSentenceTitle`(ARABIC_LONG 제목=False, `…예방함.`=True, `…따름.`=True, `…(잠정 진단)`=False), `markerHang`(1.=1776, 가.=2328, □=1908, 1)=1776, (1)=2184, ①=1908), 표본 블록열의 역할·단계·prev·keep, 연쇄 5개 → 4·5번째 keep 해제

### Task 2: 파서 항목기호·전각 들여쓰기 (G-1)
- [x] 게이트에 파서 구역(판단 절차 15줄 → 목록 15개, 파서 단계 [1,2,2,2,1,2,3,3,2,3,3,2,1,2,2], ordered) → 실패 확인
- [x] `plan-ir.cjs`·`markdownParser.js` 기호 집합·들여쓰기 폭(전각=2, 탭=4, 반각=1) 수정 → 통과, `verify:plan-ir` 무회귀
- [x] (2026-09-28 추가) 파서 구역 P-2: 항목보다 깊게 들여쓴 이어지는 줄만 합침 — 들여쓰지 않은 줄(□ 제목 아래 본문)·같은 깊이 줄·코드 울타리·구분선·인용은 합치지 않음 → 실패 확인 후 통과. 폭염 원문 영향: 차이 3곳 모두 들여쓴 둘째 줄 병합, 전체 글자 보존

### Task 3: HWPX 변환기 적용
- [x] 게이트에 HWPX 구역(fixture → HWPX: 문단별 paraPr의 left=`indentPosition(단계)`, intent=−내어쓰기, prev, keep, 줄간격이 JS 주석과 일치, keep 연속 ≤3, 척도 단조) → 실패 확인
- [x] `model_to_hwpx.py`: `render_blocks`가 boncheong에서 `layout_blocks` 주석으로 paraPr 선택, 동적 항목 paraPr 등록·정의, 243(left 0·intent −1776·prev 800)·240(left 648·intent −2328·prev 400·next 0)·245(prev 1200) → 통과
- [x] (2026-09-28 회귀 수정) 239·242 제거·동적 250~ 배정이 한글 목록 위치 참조를 두 칸씩 밀어 항목·소제목·표 셀이 엉뚱한 속성으로 조판됨 → 239·242 자리 유지, 동적 248~, 템플릿 0~237·추가분 238~ 연속 가드. 게이트 H에 id=위치·itemCnt=개수·참조<정의 개수 단정 추가(수정 전 RED 확인)
- [x] `verify-body-layout-v2-hwpx.py` 240 기대값 갱신, 전체 게이트 무회귀(비GUI 13종 + 빌드, 2026-09-28)

### Task 4: 빠른 미리보기 쌍둥이
- [x] `PlanPreview.jsx`: `layoutBlocks(visibleBlocks)`로 항목·제목 인라인 스타일(paddingLeft=(indentPosition(단계)+내어쓰기)/100pt, textIndent=−내어쓰기, marginTop=prev, lineHeight=줄간격) → 빌드·`verify:preview-equivalence` 통과

### Task 5: 한글 실물 검증
- [x] `inspect_pdf_spacing.py`(한글 PDF 기준선 실측 → paraPr 정의값 대조, 줄간격 ±2%p·위 간격 ±0.6pt·들여쓰기 ±0.8pt). 2026-09-28: 정의를 목록 위치로 풀고 id≠위치·목록 밖 참조를 FAIL로 보고, 쪽 번호 줄을 짝짓기에서 제외
- [x] 폭염 계획 재생성(`heat-plan-v0.12.12-fix.hwpx`) → 사용자 한글 열람 확인 "이상 없음·확정"(2026-09-28). PDF 미저장으로 `inspect_pdf_spacing.py` 자동 실측은 생략 — 헤더 무결성(번호=위치, 참조<정의 개수)·기호별 칸 위치는 HWPX에서 위치 기준으로 확인. 표 관련 사항은 사용자 지시로 V4 16단계 이월
- [x] `package.json` 게이트 편입, `dist:installer`(CDP 게이트 2종 통과), V4 문서 갱신 → 2026-09-28 릴리스 v0.12.12(`1005332`, 표 무결성 긴급 수정과 합본), 설치본 재설치·화면 배지 확인
