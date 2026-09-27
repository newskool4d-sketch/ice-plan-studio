#!/usr/bin/env node
/**
 * 항목 위계·간격 척도 게이트(V4, 2026-09-27 한글 PDF 실측 후속).
 *
 * 한글 실물에서만 드러난 결함 — 서술형 문장에 제목 속성(다음 문단과 함께·160%)이 붙어
 * 19문단이 한 덩어리로 다음 쪽에 넘어가 빈 쪽이 생기고, 하위 '가.'(10pt)가 상위 '1.'(3pt)보다
 * 넓게 벌어지던 문제 — 을 규칙·쌍둥이·HWPX 실출력으로 막는다. kordoc 미리보기는
 * keepWithNext를 반영하지 않으므로 HWPX 속성 자체를 단정해야 한다.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import layoutTokens from '../scripts/layout-tokens.json' with { type: 'json' };
import { createRequire } from 'node:module';
import { indentPosition, isSentenceTitle, layoutBlocks, markerHang, noteStyle } from '../src/domain/itemLayout.js';
import { parseMarkdown } from '../src/domain/markdownParser.js';

import AdmZip from 'adm-zip';
import { compositionModel, pageDraftsFrom, withPagePlan } from '../src/domain/workflowModel.js';
import { agencyProfiles } from '../src/domain/agencyProfiles.js';

const require = createRequire(import.meta.url);
const { parseTextToPlanIR } = require('../electron/plan-ir.cjs');
const inputAdapters = require('../electron/input-adapters.cjs');
const { DOMParser } = require('@xmldom/xmldom');

// header.xml paraPr → 한글이 읽는 조판 속성
function paraDefinitions(headerXml) {
  const defs = {};
  for (const match of headerXml.matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<\/hh:paraPr>/g)) {
    const body = match[0];
    const value = (tag) => Number((new RegExp(`<hc:${tag} value="(-?\\d+)"`).exec(body) || [])[1] || 0);
    defs[match[1]] = {
      left: value('left'), intent: value('intent'), prev: value('prev'), next: value('next'),
      keep: /keepWithNext="1"/.test(body),
      lineSpacing: Number((/<hh:lineSpacing type="PERCENT" value="(\d+)"/.exec(body) || [])[1] || 0),
    };
  }
  return defs;
}

// section0.xml 최상위 문단(표 앵커 포함) — 텍스트는 직속 run의 hp:t만
function topParagraphs(sectionXml) {
  const root = new DOMParser().parseFromString(sectionXml, 'text/xml').documentElement;
  const children = (node, name) => Array.from(node.childNodes).filter((child) => child.nodeName === name);
  return children(root, 'hp:p').map((paragraph) => {
    const runs = children(paragraph, 'hp:run');
    const table = runs.map((run) => children(run, 'hp:tbl')[0]).find(Boolean);
    return {
      paraPr: paragraph.getAttribute('paraPrIDRef'),
      text: runs.flatMap((run) => children(run, 'hp:t')).map((node) => node.textContent).join(''),
      firstCell: table ? (table.getElementsByTagName('hp:t')[0]?.textContent || '') : null,
    };
  });
}

const ITEM = layoutTokens.itemLayout;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.env.ICE_PLAN_PYTHON || 'python';

function pythonLayout(blocks) {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ice-item-')).then(async (dir) => {
    const input = path.join(dir, 'blocks.json');
    await fs.writeFile(input, JSON.stringify(blocks), 'utf8');
    const result = spawnSync(PYTHON, [path.join(ROOT, 'scripts', 'item_layout.py'), input], { cwd: ROOT, encoding: 'utf8' });
    await fs.rm(dir, { recursive: true, force: true });
    if (result.status !== 0) throw new Error(`item_layout.py 실패: ${result.stderr || result.stdout}`);
    return JSON.parse(result.stdout);
  });
}

// R. 규칙 — 서술형 판별(길이 무관: 2026-08-14 판정), 내어쓰기 실측 폭, 단계·간격·연쇄
assert.equal(isSentenceTitle('폭염특보 체계 개편에 따른 야외활동 운영 기준 재정비 방안'), false, '명사로 끝나는 긴 제목은 제목');
assert.equal(isSentenceTitle('본원 프로그램의 야외 의존도(잠정 진단)'), false, '괄호로 끝나는 제목은 제목');
assert.equal(isSentenceTitle('폭염 상시화에 대응하여 온열질환을 예방함.'), true, '서술형(함.)은 항목');
assert.equal(isSentenceTitle('세부 설계는 붙임 3에 따름.'), true, '마침표로 끝나면 항목');
assert.equal(isSentenceTitle('비중이 높음 **'), true, '끝의 강조 기호·공백은 무시');
assert.deepEqual(
  ['1.', '가.', '□', '1)', '(1)', '①', '-'].map(markerHang),
  [1776, 2328, 1908, 1776, 2184, 1908, 1308],
  '내어쓰기 = 기호+공백 실측 폭(한글 PDF, 함초롬바탕 13pt)');
// 사용자 샘플(2026-09-27): 기호 시작 1.=0칸·가.=1칸·1)=3칸·가)=4칸·①=6칸·㉮=7칸(칸 = 반각 공백)
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(indentPosition), [0, 648, 1944, 2592, 3888, 4536, 5832, 6480],
  '단계별 기호 시작 위치 = 샘플 칸 수 × 공백 폭(648)');

const H = (level, text) => ({ type: 'heading', level, text });
const L = (level, marker, text) => ({ type: 'listItem', level, marker, ordered: !/^[-□○❍]$/.test(marker), text });
const sample = [
  H(2, 'Ⅰ. 목적'),
  H(3, '1. 폭염 상시화에 대응하여 체험 교육활동의 야외활동 운영 기준을 마련함.'),
  H(3, '2. 폭염 시 프로그램을 취소하지 아니하고 실내 전환으로 운영함.'),
  H(2, 'Ⅱ. 현황'),
  H(3, '1. 폭염특보 체계 개편에 따른 야외활동 운영 기준 재정비 방안'),
  H(4, '가. 운영상 시사점'),
  L(1, '1)', '폭염중대경보는 1일만 예상되어도 발효됨.'),
  L(1, '2)', '열대야주의보 신설에 따라 숙박형 야간 운영 기준이 필요함.'),
  H(4, '가. 그늘 확보가 어려운 개방 공간에서 운영되는 프로그램의 비중이 높음.'),
  { type: 'table', header: ['구분', '내용'], rows: [['가', '나']] },
  { type: 'paragraph', text: '본문 문장이다.' },
  H(3, '2. 연속 제목 검증'),
  H(3, '3. 첫째 짧은 제목'),
  H(3, '4. 둘째 짧은 제목'),
  H(3, '5. 셋째 짧은 제목'),
  L(0, '-', '연속 제목 뒤 본문 항목'),
  H(2, 'Ⅳ. 기대 효과'),
  L(0, '□', '폭염기 운영 중단 결정 지연 해소'),
  H(4, '① 학습장별 지정 지점에서 측정함.'),
  H(4, '㉮ 특보 발표값을 기준으로 함.'),
];
const brief = layoutBlocks(sample).map(({ role, level, prev, keep, lineSpacing }) => [role, level, prev, keep, lineSpacing]);
const P = ITEM.prevHwpUnit;
const LS = ITEM.lineSpacingPercent;
assert.deepEqual(brief, [
  ['frame', 0, P.chapter, true, null],
  ['item', 0, P.topItem, false, LS.item],
  ['item', 0, P.topItem, false, LS.item],
  ['frame', 0, P.chapter, true, null],
  ['heading1', 0, P.numberedHeading, true, LS.heading],
  ['heading2', 1, P.koreanSubheading, true, LS.heading],
  ['item', 2, P.nestedItem, false, LS.item],
  ['item', 2, P.nestedItem, false, LS.item],
  ['item', 1, P.nestedItem, false, LS.item],
  ['table', 0, 0, false, null],
  ['body', 0, 0, false, LS.item],
  ['heading1', 0, P.numberedHeading, true, LS.heading],
  ['heading1', 0, P.numberedHeading, true, LS.heading],
  ['heading1', 0, P.numberedHeading, true, LS.heading],
  ['heading1', 0, P.numberedHeading, false, LS.heading],
  ['item', 1, P.nestedItem, false, LS.item],
  ['frame', 0, P.chapter, true, null],
  ['item', 0, P.topItem, false, LS.item],
  ['item', 4, P.nestedItem, false, LS.item],
  ['item', 5, P.nestedItem, false, LS.item],
], '역할·단계·위 간격·다음 문단과 함께(연속 4번째 해제)·줄간격, 서술형 ①·㉮는 샘플 순서 4·5단계');
assert.ok(P.chapter > P.numberedHeading && P.numberedHeading > P.koreanSubheading
  && P.koreanSubheading > P.topItem && P.topItem > P.nestedItem, '간격 척도는 위계 순서로 줄어야 함(승인 권장안)');

// S. 빠른 미리보기 스타일: HWPX 문단 속성과 같은 값(첫 줄 = 단계×단계폭, 둘째 줄 = +내어쓰기)
const notes = layoutBlocks(sample);
assert.deepEqual(noteStyle(notes[6]), { margin: '0pt 0 0', lineHeight: 1.7, paddingLeft: '37.2pt', textIndent: '-17.76pt' }, '2단계 1) 항목 = 3칸 + 내어쓰기');
assert.deepEqual(noteStyle(notes[4]), { margin: '8pt 0 0', lineHeight: 1.6, paddingLeft: '17.76pt', textIndent: '-17.76pt' }, '짧은 번호 제목');
assert.deepEqual(noteStyle(notes[10]), { margin: '0pt 0 0', lineHeight: 1.7 }, '본문 문단은 들여쓰기 없이 간격 0');

// T. 쌍둥이: 같은 블록열에 대해 Python(item_layout.py)이 JS와 필드 단위로 같은 주석을 내야 한다
assert.deepEqual(await pythonLayout(sample), layoutBlocks(sample), 'itemLayout.js ↔ item_layout.py 주석 불일치');

// P. 파서(G-1): 전각 공백으로 들여쓴 1)·가)·① 줄이 한 문단으로 합쳐지지 않고 목록 항목이 된다.
// 들여쓰기 폭은 전각 공백 2·반각 1로 센다(전각 1개 = 2타).
const FIXTURE_MD = await fs.readFile(path.join(ROOT, 'test-data', 'item-layout', 'item-hierarchy.md'), 'utf8');
const procedure = (blocks) => {
  const start = blocks.findIndex((block) => String(block.text || '').includes('판단 절차'));
  return blocks.slice(start + 1, start + 16);
};
for (const [label, blocks] of [['plan-ir', parseTextToPlanIR(FIXTURE_MD, { format: 'md' }).blocks], ['markdownParser', parseMarkdown(FIXTURE_MD).blocks]]) {
  const items = procedure(blocks);
  assert.ok(items.every((block) => block.type === 'listItem'), `${label}: 판단 절차 15줄이 모두 목록 항목이어야 함`);
  assert.deepEqual(items.map((block) => block.marker), ['1)', '가)', '나)', '다)', '2)', '가)', '①', '②', '나)', '①', '②', '다)', '3)', '가)', '나)'], `${label}: 기호 보존`);
  assert.deepEqual(items.map((block) => block.level), [1, 2, 2, 2, 1, 2, 3, 3, 2, 3, 3, 2, 1, 2, 2], `${label}: 전각 들여쓰기 단계`);
  assert.ok(items.every((block) => block.ordered === true), `${label}: 순번 기호는 ordered`);
  assert.ok(blocks.some((block) => block.type === 'listItem' && block.marker === '□' && block.level === 0), `${label}: 최상위 □ 항목`);
}

// P-2. 이어지는 줄: 항목보다 깊게 들여쓴 줄만 그 항목에 합친다(붙임 5 안내문 — 4칸 들여쓴 이어지는 줄이
// 별도 문단으로 떨어지던 G-1 부작용). 들여쓰지 않은 줄(□ 제목 아래 본문)·같은 깊이 줄·코드 울타리는 합치지 않는다.
const CONTINUATION_MD = [
  '가. 폭염경보 이상 발효가 예상되는 경우, 운영 전일까지',
  '    실내 전환 여부를 안내드립니다.',
  '나. 배려가 필요한 학생은 인솔교사를 통해',
  '    알려 주시기 바랍니다. 전달된 정보는',
  '    종료 후 파기합니다.',
  '',
  '□ 추진 배경',
  '폭염 일수가 늘어 야외 체험활동의 안전 기준이 필요함.',
  '',
  '　1) 전각 들여쓴 항목',
  '　　이어지는 줄',
  '　같은 깊이의 줄',
  '',
  '```',
  '마. 폭염중대경보 발효 시에는 운영을 연기할 수 있으며,',
  '    이 경우 대체 일정을 안내드립니다.',
  '```',
].join('\n');
for (const [label, blocks] of [['plan-ir', parseTextToPlanIR(CONTINUATION_MD, { format: 'md' }).blocks], ['markdownParser', parseMarkdown(CONTINUATION_MD).blocks]]) {
  assert.deepEqual(blocks.map((block) => [block.type, block.marker || '', block.text]), [
    ['listItem', '가.', '폭염경보 이상 발효가 예상되는 경우, 운영 전일까지 실내 전환 여부를 안내드립니다.'],
    ['listItem', '나.', '배려가 필요한 학생은 인솔교사를 통해 알려 주시기 바랍니다. 전달된 정보는 종료 후 파기합니다.'],
    ['listItem', '□', '추진 배경'],
    ['paragraph', '', '폭염 일수가 늘어 야외 체험활동의 안전 기준이 필요함.'],
    ['listItem', '1)', '전각 들여쓴 항목 이어지는 줄'],
    ['paragraph', '', '같은 깊이의 줄'],
    ['paragraph', '', '```'],
    ['listItem', '마.', '폭염중대경보 발효 시에는 운영을 연기할 수 있으며, 이 경우 대체 일정을 안내드립니다.'],
    ['paragraph', '', '```'],
  ], `${label}: 깊게 들여쓴 줄만 앞 항목에 합침`);
}
assert.equal(parseTextToPlanIR(CONTINUATION_MD, { format: 'md' }).blocks[1].source.original,
  '나. 배려가 필요한 학생은 인솔교사를 통해\n    알려 주시기 바랍니다. 전달된 정보는\n    종료 후 파기합니다.',
  'plan-ir: 합친 줄의 원문도 source에 남김(원문 대조 게이트 전제)');

// H. HWPX 실출력: 앱 흐름으로 fixture를 내보내 문단마다 paraPr이 주석대로인지 단정한다
const agency = agencyProfiles['direct-student'];
const loaded = await inputAdapters.loadPlanInput(path.join(ROOT, 'test-data', 'item-layout', 'item-hierarchy.md'));
const planned = withPagePlan(loaded, pageDraftsFrom(loaded, agency));
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-item-hwpx-'));
const modelPath = path.join(work, 'model.json');
const hwpxPath = path.join(work, 'out.hwpx');
await fs.writeFile(modelPath, JSON.stringify(compositionModel(planned, agency)), 'utf8');
const built = spawnSync(PYTHON, [path.join(ROOT, 'scripts', 'model_to_hwpx.py'), modelPath, hwpxPath, '--template', 'boncheong'], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) throw new Error(`model_to_hwpx 실패: ${built.stderr || built.stdout}`);
const archive = new AdmZip(hwpxPath);
const headerXml = archive.readAsText('Contents/header.xml');
// 한글은 paraPrIDRef·charPrIDRef를 id 값이 아니라 목록 위치로 찾는다(2026-09-27 한글 PDF 실측: 239·242를
// 빼고 동적 속성을 250부터 매기자 이후 참조가 모두 엉뚱한 속성을 가리켜 들여쓰기·표 정렬이 깨졌다).
// kordoc·id 기반 검사는 이를 못 잡으므로 id가 0부터 빈칸 없이 위치와 같은지 직접 단정한다.
const sectionXml = archive.readAsText('Contents/section0.xml');
for (const [group, tag] of [['paraProperties', 'paraPr'], ['charProperties', 'charPr']]) {
  const block = new RegExp(`<hh:${group} itemCnt="(\\d+)"[^>]*>([\\s\\S]*?)</hh:${group}>`).exec(headerXml);
  const ids = [...block[2].matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, 'g'))].map((match) => Number(match[1]));
  assert.deepEqual(ids, ids.map((_value, index) => index), `${tag} id가 목록 위치와 다름 — 한글이 엉뚱한 속성으로 조판함`);
  assert.equal(Number(block[1]), ids.length, `${group} itemCnt가 실제 개수와 다름`);
  // 목록 끝을 넘는 참조는 한글이 무엇으로 조판할지 알 수 없다(옛 출력: 256~259 참조, 정의는 255까지)
  const refs = [...sectionXml.matchAll(new RegExp(`${tag}IDRef="(\\d+)"`, 'g'))].map((match) => Number(match[1]));
  assert.ok(refs.every((ref) => ref < ids.length), `${tag}IDRef가 정의 개수(${ids.length})를 넘음: ${Math.max(...refs)}`);
}
const defs = paraDefinitions(headerXml);
const paragraphs = topParagraphs(sectionXml);
await fs.rm(work, { recursive: true, force: true });

let checked = 0;
for (const page of planned.metadata.pages.filter((item) => ['body', 'body-opening', 'body-continuation'].includes(item.type))) {
  layoutBlocks(page.blocks || []).forEach((note, index) => {
    const block = page.blocks[index];
    if (!['item', 'heading1', 'heading2', 'body'].includes(note.role)) return;
    const expectedText = note.role === 'item' ? `${note.marker} ${note.text}` : String(block.text);
    const paragraph = paragraphs.find((candidate) => candidate.text === expectedText);
    assert.ok(paragraph, `HWPX에 문단이 없음: ${expectedText}`);
    const def = defs[paragraph.paraPr];
    const label = `${note.role} "${expectedText.slice(0, 20)}" (paraPr ${paragraph.paraPr})`;
    assert.equal(def.lineSpacing, note.lineSpacing, `${label} 줄간격`);
    assert.equal(def.prev, note.prev, `${label} 문단 위 간격`);
    assert.equal(def.keep, note.keep, `${label} 다음 문단과 함께`);
    if (note.role !== 'body') {
      assert.equal(def.left, indentPosition(note.level), `${label} 왼여백 = 샘플 칸 위치`);
      assert.equal(def.intent, -note.hang, `${label} 내어쓰기 = 기호+공백 폭`);
    }
    checked += 1;
  });
}
const chapterAnchors = paragraphs.filter((paragraph) => /^[ⅠⅡⅢⅣ]$/.test(paragraph.firstCell || ''));
assert.equal(chapterAnchors.length, 4, '장 제목틀 4개');
assert.ok(chapterAnchors.every((paragraph) => defs[paragraph.paraPr].prev === ITEM.prevHwpUnit.chapter && defs[paragraph.paraPr].keep), '장 제목틀 앞 간격·다음 문단과 함께');
let run = 0;
let longest = 0;
for (const paragraph of paragraphs) {
  run = defs[paragraph.paraPr]?.keep ? run + 1 : 0;
  longest = Math.max(longest, run);
}
assert.ok(longest <= ITEM.maxKeepWithNextChain, `다음 문단과 함께 연속 ${longest}문단 — 상한 ${ITEM.maxKeepWithNextChain}`);

console.log(JSON.stringify({ gate: 'item-layout', sections: ['R', 'S', 'T', 'P', 'H'], checkedParagraphs: checked, longestKeepChain: longest, passed: true }, null, 2));
