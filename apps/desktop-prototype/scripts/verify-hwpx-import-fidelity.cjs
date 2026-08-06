#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { renderHwpxToSvg } = require('kordoc');
const { loadPlanInput } = require('../electron/input-adapters.cjs');
const { stripReviewAnnotations } = require('../electron/hwpx-layout.cjs');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const sourcePath = process.argv[2];
  requireCondition(sourcePath && path.extname(sourcePath).toLowerCase() === '.hwpx', '검증할 HWPX 경로가 필요합니다.');
  const model = await loadPlanInput(sourcePath);
  const sanitized = stripReviewAnnotations(fs.readFileSync(sourcePath));
  const rendered = await renderHwpxToSvg(sanitized.buffer, { reflow: true, reflowMode: 'keep' });
  const headings = model.blocks.filter((block) => block.type === 'heading');
  const tables = model.blocks.filter((block) => block.type === 'table');
  requireCondition(model.source?.format === 'hwpx', 'HWPX source provenance is missing.');
  requireCondition(model.metadata?.sourceLayout?.physicalPageCount === rendered.pageCount, 'Physical page count metadata differs from the source render.');
  requireCondition(headings.length > 0, 'No imported headings were normalized.');
  requireCondition(model.metadata?.sourceLayout?.reviewNoteCount === sanitized.count, 'Review-note removal count was not preserved.');
  requireCondition(!model.blocks.some((block) => String(block.text || '').trim() === '---'), 'A --- delimiter remains in the imported content.');
  requireCondition(
    model.blocks.some((block) => (
      String(block.text || '').includes('추진 배경')
      || (block.header || []).some((cell) => String(cell).includes('추진 배경'))
    )),
    'Policy body content was removed with reviewer notes.',
  );
  requireCondition(tables.every((block) => block.layout?.table), 'At least one imported table lost its layout metadata.');
  requireCondition(tables.every((block) => block.layout.table.headerStyle && block.layout.table.bodyStyle), 'At least one table lost header/body typography metadata.');
  console.log(JSON.stringify({
    gate: 'hwpx-import-fidelity',
    passed: true,
    file: path.basename(sourcePath),
    physicalPageCount: rendered.pageCount,
    hardPageCount: model.metadata.sourceLayout.hardPageCount,
    blocks: model.blocks.length,
    reviewNoteCount: sanitized.count,
    headings: headings.length,
    headingKinds: Object.fromEntries(
      [...new Set(headings.map((block) => block.headingKind))]
        .map((kind) => [kind, headings.filter((block) => block.headingKind === kind).length]),
    ),
    tables: tables.length,
    tablesWithLayout: tables.filter((block) => block.layout?.table).length,
    warnings: rendered.warnings || [],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
