#!/usr/bin/env node
/**
 * 전 구간 대조 게이트(V4 13단계) — 불러오기 → 구조편집 쪽 초안 → 규칙 '전체 적용'
 * → HWPX 내보내기까지 표 텍스트가 입력과 같게 보존되는지 본다.
 *
 * 기존 게이트는 pageDraftsFrom·withPagePlan을 거치지 않은 모델만 검증해서, 미리보기
 * 투영(rows에 머리글 포함)이 저장 모델로 새어 생긴 머리글 중복(I-1)과 자동수정 행
 * 밀림(I-2)을 놓쳤다. 이 게이트는 앱과 같은 함수 경로를 밟는다.
 *
 * 사용: node scripts/verify-e2e-fidelity.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { tableGrid } from '../src/domain/tableGrid.js';
import { compositionModel, normalizeStoredPageDrafts, pageDraftsFrom, withPagePlan } from '../src/domain/workflowModel.js';
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules } from '../src/domain/ruleEngine.js';
import { agencyProfiles } from '../src/domain/agencyProfiles.js';

const require = createRequire(import.meta.url);
const inputAdapters = require('../electron/input-adapters.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test-data', 'e2e-fidelity', 'table-integrity.md');
const PYTHON = process.env.ICE_PLAN_PYTHON || 'python';
const decodeXml = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// 모델을 실제 변환기(model_to_hwpx.py)로 내보내고 section0.xml의 표를 행·칸 텍스트로 읽는다.
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

// C. 규칙: 시간 표기 오탐 없음 + '전체 적용'은 해당 칸만(시간 표기 제외)
const timeFindings = inspectDocumentRules(planned).filter((item) => item.code === 'TIME-FORMAT');
assert.ok(!timeFindings.some((item) => /\d{2}:\d{2}간/.test(item.after)), "기간('2시간')을 시각으로 바꾸면 안 됨(I-3)");
assert.ok(!timeFindings.some((item) => item.before.includes('1:1')), "비율('1:1')을 시각으로 보면 안 됨(I-3)");
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
legacy.metadata.pages.find((page) => ['body-opening', 'body'].includes(page.type)).blocks
  .push({ type: 'table', header: ['항목', '값'], rows: [['항목', '값'], ['가', '나']] });
const naive = pageTables(legacy).slice(0, 2).map((block) => [block.header, ...block.rows]);
assert.notDeepEqual(naive, EXPECTED_FINAL, '공허성 확인: 옛 읽기(header+rows)는 이 저장본에서 틀려야 함');
const EXPECTED_LEGACY = [...EXPECTED_FINAL, [['항목', '값'], ['가', '나']]];
const exportedLegacy = await exportTables(compositionModel(legacy, agency), work, 'legacy');
assert.deepEqual(pickTables(exportedLegacy, EXPECTED_LEGACY), EXPECTED_LEGACY, '훼손 저장본도 원천 기준으로 내보내야 함');
const { drafts, repairedTables } = normalizeStoredPageDrafts(legacy.metadata.pages);
assert.equal(repairedTables, 3, '투영형·손상 표 3개를 정리해야 함');
assert.deepEqual(drafts.flatMap((page) => page.blocks || []).filter((block) => block.type === 'table')
  .map((block) => [block.header, ...block.rows]), EXPECTED_LEGACY);
await fs.rm(work, { recursive: true, force: true });

console.log(JSON.stringify({
  gate: 'e2e-fidelity',
  sections: ['A', 'B', 'C', 'D', 'E'],
  tables: EXPECTED_FINAL.length,
  repairedLegacyTables: repairedTables,
  passed: true,
}, null, 2));
