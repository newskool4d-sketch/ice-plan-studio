# 13단계 긴급 수정(v0.12.12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 흐름을 거친 표의 머리글 중복(I-1)·규칙 자동수정 행 밀림(I-2)·시간 표기 오탐(I-3)을 근본 수정하고, 이미 저장된 `.iceplan`도 올바르게 내보내지게 한다.

**Architecture:** 표 텍스트의 단일 원천을 `table.cells`로 고정하는 `tableGrid` 규칙(JS·Python 쌍둥이)을 만들고, 미리보기 투영·규칙 엔진·HWPX 변환기가 모두 이 규칙으로 읽고 쓴다. 투영 전용 모양(rows에 머리글 포함, 폭·높이 추정치)은 저장 경계(`pageDraftsFrom`)에서 모델 모양으로 되돌린다. 시간 규칙은 시각만 변환하고 '전체 적용' 대상에서 뺀다.

**Tech Stack:** Node 22 ESM(`node:assert/strict` 게이트 스크립트), React 19, Electron 38, Python 3(`model_to_hwpx.py`), adm-zip.

**Spec:** `docs/IMPROVEMENT_PLAN_V4_공문서무결성_디자인.md` §2-1·§4 13단계 (D-0 승인 2026-09-27: I-1~I-3을 v0.12.12 패치로 먼저 배포)

## Global Constraints

- 작업 경로: `apps/desktop-prototype/` (이하 상대 경로는 이 폴더 기준)
- 쌍둥이 원칙: 표 원천 규칙은 `src/domain/tableGrid.js`와 `scripts/model_to_hwpx.py`의 `table_grid`가 같아야 한다
- 새 의존성 추가 금지 — `adm-zip`·`node:assert`만 사용
- 테스트 자료는 합성 fixture(`test-data/e2e-fidelity/`)만 커밋 — 사용자 원문(바탕 화면 `추가자료`) 커밋 금지
- 커밋은 사용자 커밋 범위 확인 후 일괄 수행(태스크별 커밋 단계는 확인 전까지 보류) — 전역 지침
- 버전 규칙 `0.<완료 단계>.<패치>` → 이번 패치 `0.12.12`. 설치본 재설치·GitHub 릴리스는 사용자 확인 후
- 0.13.0으로 미루는 13단계 항목: 저장본 복구 **경고 배너(칸 목록)**, 한글 COM 복구, `approval.edits` 기반 오탐 되돌리기 제안

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/domain/tableGrid.js` | 표 원천 규칙(cells 우선·옛 투영형 머리글 중복 제거)·header/rows 재파생 | 신규 |
| `src/domain/previewProjection.js` | `normalizeBlock` cells 우선, 투영→모델 역변환 `modelBlockFromProjection` | 수정 |
| `src/domain/workflowModel.js` | `pageDraftsFrom` 저장 경계 역변환, 저장본 정규화 `normalizeStoredPageDrafts` | 수정 |
| `src/domain/ruleEngine.js` | 표 셀 읽기·쓰기 tableGrid 경유, `normalizeTimes` 교정, 전체 적용 제외 플래그 | 수정 |
| `src/components/WorkflowApp.jsx` | 전체 적용 건수, 저장본 정규화 알림 | 수정 |
| `src/components/workflow/RulesPanel.jsx` | 개별 확인 규칙 표시 | 수정 |
| `scripts/model_to_hwpx.py` | `table_grid`로 표 출력 | 수정 |
| `scripts/verify-e2e-fidelity.mjs` | 전 구간 대조 게이트 | 신규 |
| `test-data/e2e-fidelity/table-integrity.md` | 합성 fixture | 신규 |
| `scripts/verify-rule-engine.mjs` | 시간 규칙·표 셀 적용 단정 | 수정 |
| `scripts/verify-workflow-walk.mjs` | 설치본 실조판 표 무결성 단정 | 수정 |
| `package.json` | `verify:e2e-fidelity`, dist 게이트 편입, 버전 0.12.12 | 수정 |

---

### Task 1: 표 원천 규칙 + 저장 경계 차단 (I-1·I-2 근본)

**Files:**
- Create: `src/domain/tableGrid.js`
- Modify: `src/domain/previewProjection.js:12-21`(normalizeBlock), 끝부분에 `modelBlockFromProjection` 추가
- Modify: `src/domain/workflowModel.js:70-92`(pageDraftsFrom)
- Create: `test-data/e2e-fidelity/table-integrity.md`
- Create: `scripts/verify-e2e-fidelity.mjs` (A·B 구역)

**Interfaces:**
- Produces: `tableGrid(block) → string[][]`(0행=머리글), `withTableGrid(block, grid) → block`(header·rows를 새 배열로), `modelBlockFromProjection(block) → block`

- [ ] **Step 1: fixture 작성** — `test-data/e2e-fidelity/table-integrity.md`

```markdown
# 2026 표 무결성 검증 계획

## Ⅰ. 추진 목적

- 표 머리글과 셀 내용이 불러오기부터 내보내기까지 보존되는지 확인한다.

## Ⅱ. 운영 기준

### 1. 단계별 기준

| 단계 | 기준 | 조치 |
|---|---|---|
| 1단계 | 31℃ 이상 | 2시간 이상 연속 배치 지양 |
| 2단계 | 33℃ 이상 | 2시간 이내마다 20분 휴식 |
| 3단계 | 35℃ 이상 | 14~17시 옥외 업무 미배치 |

### 2. 참고 기준

| 구분 | 내용 |
|---|---|
| 상담 | 1:1 상담 운영 |
| 일정 | 2026-9-8 오후 3시 20분 시작 |
```

- [ ] **Step 2: 실패하는 게이트 A·B 구역 작성** — `scripts/verify-e2e-fidelity.mjs`

```js
#!/usr/bin/env node
/**
 * 전 구간 대조 게이트(V4 13단계) — 불러오기 → 구조편집 쪽 초안 → 규칙 '전체 적용'
 * → HWPX 내보내기까지 표 텍스트가 입력과 같게 보존되는지 본다.
 *
 * 기존 게이트는 pageDraftsFrom·withPagePlan을 거치지 않은 모델만 검증해서, 미리보기
 * 투영(rows에 머리글 포함)이 저장 모델로 새어 생긴 머리글 중복(I-1)과 자동수정 행
 * 밀림(I-2)을 놓쳤다. 이 게이트는 앱과 같은 함수 경로를 밟는다.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableGrid } from '../src/domain/tableGrid.js';
import { pageDraftsFrom, withPagePlan } from '../src/domain/workflowModel.js';
import { agencyProfiles } from '../src/domain/agencyProfiles.js';

const require = createRequire(import.meta.url);
const inputAdapters = require('../electron/input-adapters.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test-data', 'e2e-fidelity', 'table-integrity.md');
const EXPECTED_SOURCE = [
  [['단계', '기준', '조치'], ['1단계', '31℃ 이상', '2시간 이상 연속 배치 지양'], ['2단계', '33℃ 이상', '2시간 이내마다 20분 휴식'], ['3단계', '35℃ 이상', '14~17시 옥외 업무 미배치']],
  [['구분', '내용'], ['상담', '1:1 상담 운영'], ['일정', '2026-9-8 오후 3시 20분 시작']],
];
const pageTables = (model) => (model.metadata.pages || [])
  .flatMap((page) => page.blocks || [])
  .filter((block) => block.type === 'table');

// A. 표 원천 규칙: cells가 있으면 원천, 없으면 투영형 머리글 중복 행을 걸러낸다
assert.deepEqual(
  tableGrid({ type: 'table', table: { cells: [[{ text: 'h' }], [{ text: 'b' }]] }, header: ['손상'], rows: [['손상'], ['b']] }),
  [['h'], ['b']], 'cells가 있으면 header·rows가 어긋나도 cells를 따라야 함');
assert.deepEqual(
  tableGrid({ type: 'table', header: ['구분', '내용'], rows: [['구분', '내용'], ['가', '나']] }),
  [['구분', '내용'], ['가', '나']], 'cells 없는 옛 투영형 표는 머리글 중복 행을 걸러야 함');
assert.deepEqual(
  tableGrid({ type: 'table', header: ['구분', '내용'], rows: [['가', '나']] }),
  [['구분', '내용'], ['가', '나']], '모델형 표는 그대로');

// B. 앱 흐름 저장 경계: 쪽 초안에 저장된 표가 모델 모양이어야 한다
const agency = agencyProfiles['direct-student'];
const loaded = await inputAdapters.loadPlanInput(FIXTURE);
const planned = withPagePlan(loaded, pageDraftsFrom(loaded, agency));
assert.deepEqual(pageTables(planned).map(tableGrid), EXPECTED_SOURCE, '쪽 초안의 표 원천이 입력과 같아야 함');
for (const block of pageTables(planned)) {
  assert.notEqual(block.rows[0], block.header, 'rows[0]이 머리글 배열을 공유하면 안 됨(I-2 원인)');
  assert.deepEqual([block.header, ...block.rows], tableGrid(block), 'header·rows가 원천과 같아야 함(I-1 원인)');
  assert.equal('columnWidthsHwpUnit' in block, false, '미리보기 투영 필드가 저장 모델로 새면 안 됨');
}

console.log(JSON.stringify({ gate: 'e2e-fidelity', sections: ['A', 'B'], passed: true }, null, 2));
```

- [ ] **Step 3: 실패 확인** — Run: `node scripts/verify-e2e-fidelity.mjs` / Expected: FAIL — `Cannot find module '../src/domain/tableGrid.js'`

- [ ] **Step 4: `src/domain/tableGrid.js` 작성**

```js
// 표 텍스트의 단일 원천 규칙 (V4 13단계, I-1·I-2).
//
// 표 블록은 table.cells(원본 셀)와 header·rows(호환 필드)를 함께 가진다. 둘이 어긋나면
// cells가 원천이다 — 규칙 자동수정이 cells는 올바른 칸에 고쳤는데 header·rows만 한 행
// 밀려 훼손된 저장본이 실재한다(v0.12.0~0.12.11). cells가 없는 표(요약·자리표시 파생 표,
// 브라우저 파서 표)는 header·rows를 쓰되, 미리보기 투영이 rows 앞에 머리글을 한 번 더
// 넣은 옛 저장 모양을 걸러낸다. scripts/model_to_hwpx.py table_grid와 같은 규칙이어야
// 미리보기와 HWPX가 같다.

const text = (value) => String(value ?? '');

function sameRow(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function tableGrid(block) {
  const cells = block?.table?.cells;
  if (Array.isArray(cells) && cells.length) return cells.map((row) => row.map((cell) => text(cell?.text)));
  const header = Array.isArray(block?.header) ? block.header.map(text) : [];
  let rows = Array.isArray(block?.rows) ? block.rows.map((row) => row.map(text)) : [];
  if (rows.length && sameRow(rows[0], header)) rows = rows.slice(1);
  return [header, ...rows];
}

// header·rows를 격자에서 새 배열로 다시 만든다 — 배열 공유(header === rows[0])가
// 남으면 한쪽 수정이 다른 쪽을 조용히 바꾼다(I-2).
export function withTableGrid(block, grid) {
  return { ...block, header: [...(grid[0] || [])], rows: grid.slice(1).map((row) => [...row]) };
}
```

- [ ] **Step 5: `previewProjection.js` 수정** — import 추가, `normalizeBlock` 교체, 역변환 추가

```js
import { tableGrid, withTableGrid } from "./tableGrid.js";
```

```js
function normalizeBlock(block) {
  if (block?.type !== "table") return block;
  return withTableGrid(block, tableGrid(block));
}
```

파일 끝 `export { layoutTokens };` 위에 추가:

```js
// 미리보기 투영 블록 → 저장 모델 블록. 투영은 PlanPreview 편의를 위해 표 rows 앞에
// 머리글을 한 번 더 넣고(rows[0] === header) 폭·높이 추정치를 붙인다. 이 모양이
// metadata.pages로 저장되면 HWPX 머리글이 중복되고(I-1) 규칙 자동수정이 한 행 위에
// 기록된다(I-2). 저장 경계(pageDraftsFrom)는 반드시 이 함수를 거친다.
export function modelBlockFromProjection(block) {
  if (block?.type !== "table") return block;
  const { rows = [], columnWidthsHwpUnit: _widths, rowHeightsHwpUnit: _heights, widthHwpUnit: _width, ...rest } = block;
  return withTableGrid(rest, rows);
}
```

- [ ] **Step 6: `workflowModel.js` 수정** — import와 `pageDraftsFrom`의 `blocks` 줄

```js
import { createPreviewProjection, modelBlockFromProjection } from "./previewProjection.js";
```

```js
    blocks: (page.blocks || []).map(modelBlockFromProjection),
```

- [ ] **Step 7: 통과 확인** — Run: `node scripts/verify-e2e-fidelity.mjs` / Expected: PASS(`"passed": true`) + 기존 `npm run verify:preview-equivalence` PASS

### Task 2: 규칙 엔진 표 셀 읽기·쓰기 원천화 (I-2)

**Files:**
- Modify: `src/domain/ruleEngine.js:65-96`(textTargets), `:408-433`(readTarget·writeTarget)
- Test: `scripts/verify-rule-engine.mjs` (끝부분 보고 직전에 표 구역 추가)

**Interfaces:**
- Consumes: `tableGrid`, `withTableGrid` (Task 1)

- [ ] **Step 1: 실패하는 테스트 추가** — `verify-rule-engine.mjs`의 최종 `console.log` 직전

```js
// V4 13단계 I-2: 쪽 초안 표(원천 cells + 투영형 rows 잔재)에 날짜 제안을 적용해도
// 해당 칸만 바뀌고 머리글·행 순서가 보존되어야 한다.
const tableCells = (rows) => rows.map((row) => row.map((text) => ({ text, rowSpan: 1, colSpan: 1 })));
const legacyTableModel = {
  schemaVersion: '0.2', kind: 'plan-ir', approval: { status: 'unapproved' }, blocks: [],
  metadata: { pages: [{ type: 'body-opening', blocks: [{
    type: 'table',
    table: { cells: tableCells([['구분', '내용'], ['상담', '운영'], ['일정', '2026-9-8 시작']]) },
    header: ['구분', '내용'],
    rows: [['구분', '내용'], ['상담', '운영'], ['일정', '2026-9-8 시작']],
  }] }] },
};
const legacyApplied = applyAllRuleSuggestions(legacyTableModel).model.metadata.pages[0].blocks[0];
assert.deepEqual(legacyApplied.header, ['구분', '내용'], '머리글이 덮어써지면 안 됨(I-2)');
assert.deepEqual(legacyApplied.rows, [['상담', '운영'], ['일정', '2026. 9. 8. 시작']], '수정은 해당 칸에만, 투영형 잔재는 정리');
assert.notEqual(legacyApplied.rows[0], legacyApplied.header, '적용 후 배열 공유가 없어야 함');
```

- [ ] **Step 2: 실패 확인** — Run: `node scripts/verify-rule-engine.mjs` / Expected: FAIL — `머리글이 덮어써지면 안 됨(I-2)`

- [ ] **Step 3: `ruleEngine.js` 수정** — 맨 위 import, textTargets 표 분기, readTarget·writeTarget 표 분기

```js
import { tableGrid } from './tableGrid.js';
```

textTargets의 `if (block.type !== 'table') continue;` 아래(기존 cells/rows 두 분기 전체)를 교체:

```js
      if (block.type !== 'table') continue;
      tableGrid(block).forEach((row, rowIndex) => row.forEach((text, columnIndex) => targets.push({
        target: tableCellTarget(scope, blockIndex, rowIndex, columnIndex),
        text,
        block,
      })));
```

readTarget 마지막 `return` 교체:

```js
  return tableGrid(block)[target.rowIndex]?.[target.columnIndex];
```

writeTarget의 표 분기(마지막 세 줄) 교체:

```js
  // 표는 원천(cells)에 쓰고 header·rows를 원천에서 다시 만든다. 인덱스 산수(rows[r-1])로
  // 쓰면 투영형 rows(머리글 포함)에서 한 행 위에 기록된다(I-2, v0.12.0~0.12.11).
  const cell = block.table?.cells?.[target.rowIndex]?.[target.columnIndex];
  const grid = tableGrid(block);
  if (cell) {
    cell.text = value;
    grid[target.rowIndex][target.columnIndex] = value;
  } else if (grid[target.rowIndex]) {
    grid[target.rowIndex][target.columnIndex] = value;
  }
  block.header = grid[0];
  block.rows = grid.slice(1);
```

- [ ] **Step 4: 통과 확인** — Run: `node scripts/verify-rule-engine.mjs` / Expected: PASS

> **구현 중 발견(I-4, 2026-09-27)**: Step 4에서 표 수정은 정상이나 `DATE-FORMAT`이 날짜 뒤 공백을 흡수해 `2026-9-8 시작`→`2026. 9. 8.시작`이 됨. 명시 테스트(`DATE-FORMAT이 뒤 공백을 지우면 안 됨`)를 먼저 추가해 실패 확인 후 `normalizeDates`의 `(\d{1,2})\s*(?:일)?` → `(\d{1,2})(?:\s*일)?`로 수정 — 같은 태스크에서 처리

### Task 3: 시간 표기 교정 + 전체 적용 제외 (I-3)

**Files:**
- Modify: `src/domain/ruleEngine.js:23-37`(finding), `:118-127`(normalizeTimes), `:144-167`(TEXT_RULES·addTextSuggestions), `:460-472`(applyAllRuleSuggestions), export 목록
- Modify: `src/components/WorkflowApp.jsx:105`, `src/components/workflow/RulesPanel.jsx:11`
- Test: `scripts/verify-rule-engine.mjs:33-39`(기대값 갱신) + 시간 표기 표본 추가

**Interfaces:**
- Produces: `isBulkApplicable(finding) → boolean`, finding 필드 `bulkApply`

- [ ] **Step 1: 실패하는 테스트 작성** — `verify-rule-engine.mjs` 33~39행 교체 + 표본 추가

```js
const all = applyAllRuleSuggestions(model);
assert.equal(JSON.stringify(model), original, 'apply-all must not mutate the source model');
assert.equal(inspectDocumentRules(all.model).filter(isBulkApplicable).length, 0, 'bulk suggestions must be resolved');
// 시간 표기는 '전체 적용'에서 제외(I-3) — 개별 승인으로만 바뀐다.
const pendingTime = inspectDocumentRules(all.model).find((item) => item.code === 'TIME-FORMAT');
assert.ok(pendingTime && pendingTime.bulkApply === false, 'TIME-FORMAT must stay for individual approval');
const timed = applyRuleSuggestion(all.model, pendingTime).model;
assert.match(all.model.blocks[2].text, /「교육기본법」/);
assert.match(all.model.blocks[2].text, /2026\. 3\. 5\.~2026\. 3\. 7\./);
assert.match(timed.blocks[2].text, /09:00/);
assert.match(timed.blocks[2].text, /10:05/);
assert.match(all.model.blocks[2].text, /10,000원/);
```

시간 표본(표 구역 다음에 추가):

```js
// I-3: 영 제7조⑤는 시각 표기 규정 — 기간·일반어·비율은 바꾸지 않고, 범위는 통째로.
const timeCases = [
  ['2시간 이상 연속 배치 지양', null],
  ['24시간 운영', null],
  ['3~4시간 소요', null],
  ['3시기 편성', null],
  ['1:1 상담 운영', null],
  ['14~17시 옥외 업무 미배치', '14:00~17:00 옥외 업무 미배치'],
  ['12~17시 자제', '12:00~17:00 자제'],
  ['오후 3시 20분 시작', '15:20 시작'],
  ['10시에 집합', '10:00에 집합'],
  ['9시 반 출발', '09:30 출발'],
  ['9시 반장 회의', '09:00 반장 회의'],
];
for (const [text, expected] of timeCases) {
  const caseModel = { schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' }, blocks: [{ type: 'paragraph', text }] };
  const found = inspectDocumentRules(caseModel).find((item) => item.code === 'TIME-FORMAT');
  assert.equal(found?.after ?? null, expected, `TIME-FORMAT 표본: ${text}`);
}
```

import 줄에 `isBulkApplicable` 추가, 보고서의 `remainingSuggestions` 줄을 `inspectDocumentRules(all.model).filter(isBulkApplicable).length`로 교체.

- [ ] **Step 2: 실패 확인** — Run: `node scripts/verify-rule-engine.mjs` / Expected: FAIL — `isBulkApplicable` 미정의(SyntaxError: does not provide an export)

- [ ] **Step 3: `ruleEngine.js` 구현**

finding 시그니처·반환:

```js
function finding({ code, title, severity = 'warning', message, kind = 'warning', target = null, before = null, after = null, evidence, bulkApply = true }) {
  return {
    id: `${code}:${target ? targetKey(target) : 'document'}`,
    code,
    title,
    severity,
    message,
    kind,
    action: kind === 'suggestion' ? 'replace' : 'warning',
    bulkApply: kind === 'suggestion' && bulkApply,
    target,
    before,
    after,
    evidence,
  };
}
```

normalizeTimes 교체:

```js
// 영 제7조⑤는 시각(시·분) 표기 규정이다. '2시간'(기간)·'3시기'(일반어)·'1:1'(비율)을
// 시각으로 바꾸면 내용이 훼손된다(v0.12.11 실사용 문서에서 '2시간'→'02:00간' 확인).
// '시' 뒤에는 끝·비한글·조사만 허용하고, 범위('14~17시')는 통째로 바꾼다.
const HOUR_FOLLOWER = /^(?:$|[^가-힣]|에|부터|까지|경|전|후|로|쯤|께)/;

function clockText(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeTimes(text) {
  const ranged = text.replace(/(?<![\d:.])(\d{1,2})\s*[~∼～〜]\s*(\d{1,2})\s*시/g, (match, from, to, offset, whole) => {
    if (!HOUR_FOLLOWER.test(whole.slice(offset + match.length))) return match;
    if (Number(from) > 23 || Number(to) > 23) return match;
    return `${clockText(Number(from), 0)}~${clockText(Number(to), 0)}`;
  });
  return ranged.replace(
    /(?<![\d:])(?:(오전|오후)\s*)?(\d{1,2})(?:\s*시(?:\s*(\d{1,2})\s*분|\s*(반)(?![가-힣]))?|:(\d{1,2}))(?![\d:])/g,
    (match, meridiem, hourValue, minuteWord, half, minuteColon, offset, whole) => {
      if (minuteColon !== undefined) {
        // 비율(1:1·3:7) 오탐 방지: 두 자리 분 또는 두 자리 시만 시각으로 본다.
        if (minuteColon.length < 2 && hourValue.length < 2) return match;
      } else if (!HOUR_FOLLOWER.test(whole.slice(offset + match.length))) {
        return match;
      }
      let hour = Number(hourValue);
      const minute = half ? 30 : Number(minuteWord ?? minuteColon ?? 0);
      if (meridiem === '오후' && hour < 12) hour += 12;
      if (meridiem === '오전' && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return match;
      return clockText(hour, minute);
    },
  );
}
```

TEXT_RULES의 TIME-FORMAT 항목에 `bulk: false` 추가:

```js
  { code: 'TIME-FORMAT', title: '시간 표기', message: '시간을 24시각제 HH:MM 형식으로 표기합니다.', transform: normalizeTimes, bulk: false },
```

addTextSuggestions의 finding 호출에 `bulkApply: rule.bulk !== false,` 추가. 파일 하단에:

```js
// '전체 적용'은 오탐 없는 규칙만 — 시간 표기처럼 문맥 판단이 필요한 규칙은 개별 승인(I-3).
export function isBulkApplicable(ruleFinding) {
  return ruleFinding?.kind === 'suggestion' && ruleFinding.bulkApply !== false;
}
```

applyAllRuleSuggestions의 find 조건 교체:

```js
    const suggestion = inspectDocumentRules(current).find((item) => isBulkApplicable(item) && !excluded.has(item.id));
```

- [ ] **Step 4: UI 반영** — `WorkflowApp.jsx` import에 `isBulkApplicable` 추가, 105행:

```js
  const suggestionCount = visibleFindings.filter(isBulkApplicable).length;
```

`RulesPanel.jsx` 11행의 라벨:

```jsx
<small>{ruleFinding.code} · {ruleFinding.kind === "suggestion" ? (ruleFinding.bulkApply === false ? "수정 제안 · 개별 확인" : "수정 제안") : "확인 필요"}</small>
```

- [ ] **Step 5: 통과 확인** — Run: `node scripts/verify-rule-engine.mjs && node scripts/verify-e2e-fidelity.mjs` / Expected: 둘 다 PASS

### Task 4: HWPX 변환기 원천화 + 게이트 C·D·E 구역 (I-1 출력단·저장본)

**Files:**
- Modify: `scripts/model_to_hwpx.py`(table_grid 추가, `table_xml`·`block_plain_text`·`toc_blocks_effectively_empty`·`is_duplicate_title`)
- Modify: `src/domain/workflowModel.js`(normalizeStoredPageDrafts 추가), `src/components/WorkflowApp.jsx`(loadWorkspace)
- Test: `scripts/verify-e2e-fidelity.mjs`(C·D·E 구역), `package.json`

**Interfaces:**
- Produces: Python `table_grid(block) -> list[list[str]]`, JS `normalizeStoredPageDrafts(drafts) → { drafts, repairedTables }`

- [ ] **Step 1: 게이트 C·D·E 구역 추가(실패 확인용)** — B 구역 뒤, 최종 로그 앞

```js
// C. 규칙: 시간 표기 오탐 없음 + '전체 적용'은 해당 칸만(시간 표기 제외)
const findings = inspectDocumentRules(planned).filter((item) => item.code === 'TIME-FORMAT');
assert.ok(!findings.some((item) => /\d{2}:\d{2}간/.test(item.after)), "기간('2시간')을 시각으로 바꾸면 안 됨(I-3)");
assert.ok(!findings.some((item) => item.before.includes('1:1')), "비율('1:1')을 시각으로 보면 안 됨(I-3)");
const applied = applyAllRuleSuggestions(planned).model;
const EXPECTED_AFTER_BULK = structuredClone(EXPECTED_SOURCE);
EXPECTED_AFTER_BULK[1][2][1] = '2026. 9. 8. 오후 3시 20분 시작';
assert.deepEqual(pageTables(applied).map(tableGrid), EXPECTED_AFTER_BULK, '전체 적용은 해당 칸만 — 머리글·행 순서 보존(I-2)');
const rangeFinding = inspectDocumentRules(applied).find((item) => item.code === 'TIME-FORMAT' && item.before === '14~17시 옥외 업무 미배치');
assert.equal(rangeFinding?.after, '14:00~17:00 옥외 업무 미배치', '시각 범위는 통째로(I-3)');
const timed = applyRuleSuggestion(applied, rangeFinding).model;
const EXPECTED_FINAL = structuredClone(EXPECTED_AFTER_BULK);
EXPECTED_FINAL[0][3][2] = '14:00~17:00 옥외 업무 미배치';
assert.deepEqual(pageTables(timed).map(tableGrid), EXPECTED_FINAL);

// D. 내보내기: HWPX 표가 모델 원천과 같아야 한다(머리글 1회)
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-e2e-'));
const exportedFinal = await exportTables(compositionModel(timed, agency), work, 'final');
assert.deepEqual(pickTables(exportedFinal, EXPECTED_FINAL), EXPECTED_FINAL, 'HWPX 표가 원천과 같아야 함(I-1)');

// E. v0.12.0~0.12.11 저장본 재현: 투영형 rows(머리글 포함) + 덮어쓴 머리글, cells는 정상
const legacy = structuredClone(timed);
for (const block of pageTables(legacy)) {
  block.header = block.header.map(() => '손상');
  block.rows = [block.header, ...block.rows];
}
legacy.metadata.pages.find((page) => page.type === 'body-opening').blocks
  .push({ type: 'table', header: ['항목', '값'], rows: [['항목', '값'], ['가', '나']] });
const naive = pageTables(legacy).slice(0, 2).map((block) => [block.header, ...block.rows]);
assert.notDeepEqual(naive, EXPECTED_FINAL, '공허성 확인: 옛 읽기(header+rows)는 이 저장본에서 틀려야 함');
const exportedLegacy = await exportTables(compositionModel(legacy, agency), work, 'legacy');
const EXPECTED_LEGACY = [...EXPECTED_FINAL, [['항목', '값'], ['가', '나']]];
assert.deepEqual(pickTables(exportedLegacy, EXPECTED_LEGACY), EXPECTED_LEGACY, '훼손 저장본도 원천 기준으로 내보내야 함');
const { drafts, repairedTables } = normalizeStoredPageDrafts(legacy.metadata.pages);
assert.equal(repairedTables, 3, '투영형·손상 표 3개를 정리해야 함');
assert.deepEqual(drafts.flatMap((page) => page.blocks || []).filter((block) => block.type === 'table')
  .map((block) => [block.header, ...block.rows]), EXPECTED_LEGACY);
await fs.rm(work, { recursive: true, force: true });
```

import·도우미 추가(파일 위쪽):

```js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { compositionModel, normalizeStoredPageDrafts } from '../src/domain/workflowModel.js';
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules } from '../src/domain/ruleEngine.js';

const PYTHON = process.env.ICE_PLAN_PYTHON || 'python';
const decodeXml = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function exportTables(model, workDir, name) {
  const modelPath = path.join(workDir, `${name}.model.json`);
  const hwpxPath = path.join(workDir, `${name}.hwpx`);
  await fs.writeFile(modelPath, JSON.stringify(model), 'utf8');
  const result = spawnSync(PYTHON, [path.join(ROOT, 'scripts', 'model_to_hwpx.py'), modelPath, hwpxPath, '--template', 'boncheong'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`model_to_hwpx 실패(${name}): ${result.stderr || result.stdout}`);
  const xml = new AdmZip(hwpxPath).readAsText('Contents/section0.xml');
  return [...xml.matchAll(/<hp:tbl\b[^>]*>([\s\S]*?)<\/hp:tbl>/g)].map((table) => [...table[1].matchAll(/<hp:tr>([\s\S]*?)<\/hp:tr>/g)]
    .map((row) => [...row[1].matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)]
      .map((cell) => [...cell[0].matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((match) => decodeXml(match[1])).join(''))));
}

// 제목틀·장 제목 표를 빼고, 기대 표와 머리글이 같은 출력 표만 순서대로 고른다.
function pickTables(exported, expected) {
  return expected.map((grid) => exported.find((table) => JSON.stringify(table[0]) === JSON.stringify(grid[0])) || null);
}
```

- [ ] **Step 2: 실패 확인** — Run: `node scripts/verify-e2e-fidelity.mjs` / Expected: FAIL — `normalizeStoredPageDrafts` 미정의 export

- [ ] **Step 3: `workflowModel.js`에 저장본 정규화 추가**

```js
import { tableGrid, withTableGrid } from "./tableGrid.js";
```

```js
// 저장본(.iceplan) 쪽 초안의 표를 원천(cells) 기준으로 정리한다(V4 13단계 저장본 복구).
// v0.12.0~0.12.11 저장본은 투영 모양(rows에 머리글 포함)과 자동수정 행 밀림을 담을 수
// 있다. 바뀐 표 수를 돌려줘 불러오기 알림에 쓴다 — 묵시 변경 금지.
export function normalizeStoredPageDrafts(drafts) {
  let repairedTables = 0;
  const normalized = (drafts || []).map((draft) => ({
    ...draft,
    blocks: (draft.blocks || []).map((block) => {
      if (block?.type !== "table") return block;
      const { columnWidthsHwpUnit: _widths, rowHeightsHwpUnit: _heights, widthHwpUnit: _width, ...rest } = block;
      const next = withTableGrid(rest, tableGrid(rest));
      if (JSON.stringify([block.header || [], ...(block.rows || [])]) !== JSON.stringify([next.header, ...next.rows])) repairedTables += 1;
      return next;
    }),
  }));
  return { drafts: normalized, repairedTables };
}
```

- [ ] **Step 4: `model_to_hwpx.py`에 `table_grid` 추가·사용** — `block_plain_text` 위에:

```python
def table_grid(block):
    """표 텍스트의 단일 원천 — src/domain/tableGrid.js tableGrid와 같은 규칙.

    table.cells가 있으면 원천이다(규칙 자동수정이 cells는 바르게 고쳤는데 header·rows만
    한 행 밀린 저장본이 실재 — v0.12.0~0.12.11). cells가 없으면 header·rows를 쓰되,
    미리보기 투영이 rows 앞에 머리글을 한 번 더 넣은 옛 저장 모양을 걸러낸다.
    """
    def text(value):
        return '' if value is None else str(value)

    cells = (block.get('table') or {}).get('cells')
    if isinstance(cells, list) and cells:
        return [[text((cell or {}).get('text')) for cell in row] for row in cells]
    header = [text(value) for value in (block.get('header') or [])]
    rows = [[text(value) for value in row] for row in (block.get('rows') or [])]
    if rows and rows[0] == header:
        rows = rows[1:]
    return [header] + rows
```

교체 4곳:
- `block_plain_text`: `cells = list(block.get('header') or [])` + `cells.extend(...)` 두 줄 → `cells = [cell for row in table_grid(block) for cell in row]`
- `toc_blocks_effectively_empty`: 같은 두 줄 → `cells = [cell for row in table_grid(block) for cell in row]`
- `is_duplicate_title`(page_type_paragraphs 안): 같은 두 줄 → `cells = [cell for row in table_grid(block) for cell in row]`
- `table_xml`: `header = block.get('header', [])` + `rows = [header] + block.get('rows', [])` → `rows = table_grid(block)`

- [ ] **Step 5: 불러오기 경로 연결** — `WorkflowApp.jsx` import에 `normalizeStoredPageDrafts` 추가, `loadWorkspace`의 `nextDrafts` 계산 교체:

```js
      const storedDrafts = Array.isArray(workflow.pageDrafts) && workflow.pageDrafts.length
        ? normalizeStoredPageDrafts(workflow.pageDrafts.map((item) => ({ ...item, confirmed: Boolean(item.confirmed) })))
        : null;
      const nextDrafts = storedDrafts ? storedDrafts.drafts : pageDraftsFrom(nextModel, nextAgency);
```

같은 함수 끝 알림 교체:

```js
      const repairedNote = storedDrafts?.repairedTables ? ` · 표 ${storedDrafts.repairedTables}개를 원본 셀 기준으로 정리했습니다(머리글 중복·행 밀림 복구)` : "";
      setNotice(`${result.migratedFrom ? `v${result.migratedFrom} 프로젝트를 v0.2로 승격해 ` : ""}불러왔습니다: ${result.filePath}${repairedNote}`);
```

- [ ] **Step 6: npm 스크립트** — `package.json`

```json
    "verify:e2e-fidelity": "node scripts/verify-e2e-fidelity.mjs",
```

`dist:win`을 `"npm run verify:e2e-fidelity && npm run build && electron-builder --win --dir && npm run verify:app-render && npm run verify:workflow-walk"`로 교체(전 구간 게이트 상시화).

- [ ] **Step 7: 통과 확인** — Run: `npm run verify:e2e-fidelity` / Expected: PASS(A~E)

- [ ] **Step 8: 변형 테스트(커밋 안 함)** — `workflowModel.js`의 `.map(modelBlockFromProjection)`를 잠시 지우고 `npm run verify:e2e-fidelity` → FAIL 확인 → 복구 / `model_to_hwpx.py`의 `rows = table_grid(block)`를 옛 두 줄로 잠시 되돌리고 실행 → E 구역 FAIL 확인 → 복구. 결과를 보고서에 기록

### Task 5: 설치본 실주행 표 무결성 단정 (실제 앱 확인)

**Files:**
- Modify: `scripts/verify-workflow-walk.mjs`(SAMPLE, 규칙 단계, compareMode 뒤 probe, passed 조건)

- [ ] **Step 1: 표본에 표 추가** — SAMPLE 끝에:

```markdown

| 기준칸 | 조치칸 |
|---|---|
| 31℃ 이상 | 2시간 이상 연속 배치 지양 |
```

- [ ] **Step 2: 규칙 단계에서 전체 적용 경로를 태운다** — `#rule-ignore-all` 클릭 앞에:

```js
  // 규칙검수: '제안 전체 적용'(표 셀 자동수정 경로 — I-2·I-3 회귀 감시) 후 남은 항목 무시·완료
  await evaluate("document.querySelector('#rule-apply-all')?.click()");
  await sleep(1500);
```

- [ ] **Step 3: compareMode probe 다음에 표 무결성 probe 추가**

```js
  // ── 표 무결성(V4 13단계): 본문 쪽 실조판 SVG·빠른 미리보기에서 표 머리글이 한 번만
  // 나오고, 전체 적용이 기간('2시간')을 시각으로 바꾸거나 머리글을 덮어쓰지 않았는지 본다.
  report.tableIntegrity = await evaluate(`(async () => {
    const thumbs = document.querySelectorAll('.page-thumbnail');
    if (!thumbs.length) return { ok: false, reason: 'no-thumbnails' };
    thumbs[thumbs.length - 1].click();
    const svgText = () => {
      const img = document.querySelector('.compare-pane .composition-svg');
      const src = img?.getAttribute('src') || '';
      return src ? decodeURIComponent(src.slice(src.indexOf(',') + 1)) : '';
    };
    let svg = '';
    for (let i = 0; i < 40 && !svg.includes('기준칸'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      svg = svgText();
    }
    const quick = document.querySelector('.compare-pane .a4-page')?.textContent || '';
    const count = (text, value) => text.split(value).length - 1;
    const result = {
      svgHeaderCount: count(svg, '기준칸'),
      svgHeaderIntact: count(svg, '조치칸'),
      svgDurationKept: count(svg, '2시간'),
      svgClockCorruption: count(svg, '02:00간'),
      quickHeaderCount: count(quick, '기준칸'),
    };
    result.ok = result.svgHeaderCount === 1 && result.svgHeaderIntact === 1
      && result.svgDurationKept >= 1 && result.svgClockCorruption === 0 && result.quickHeaderCount === 1;
    return result;
  })()`, 40_000);
```

`report.passed` 조건에 `&& report.tableIntegrity?.ok === true` 추가.

- [ ] **Step 4: 수정 전 설치본으로 실패 확인(선행 확인)** — 현 `release/win-unpacked`(v0.12.11)로 Run: `node scripts/verify-workflow-walk.mjs "release/win-unpacked/ICE Plan Studio.exe"` / Expected: `tableIntegrity.ok: false`(머리글 2회·02:00간) — 실제 앱에서 결함 실재 확인

- [ ] **Step 5: 새 빌드로 통과 확인** — Task 6의 `dist:win`에서 자동 실행 / Expected: `tableIntegrity.ok: true`

### Task 6: 버전·전체 게이트·설치본 빌드

**Files:**
- Modify: `package.json`(version), `docs/IMPROVEMENT_PLAN_V4_공문서무결성_디자인.md`(상태 줄)

- [ ] **Step 1: 버전 상향** — `package.json` `"version": "0.12.12"`
- [ ] **Step 2: 전체 게이트** — Run(각각): `npm run verify:plan-ir`, `verify:plan-ir-source-pages`, `verify:preview-equivalence`, `verify:rules`, `verify:e2e-fidelity`, `verify:body-layout-v2-baseline`, `verify:body-layout-v2-decisions`, `verify:body-layout-v2-rendering`, `verify:body-layout-v2-hwpx`, `verify:workspace-packages`, `verify:numbered-heading-presentation`, `verify:numbered-heading-layout` / Expected: 전부 PASS(실패 시 원인 규명 후 재실행 — 동일 실패 반복 금지)
- [ ] **Step 3: 설치본 빌드** — Run: `npm run dist:installer` / Expected: e2e·app-render·walk(tableIntegrity 포함) 통과 후 `release/ICE Plan Studio Setup 0.12.12.exe` 생성
- [ ] **Step 4: 실사용 재현 확인** — 스크래치 재현(폭염 계획 MD, 앱 흐름)으로 머리글 1회·`02:00간` 0건 확인
- [ ] **Step 5: V4 계획 상태 갱신** — 상태 줄에 "13단계 긴급 수정분 v0.12.12 구현(저장본 경고 배너·COM 복구는 0.13.0)" 추가
- [ ] **Step 6: 사용자 확인 요청** — 커밋 범위(파일 목록)·재설치·GitHub 릴리스(노트에 "이미 내보낸 HWPX는 표 점검 필요" 명기) 승인 후 진행
