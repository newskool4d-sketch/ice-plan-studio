#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules } from '../src/domain/ruleEngine.js';

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
assert.equal(inspectDocumentRules(all.model).filter((item) => item.kind === 'suggestion').length, 0, 'all suggestions must be resolved');
assert.match(all.model.blocks[2].text, /「교육기본법」/);
assert.match(all.model.blocks[2].text, /2026\. 3\. 5\.~2026\. 3\. 7\./);
assert.match(all.model.blocks[2].text, /09:00/);
assert.match(all.model.blocks[2].text, /10:05/);
assert.match(all.model.blocks[2].text, /10,000원/);
assert.equal(all.model.blocks[3].marker, '□');
assert.equal(all.model.approval.edits.length, all.edits.length);
assert.ok(inspectDocumentRules(all.model).some((item) => item.code === 'AMBIGUOUS-001' && item.kind === 'warning'), 'warning-only finding must remain');

const implicitMarkerModel = {
  ...model,
  approval: { status: 'unapproved' },
  blocks: model.blocks.map((block, index) => index === 3 ? { type: 'listItem', level: 0, text: '암시적 기본 기호 목록' } : structuredClone(block)),
};
const implicitMarkerFinding = inspectDocumentRules(implicitMarkerModel).find((item) => item.code === 'LIST-MARKER');
assert.equal(implicitMarkerFinding.before, '-', 'missing marker must be presented as the markdown default marker');
const implicitMarkerApplied = applyRuleSuggestion(implicitMarkerModel, implicitMarkerFinding);
assert.equal(implicitMarkerApplied.model.blocks[3].marker, '□', 'implicit marker suggestion must pass the source guard');

console.log(JSON.stringify({
  gate: 'rule-engine-approval',
  detectedCodes: [...new Set(findings.map((item) => item.code))],
  suggestionCount: findings.filter((item) => item.kind === 'suggestion').length,
  appliedCount: all.edits.length,
  sourceUnchanged: JSON.stringify(model) === original,
  remainingSuggestions: inspectDocumentRules(all.model).filter((item) => item.kind === 'suggestion').length,
  passed: true,
}, null, 2));
