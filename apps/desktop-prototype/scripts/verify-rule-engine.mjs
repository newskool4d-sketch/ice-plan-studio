#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules, isBulkApplicable, BULLET_PALETTES } from '../src/domain/ruleEngine.js';

const model = {
  schemaVersion: '0.2',
  kind: 'plan-ir',
  metadata: { title: '규칙 엔진 검증 계획' },
  approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: '규칙 엔진 검증 계획' },
    { type: 'heading', level: 2, text: '추진 내용' },
    { type: 'paragraph', text: '"교육기본법" 시행 기간은 2026-3-5 ~ 2026/3/7이며 오전 9시부터 10:5까지, 예산 10000 원을 사용한다.' },
    { type: 'listItem', level: 0, marker: '*', text: '필요시 적절히 추진한다.' },
  ],
};

const original = JSON.stringify(model);
const findings = inspectDocumentRules(model);
assert.equal(JSON.stringify(model), original, 'inspection must not mutate the input model');
for (const code of ['DATE-FORMAT', 'TIME-FORMAT', 'MONEY-FORMAT', 'TITLE-MARK', 'TILDE-FORMAT', 'LIST-MARKER', 'AMBIGUOUS-001']) {
  assert.ok(findings.some((item) => item.code === code), `missing rule finding: ${code}`);
}
assert.ok(!findings.some((item) => item.code === 'END-001'), 'plan documents must not require an end marker');

const dateFinding = findings.find((item) => item.code === 'DATE-FORMAT');
const single = applyRuleSuggestion(model, dateFinding);
assert.equal(JSON.stringify(model), original, 'single approval must not mutate the source model');
assert.notEqual(single.model.blocks[2].text, model.blocks[2].text, 'approved suggestion must change the cloned model');
assert.equal(single.model.approval.edits.length, 1, 'approved edit must be recorded');

const all = applyAllRuleSuggestions(model);
assert.equal(JSON.stringify(model), original, 'apply-all must not mutate the source model');
assert.equal(inspectDocumentRules(all.model).filter(isBulkApplicable).length, 0, 'bulk suggestions must be resolved');
// 시간 표기는 '전체 적용'에서 제외(V4 I-3) — 개별 승인으로만 바뀐다.
const pendingTime = inspectDocumentRules(all.model).find((item) => item.code === 'TIME-FORMAT');
assert.ok(pendingTime && pendingTime.bulkApply === false, 'TIME-FORMAT must stay for individual approval');
const timed = applyRuleSuggestion(all.model, pendingTime).model;
assert.match(all.model.blocks[2].text, /「교육기본법」/);
assert.match(all.model.blocks[2].text, /2026\. 3\. 5\.~2026\. 3\. 7\./);
assert.match(timed.blocks[2].text, /09:00/);
assert.match(timed.blocks[2].text, /10:05/);
assert.match(all.model.blocks[2].text, /10,000원/);
assert.equal(all.model.blocks[3].marker, '□');
assert.equal(all.model.approval.edits.length, all.edits.length);
assert.ok(inspectDocumentRules(all.model).some((item) => item.code === 'AMBIGUOUS-001' && item.kind === 'warning'), 'warning-only finding must remain');

// 공문서의 순번 목록은 불릿 팔레트의 자동 치환 대상이 아니며,
// 원문 순번(1., 2. 등)을 보존해야 한다.
const orderedModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, ordered: true, marker: '1.', text: '첫 번째 절차' },
    { type: 'listItem', level: 0, ordered: true, marker: '2.', text: '두 번째 절차' },
  ],
};
const orderedOriginal = JSON.stringify(orderedModel);
const orderedApplied = applyAllRuleSuggestions(orderedModel);
assert.equal(JSON.stringify(orderedModel), orderedOriginal, '순번 목록 적용도 원문을 변경하지 않아야 함');
assert.deepEqual(
  orderedApplied.model.blocks.filter((block) => block.type === 'listItem').map((block) => block.marker),
  ['1.', '2.'],
  '순번 목록은 불릿 기호로 자동 치환하지 않고 원문 순번을 보존해야 함',
);
assert.ok(
  !orderedApplied.edits.some((edit) => edit.code === 'LIST-MARKER'),
  '순번 목록에는 LIST-MARKER 자동 수정이 없어야 함',
);

// 한글 항목(가.) 아래 절차 목록은 공문서 하위 순번인 1) 형식으로 통일한다.
// 일반 장의 순번 1.은 의미를 보존하고 자동 치환하지 않는다.
const koreanChildModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 2, text: '가. 마리관 경유형' },
    { type: 'listItem', level: 0, ordered: true, marker: '1.', text: '첫 번째 절차' },
    { type: 'listItem', level: 0, ordered: true, marker: '2.', text: '두 번째 절차' },
    { type: 'heading', level: 2, text: '나. 학습장 완결형' },
    { type: 'listItem', level: 0, ordered: true, marker: '1)', text: '이미 정격인 절차' },
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, ordered: true, marker: '1.', text: '일반 장 절차' },
  ],
};
const koreanChildApplied = applyAllRuleSuggestions(koreanChildModel);
assert.deepEqual(
  koreanChildApplied.model.blocks.filter((block) => block.type === 'listItem').map((block) => block.marker),
  ['1)', '2)', '1)', '1.'],
  '가·나 항목 아래 순번은 1)로, 일반 장 순번은 1.로 보존해야 함',
);
assert.equal(
  koreanChildApplied.edits.filter((edit) => edit.code === 'ORDERED-MARKER').length,
  2,
  '가·나 항목 아래 1. 순번 두 건이 ORDERED-MARKER로 기록돼야 함',
);
assert.ok(
  !koreanChildApplied.edits.some((edit) => edit.code === 'LIST-MARKER'),
  '순번 목록은 1) 변환과 별개로 불릿 팔레트 치환을 만들지 않아야 함',
);

const implicitMarkerModel = {
  ...model,
  approval: { status: 'unapproved' },
  blocks: model.blocks.map((block, index) => index === 3 ? { type: 'listItem', level: 0, text: '암시적 기본 기호 목록' } : structuredClone(block)),
};
const implicitMarkerFinding = inspectDocumentRules(implicitMarkerModel).find((item) => item.code === 'LIST-MARKER');
assert.equal(implicitMarkerFinding.before, '-', 'missing marker must be presented as the markdown default marker');
const implicitMarkerApplied = applyRuleSuggestion(implicitMarkerModel, implicitMarkerFinding);
assert.equal(implicitMarkerApplied.model.blocks[3].marker, '□', 'implicit marker suggestion must pass the source guard');

// ── 8단계: 관용 장(근거·목적·방침·배경) 하위 최상위 목록 ○ 제안 ──────────
const conventionModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅰ. 추진 근거' },
    { type: 'listItem', level: 0, marker: '□', text: '근거 항목' },
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '□', text: '내용 항목' },
  ],
};
const conventionFindings = inspectDocumentRules(conventionModel);
const conventionSuggestion = conventionFindings.find((item) => item.code === 'LIST-MARKER' && item.target?.blockIndex === 1);
assert.ok(conventionSuggestion, '관용 장(근거) 하위 □ 항목은 ○ 제안이 있어야 함');
assert.equal(conventionSuggestion.after, '○', '관용 장 최상위 목록 기대 기호는 ○');
// 비관용 장(추진 내용)의 □는 팔레트 0단계(□)와 일치하므로 제안이 없어야 한다(공허성 배제).
assert.ok(!conventionFindings.some((item) => item.code === 'LIST-MARKER' && item.target?.blockIndex === 3),
  '비관용 장의 □ 항목에는 ○ 제안이 없어야 함');

// ── 8단계: 위계 건너뜀(LIST-HIERARCHY) 검출 ───────────────────────────────
const hierModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '□', text: 'a' },
    { type: 'listItem', level: 2, marker: '·', text: 'b(건너뜀)' },
  ],
};
const hierFinding = inspectDocumentRules(hierModel).find((item) => item.code === 'LIST-HIERARCHY');
assert.ok(hierFinding, '0→2 위계 건너뜀은 LIST-HIERARCHY로 검출돼야 함');
assert.equal(hierFinding.after, 1, '건너뜀 항목은 직전+1 단계로 제안');
// 정상 위계(0→1→2)는 검출되지 않아야 한다(공허성 배제).
const normalHier = {
  ...hierModel,
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '□', text: 'a' },
    { type: 'listItem', level: 1, marker: '❍', text: 'b' },
    { type: 'listItem', level: 2, marker: '-', text: 'c' },
  ],
};
assert.ok(!inspectDocumentRules(normalHier).some((item) => item.code === 'LIST-HIERARCHY'),
  '정상 위계(0→1→2)에는 LIST-HIERARCHY가 없어야 함');

// ── 8단계: 불릿 팔레트가 LIST-MARKER 제안 계열을 바꾸는지 ─────────────────
assert.ok(BULLET_PALETTES.length >= 2, '팔레트는 최소 2종 이상이어야 함');
assert.ok(BULLET_PALETTES.every((palette) => Array.isArray(palette.markers) && palette.markers.length === 8),
  '모든 팔레트는 8단계 마커 배열이어야 함');
const diamond = BULLET_PALETTES.find((palette) => palette.id === 'diamond-d');
assert.ok(diamond, 'diamond-d 팔레트가 있어야 함');
const paletteModel = {
  schemaVersion: '0.2', kind: 'plan-ir',
  metadata: { rules: { itemMarkers: [...diamond.markers] } },
  approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅳ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '□', text: 'a' },
  ],
};
const paletteSuggestion = inspectDocumentRules(paletteModel).find((item) => item.code === 'LIST-MARKER' && item.target?.blockIndex === 1);
assert.ok(paletteSuggestion, '팔레트 적용 시 계열 불일치 항목에 LIST-MARKER 제안이 있어야 함');
assert.equal(paletteSuggestion.after, diamond.markers[0], '팔레트의 0단계 기호가 기대 마커가 돼야 함');
// 기본 팔레트에서는 □(기본 0단계)에 제안이 없어야 한다(공허성 배제).
const defaultPaletteModel = { ...paletteModel, metadata: {} };
assert.ok(!inspectDocumentRules(defaultPaletteModel).some((item) => item.code === 'LIST-MARKER' && item.target?.blockIndex === 1),
  '기본 팔레트에서 □ level0 항목에는 제안이 없어야 함');

// ── 공문서 규칙: 유사 불릿 혼용은 비파괴 경고로만 검출 ────────────────────
const mixedMarkerModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅰ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '○', text: '첫 번째 항목' },
    { type: 'listItem', level: 0, marker: '❍', text: '두 번째 항목' },
  ],
};
const mixedMarkerOriginal = JSON.stringify(mixedMarkerModel);
const mixedMarkerFinding = inspectDocumentRules(mixedMarkerModel).find((item) => item.code === 'MIXED-BULLET-MARKER');
assert.ok(mixedMarkerFinding, '같은 단계의 ○·❍ 혼용을 검출해야 함');
assert.equal(mixedMarkerFinding.kind, 'warning', '불릿 혼용은 자동 치환 제안이 아닌 경고여야 함');
assert.equal(mixedMarkerFinding.action, 'warning', '불릿 혼용 경고는 replace 동작을 제공하지 않아야 함');
assert.match(mixedMarkerFinding.message, /자동 수정하지 않습니다/);
assert.throws(() => applyRuleSuggestion(mixedMarkerModel, mixedMarkerFinding), /적용 가능한 규칙 제안이 아닙니다/);
assert.ok(!inspectDocumentRules(mixedMarkerModel).some((item) =>
  item.kind === 'suggestion' && item.code === 'LIST-MARKER' && [1, 2].includes(item.target?.blockIndex)),
  '혼용 검토 대상 ○·❍는 일괄 적용 가능한 LIST-MARKER 제안으로 바꾸지 않아야 함');
const mixedMarkerApplied = applyAllRuleSuggestions(mixedMarkerModel);
assert.equal(mixedMarkerApplied.model.blocks[1].marker, '○', '혼용 검토 대상 ○는 일괄 적용 후에도 보존돼야 함');
assert.equal(mixedMarkerApplied.model.blocks[2].marker, '❍', '혼용 검토 대상 ❍는 일괄 적용 후에도 보존돼야 함');
assert.equal(JSON.stringify(mixedMarkerModel), mixedMarkerOriginal, '불릿 혼용 검사는 원문을 변경하지 않아야 함');

const hierarchicalCircleModel = {
  ...mixedMarkerModel,
  blocks: [
    { type: 'heading', level: 1, text: 'Ⅰ. 추진 내용' },
    { type: 'listItem', level: 0, marker: '○', text: '상위 항목' },
    { type: 'listItem', level: 1, marker: '❍', text: '하위 항목' },
  ],
};
assert.ok(!inspectDocumentRules(hierarchicalCircleModel).some((item) => item.code === 'MIXED-BULLET-MARKER'),
  '서로 다른 단계의 ○·❍ 사용은 혼용으로 오인하지 않아야 함');

// ── 공문서 규칙: 초안·타 계획안 잔존 문구는 비파괴 경고로만 검출 ─────────
const residualPhraseModel = {
  schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' },
  blocks: [
    { type: 'heading', level: 1, text: '체험교육 프로그램 고도화 추진 계획(안)' },
    { type: 'paragraph', text: '내용 입력 대기' },
    { type: 'paragraph', text: '인천을 품고 세계로 나아가는 글로벌 인재 양성' },
  ],
};
const residualOriginal = JSON.stringify(residualPhraseModel);
const residualFindings = inspectDocumentRules(residualPhraseModel);
for (const code of ['PLACEHOLDER-RESIDUAL', 'WRONG-TEMPLATE-PHRASE']) {
  const residualFinding = residualFindings.find((item) => item.code === code);
  assert.ok(residualFinding, `잔존 문구 경고가 필요함: ${code}`);
  assert.equal(residualFinding.kind, 'warning', `${code}는 자동 치환 제안이 아니어야 함`);
  assert.equal(residualFinding.action, 'warning', `${code}는 replace 동작을 제공하지 않아야 함`);
  assert.equal(residualFinding.after, null, `${code}에 자동 대체문을 생성하지 않아야 함`);
}
const residualApplied = applyAllRuleSuggestions(residualPhraseModel);
assert.equal(residualApplied.model.blocks[1].text, '내용 입력 대기', '입력 대기 문구는 자동 삭제하지 않아야 함');
assert.equal(residualApplied.model.blocks[2].text, '인천을 품고 세계로 나아가는 글로벌 인재 양성', '타 계획안 문구는 자동 삭제하지 않아야 함');
assert.ok(inspectDocumentRules(residualApplied.model).some((item) => item.code === 'PLACEHOLDER-RESIDUAL'),
  '자동 제안 일괄 적용 후에도 잔존 문구 경고가 유지돼야 함');
assert.equal(JSON.stringify(residualPhraseModel), residualOriginal, '잔존 문구 검사는 원문을 변경하지 않아야 함');

// ── 페이지 기반 실사용 모델도 같은 규칙 계약을 적용 ───────────────────────
const stage6Model = JSON.parse(readFileSync(
  new URL('../test-data/body-layout-v2/worldschool-stage6.model.json', import.meta.url),
  'utf8',
));
assert.equal(stage6Model.blocks.length, 0, '실물 fixture는 페이지 기반 모델이어야 함');
assert.match(stage6Model.metadata.cover.direction, /글로벌 인재 양성/);
assert.ok(inspectDocumentRules(stage6Model).some((item) => item.code === 'WRONG-TEMPLATE-PHRASE'),
  '페이지 기반 모델의 표지에 남은 타 계획안 문구를 검출해야 함');

const pageBasedModel = {
  schemaVersion: '0.2',
  kind: 'plan-ir',
  metadata: {
    cover: { title: '체험교육 프로그램 고도화 추진 계획(안)', direction: '' },
    pages: [
      {
        type: 'body-opening',
        blocks: [
          { type: 'heading', level: 1, text: 'Ⅰ. 추진 내용' },
          { type: 'listItem', level: 0, marker: '○', text: '첫 번째 항목' },
          { type: 'paragraph', text: '시행일은 2026-3-7이다.' },
        ],
      },
      {
        type: 'body-continuation',
        blocks: [
          { type: 'listItem', level: 0, marker: '❍', text: '두 번째 항목' },
          { type: 'paragraph', text: '내용 입력 대기' },
        ],
      },
    ],
  },
  approval: { status: 'unapproved' },
  blocks: [],
};
const pageBasedOriginal = JSON.stringify(pageBasedModel);
const pageBasedFindings = inspectDocumentRules(pageBasedModel);
assert.ok(pageBasedFindings.some((item) => item.code === 'MIXED-BULLET-MARKER'),
  '페이지 경계를 넘은 ○·❍ 혼용을 검출해야 함');
assert.ok(pageBasedFindings.some((item) => item.code === 'PLACEHOLDER-RESIDUAL'),
  '페이지 블록의 입력 대기 문구를 검출해야 함');
const pageDateFinding = pageBasedFindings.find((item) => item.code === 'DATE-FORMAT');
assert.equal(pageDateFinding.target.kind, 'pageBlockField', '페이지 블록 제안은 페이지 소유권을 포함해야 함');
const pageDateApplied = applyRuleSuggestion(pageBasedModel, pageDateFinding);
assert.match(pageDateApplied.model.metadata.pages[0].blocks[2].text, /2026\. 3\. 7\./);
assert.equal(JSON.stringify(pageBasedModel), pageBasedOriginal, '페이지 기반 규칙 적용도 원문을 변경하지 않아야 함');
const pageAppliedAll = applyAllRuleSuggestions(pageBasedModel);
assert.equal(pageAppliedAll.model.metadata.pages[0].blocks[1].marker, '○');
assert.equal(pageAppliedAll.model.metadata.pages[1].blocks[0].marker, '❍');
const hybridModel = {
  ...pageBasedModel,
  blocks: [{ type: 'heading', level: 1, text: '보존용 원본 정본' }],
};
assert.ok(inspectDocumentRules(hybridModel).some((item) => item.code === 'PLACEHOLDER-RESIDUAL'),
  '페이지 계획이 있으면 출력 정본인 metadata.pages를 우선 검사해야 함');
const emptyPlannedPages = {
  ...residualPhraseModel,
  metadata: {
    pages: [
      { type: 'cover', blocks: [] },
      { type: 'toc', blocks: [] },
    ],
  },
};
assert.ok(!inspectDocumentRules(emptyPlannedPages).some((item) => item.code === 'PLACEHOLDER-RESIDUAL'),
  '빈 페이지 틀만 출력하는 모델에서 보존용 root blocks를 다시 검사하지 않아야 함');

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

// DATE-FORMAT이 날짜 뒤 공백을 먹어 다음 단어와 붙이면 안 된다('2026-9-8 시작'→'2026. 9. 8.시작' 결함, 2026-09-27 확인).
const dateSpacingModel = { schemaVersion: '0.2', kind: 'plan-ir', metadata: {}, approval: { status: 'unapproved' }, blocks: [{ type: 'paragraph', text: '2026-9-8 시작' }] };
assert.equal(inspectDocumentRules(dateSpacingModel).find((item) => item.code === 'DATE-FORMAT')?.after, '2026. 9. 8. 시작', 'DATE-FORMAT이 뒤 공백을 지우면 안 됨');

// V4 I-3: 영 제7조⑤는 시각 표기 규정 — 기간·일반어·비율은 바꾸지 않고, 범위는 통째로.
const timeCases = [
  ['2시간 이상 연속 배치 지양', null],
  ['24시간 운영', null],
  ['3~4시간 소요', null],
  ['3시기 편성', null],
  ['1:1 상담 운영', null],
  ['2026-9-8 시작', null],
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

console.log(JSON.stringify({
  gate: 'rule-engine-approval',
  detectedCodes: [...new Set(findings.map((item) => item.code))],
  paletteCount: BULLET_PALETTES.length,
  paletteMarker: paletteSuggestion.after,
  suggestionCount: findings.filter((item) => item.kind === 'suggestion').length,
  appliedCount: all.edits.length,
  sourceUnchanged: JSON.stringify(model) === original,
  remainingSuggestions: inspectDocumentRules(all.model).filter(isBulkApplicable).length,
  conventionMarker: conventionSuggestion.after,
  hierarchySkipDetected: hierFinding.after,
  mixedMarkerWarning: mixedMarkerFinding.kind,
  residualWarningCodes: residualFindings
    .filter((item) => ['PLACEHOLDER-RESIDUAL', 'WRONG-TEMPLATE-PHRASE'].includes(item.code))
    .map((item) => item.code),
  pageBasedRuleCoverage: true,
  plannedPagePriority: true,
  passed: true,
}, null, 2));
