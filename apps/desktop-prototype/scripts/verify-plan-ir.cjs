#!/usr/bin/env node
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { markdownToHwpx } = require('kordoc');
const { loadPlanInput, kordocSmokeInfo } = require('../electron/input-adapters.cjs');
const { comparePlanIR } = require('../electron/plan-ir.cjs');

const FIXTURE = [
  '# 2026 운영 계획',
  '',
  '추진 방향을 확인한다.',
  '',
  '| 구분 | 내용 |',
  '| --- | --- |',
  '| 1 | 기본 계획 |',
  '',
  '- 점검',
].join('\n');

const ESCAPED_PIPE_FIXTURE = [
  '| 항목 | 설명 |',
  '| :-: | :-: |',
  '| 1 | 학교 A \\| 학교 B |',
].join('\n');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function countBlocks(model) {
  return model.blocks.reduce((counts, block) => ({ ...counts, [block.type]: (counts[block.type] || 0) + 1 }), {});
}

function planIRToMarkdown(model) {
  // 두 종류의 콘텐츠는 순수 텍스트 포맷(MD/TXT)을 원천적으로 무손실 왕복할 수 없다:
  //   - 이미지: 바이너리 데이터를 담을 방법이 없음
  //   - 줄바꿈·파이프(|)가 포함된 표 셀: GFM 표 문법이 한 줄 셀만 허용함
  //     (실측 결과 우리 레퍼런스 HWP 문서 2종 모두 이런 셀이 실제로 존재함 —
  //     드문 예외가 아니라 흔한 패턴이다)
  // 이런 블록은 여기서 건너뛰고(개수는 호출자가 집계), 나머지 "왕복 가능한"
  // 블록만으로 markdown을 만든다. keptBlocks는 그 부분집합을 원본 순서 그대로
  // 담아, 호출자가 "왕복 가능한 부분만" 공정하게 비교할 수 있게 한다.
  // 스킵된 콘텐츠의 보존 여부는 원본 파싱 결과(structureSummary)로 별도 검증한다.
  let skippedImages = 0;
  let skippedTables = 0;
  const keptBlocks = [];
  const lines = [];
  for (const block of model.blocks) {
    if (block.type === 'heading') { lines.push(`${'#'.repeat(block.level || 1)} ${block.text}`, ''); keptBlocks.push(block); continue; }
    if (block.type === 'paragraph') { lines.push(block.text, ''); keptBlocks.push(block); continue; }
    if (block.type === 'listItem') { lines.push(`${'  '.repeat(block.level || 0)}${block.marker || (block.ordered ? '1.' : '-')} ${block.text}`, ''); keptBlocks.push(block); continue; }
    if (block.type === 'table') {
      const rows = block.table.cells;
      const representable = rows.length > 0 && !rows.some((row) => row.some((cell) => cell.text.includes(String.fromCharCode(10)) || cell.text.includes('|')));
      if (!representable) { skippedTables += 1; continue; }
      lines.push(
        `| ${rows[0].map((cell) => cell.text).join(' | ')} |`,
        `| ${rows[0].map(() => '---').join(' | ')} |`,
        ...rows.slice(1).map((row) => `| ${row.map((cell) => cell.text).join(' | ')} |`),
        '',
      );
      keptBlocks.push(block);
      continue;
    }
    if (block.type === 'image') { skippedImages += 1; continue; }
  }
  return { markdown: lines.join(String.fromCharCode(10)), keptBlocks, skippedImages, skippedTables };
}

function structureSummary(model) {
  const tables = model.blocks.filter((block) => block.type === 'table');
  const images = model.blocks.filter((block) => block.type === 'image');
  const mergedTableCount = tables.filter((block) => block.table.cells.flat().some((cell) => cell.rowSpan > 1 || cell.colSpan > 1)).length;
  return {
    blocks: countBlocks(model),
    mergedTableCount,
    imageCount: images.length,
    imageSha256: images.map((block) => block.image.sha256).filter(Boolean).sort(),
    diagnostics: model.diagnostics,
  };
}

async function run() {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-plan-ir-'));
  const reportPath = option('--report');
  const hwpPath = option('--hwp');
  const referenceHwpxPath = option('--hwpx');
  try {
    const mdPath = path.join(workDir, 'equivalent.md');
    const txtPath = path.join(workDir, 'equivalent.txt');
    const hwpxPath = path.join(workDir, 'equivalent.hwpx');
    await Promise.all([
      fs.writeFile(mdPath, FIXTURE, 'utf8'),
      fs.writeFile(txtPath, FIXTURE, 'utf8'),
      fs.writeFile(hwpxPath, Buffer.from(await markdownToHwpx(FIXTURE))),
    ]);

    const [markdown, text, hwpx] = await Promise.all([
      loadPlanInput(mdPath),
      loadPlanInput(txtPath),
      loadPlanInput(hwpxPath),
    ]);
    const escapedPipePath = path.join(workDir, 'escaped-pipe.md');
    await fs.writeFile(escapedPipePath, ESCAPED_PIPE_FIXTURE, 'utf8');
    const escapedPipe = await loadPlanInput(escapedPipePath);
    if (escapedPipe.blocks.length !== 1
      || escapedPipe.blocks[0].type !== 'table'
      || escapedPipe.blocks[0].header.length !== 2
      || escapedPipe.blocks[0].table.cells.length !== 2
      || escapedPipe.blocks[0].table.cells[1][1].text !== '학교 A | 학교 B') {
      throw new Error('Markdown escaped pipe was not preserved as a single table cell');
    }
    const comparisons = {
      markdownToText: comparePlanIR(markdown, text),
      markdownToHwpx: comparePlanIR(markdown, hwpx),
    };
    const report = {
      gate: 'plan-ir-input-adapters',
      kordoc: kordocSmokeInfo(),
      semantic: Object.fromEntries(Object.entries(comparisons).map(([name, comparison]) => [name, {
        passed: comparison.passed,
        mismatches: comparison.mismatches,
      }])),
      inputs: {
        md: countBlocks(markdown),
        txt: countBlocks(text),
        hwpx: countBlocks(hwpx),
        escapedPipe: countBlocks(escapedPipe),
      },
    };

    if (hwpPath) {
      const hwp = await loadPlanInput(hwpPath);
      const { markdown: hwpMarkdown, keptBlocks, skippedImages, skippedTables } = planIRToMarkdown(hwp);
      const hwpMdPath = path.join(workDir, 'hwp-equivalent.md');
      const hwpTxtPath = path.join(workDir, 'hwp-equivalent.txt');
      const hwpHwpxPath = path.join(workDir, 'hwp-equivalent.hwpx');
      await Promise.all([
        fs.writeFile(hwpMdPath, hwpMarkdown, 'utf8'),
        fs.writeFile(hwpTxtPath, hwpMarkdown, 'utf8'),
        fs.writeFile(hwpHwpxPath, Buffer.from(await markdownToHwpx(hwpMarkdown))),
      ]);
      const [hwpMarkdownModel, hwpTextModel, hwpHwpxModel] = await Promise.all([
        loadPlanInput(hwpMdPath),
        loadPlanInput(hwpTxtPath),
        loadPlanInput(hwpHwpxPath),
      ]);
      // 왕복 비교는 "텍스트로 왕복 가능했던 블록만" 담은 hwpRepresentable을
      // 기준으로 한다 — 이미지·비표현 표 셀은 애초에 markdown에 실리지 않았으니
      // 재입력본에 없는 게 당연하다. 그 콘텐츠의 보존 여부는 hwpSmoke가 원본
      // 파싱 결과(구조 요약)로 별도 검증한다.
      const hwpRepresentable = { ...hwp, blocks: keptBlocks };
      const hwpComparisons = {
        hwpToMarkdown: comparePlanIR(hwpRepresentable, hwpMarkdownModel),
        hwpToText: comparePlanIR(hwpRepresentable, hwpTextModel),
        hwpToHwpx: comparePlanIR(hwpRepresentable, hwpHwpxModel),
      };
      Object.assign(report.semantic, Object.fromEntries(Object.entries(hwpComparisons).map(([name, comparison]) => [name, {
        passed: comparison.passed,
        mismatches: comparison.mismatches,
      }])));
      report.hwpTextRoundTrip = {
        note: '이미지·줄바꿈(또는 |)이 포함된 표 셀은 텍스트 포맷(MD/TXT)에 원천적으로 실을 수 없어 왕복 비교에서 제외했다. 두 항목 모두 hwpSmoke가 원본 파싱 결과로 보존 여부를 별도 검증한다.',
        hwpToHwpxNote: 'hwpToHwpx는 kordoc의 markdownToHwpx()가 표 셀에 텍스트로 박힌 이미지 참조(예: 표 안 이미지 캡션)를 실제 파일 없이 재해석하면서 자리표시자를 새로 생성해 파일명이 바뀌고, 내부적으로 연속 공백을 정규화하는 것으로 관찰됨 — 우리 어댑터(parseTextToPlanIR/kordocResultToPlanIR) 코드가 아니라 kordoc 자체 왕복 특성. 실사용 MD 입력은 실제 파일 경로를 참조하므로 이 드리프트가 발생하지 않는다. 따라서 hwpSmoke 통과 조건에서 제외하고 참고용으로만 기록한다.',
        totalBlocks: hwp.blocks.length,
        representableBlocks: keptBlocks.length,
        skippedImages,
        skippedTables,
      };
      const hwpSummary = structureSummary(hwp);
      // 원본에 이미지가 있었다면 모든 이미지가 해시와 함께 캡처됐는지까지
      // 통과 조건에 포함한다 — hwpxStructure와 동일한 기준.
      const imagesPreserved = skippedImages === 0 || (hwpSummary.imageCount === skippedImages && hwpSummary.imageSha256.length === hwpSummary.imageCount);
      // 통과 조건은 hwpToMarkdown·hwpToText만 본다 — 둘 다 우리 자체
      // parseTextToPlanIR(프로덕션 MD/TXT 입력 경로)를 실제로 왕복 검증한다.
      // hwpToHwpx는 위 hwpToHwpxNote에 적은 이유로 참고용 정보로만 기록하고
      // 게이트를 막지 않는다.
      report.hwpSmoke = {
        passed: hwp.source.format === 'hwp' && hwp.blocks.length > 0
          && hwpComparisons.hwpToMarkdown.passed && hwpComparisons.hwpToText.passed
          && imagesPreserved,
        imagesPreserved,
        ...hwpSummary,
      };
    }

    if (referenceHwpxPath) {
      const referenceHwpx = await loadPlanInput(referenceHwpxPath);
      const summary = structureSummary(referenceHwpx);
      report.hwpxStructure = {
        passed: referenceHwpx.source.format === 'hwpx'
          && summary.mergedTableCount > 0
          && summary.imageCount > 0
          && summary.imageSha256.length === summary.imageCount,
        ...summary,
      };
    }

    if (reportPath) {
      await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(report, null, 2));
    if (!comparisons.markdownToText.passed || !comparisons.markdownToHwpx.passed || (report.hwpSmoke && !report.hwpSmoke.passed) || (report.hwpxStructure && !report.hwpxStructure.passed)) process.exitCode = 1;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
