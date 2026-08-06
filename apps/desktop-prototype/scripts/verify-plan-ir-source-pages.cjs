#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { markdownToHwpx } = require('kordoc');
const { loadPlanInput } = require('../electron/input-adapters.cjs');
const { createPlanIR, kordocResultsToPlanIR } = require('../electron/plan-ir.cjs');
const { minimumPhysicalHeight } = require('../electron/preview-split.cjs');

const PAGE_TEXTS = [
  '표지 제목',
  '운영 계획',
  '목 차',
  '요약',
  '1. 추진 배경',
  '2. 추진 내용',
];

const EXPECTED_ROLES = [
  'cover',
  'inner-cover',
  'toc',
  'summary',
  'body-opening',
  'body-continuation',
];

const EXPECTED_FIRST_BLOCK_TEXT = [
  '표지 제목',
  '운영 계획',
  '목 차',
  '요약',
  '1. 추진 배경',
  '2. 추진 내용',
];

function pageBreakParagraph(id, boundaryIndex) {
  const controls = boundaryIndex < 3
    ? '<hp:ctrl><hp:pageHiding hideHeader="0" hideFooter="0" hideMasterPage="0" hideBorder="0" hideFill="0" hidePageNum="1"/></hp:ctrl>'
    : boundaryIndex === 3
      ? '<hp:ctrl><hp:newNum num="1" numType="PAGE"/></hp:ctrl>'
      : '';
  return `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${controls}<hp:t/></hp:run></hp:p>`;
}

function withHardPageBreaks(hwpxBuffer) {
  const archive = new AdmZip(hwpxBuffer);
  let section = archive.readAsText('Contents/section0.xml');
  for (const [index, text] of PAGE_TEXTS.slice(1).entries()) {
    const textIndex = section.indexOf(`>${text}<`);
    assert.notEqual(textIndex, -1, `fixture text missing from section XML: ${text}`);
    const paragraphStart = section.lastIndexOf('<hp:p', textIndex);
    assert.notEqual(paragraphStart, -1, `paragraph start missing for fixture text: ${text}`);
    section = section.slice(0, paragraphStart) + pageBreakParagraph(9000 + index, index) + section.slice(paragraphStart);
  }
  archive.updateFile('Contents/section0.xml', Buffer.from(section, 'utf8'));
  return archive.toBuffer();
}

function firstPageText(model, page) {
  return page.blockIndices
    .map((blockIndex) => model.blocks[blockIndex])
    .find((block) => typeof block?.text === 'string' && block.text.trim())
    ?.text;
}

async function run() {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-plan-source-pages-'));
  try {
    const plainPath = path.join(workDir, 'plain.hwpx');
    const pagedPath = path.join(workDir, 'paged.hwpx');
    const markdown = PAGE_TEXTS.join('\n\n');
    const plain = Buffer.from(await markdownToHwpx(markdown));
    await Promise.all([
      fs.writeFile(plainPath, plain),
      fs.writeFile(pagedPath, withHardPageBreaks(plain)),
    ]);

    const [plainModel, pagedModel] = await Promise.all([
      loadPlanInput(plainPath),
      loadPlanInput(pagedPath),
    ]);

    assert.equal(plainModel.metadata.sourcePages, undefined, 'unsplit HWPX must not promote section numbers to source pages');
    assert.ok(plainModel.blocks.every((block) => block.sourcePage === undefined), 'unsplit HWPX gained untrusted sourcePage values');

    const sourcePages = pagedModel.metadata.sourcePages;
    assert.equal(sourcePages.length, PAGE_TEXTS.length, 'hard page-break chunks were not preserved');
    assert.deepEqual(sourcePages.map((page) => page.number), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(sourcePages.map((page) => page.role), EXPECTED_ROLES);
    assert.deepEqual(pagedModel.pageTypes, EXPECTED_ROLES);
    assert.equal('pages' in pagedModel.metadata, false, 'input adapter must not bypass domain page decisions');

    sourcePages.forEach((page, index) => {
      assert.ok(page.blockIndices.length > 0, `source page ${page.number} has no owned blocks`);
      assert.ok(
        page.blockIndices.every((blockIndex) => {
          const block = pagedModel.blocks[blockIndex];
          return block.sourcePage === page.number && block.source?.pageNumber === page.number;
        }),
        `source page ownership mismatch on page ${page.number}`,
      );
      assert.equal(firstPageText(pagedModel, page), EXPECTED_FIRST_BLOCK_TEXT[index]);
    });

    const typeProbe = createPlanIR({
      format: 'md',
      pageTypes: ['body-opening', 'body-continuation'],
    });
    assert.deepEqual(typeProbe.pageTypes, ['body-opening', 'body-continuation']);

    const sharedImage = {
      filename: 'seal.png',
      mimeType: 'image/png',
      data: Buffer.from('same-image-bytes'),
    };
    const imageOccurrenceModel = kordocResultsToPlanIR([
      {
        sourcePage: 1,
        result: {
          success: true,
          fileType: 'hwpx',
          metadata: {},
          blocks: [{ type: 'image', text: 'seal.png', imageData: sharedImage }],
          images: [sharedImage],
        },
      },
      {
        sourcePage: 2,
        result: {
          success: true,
          fileType: 'hwpx',
          metadata: {},
          blocks: [{ type: 'image', text: 'seal.png', imageData: sharedImage }],
          images: [sharedImage],
        },
      },
    ], { filePath: 'synthetic.hwpx', title: '이미지 occurrence 검증' });
    const imageBlocks = imageOccurrenceModel.blocks.filter((block) => block.type === 'image');
    assert.equal(imageBlocks.length, 2, 'same image used on two pages must preserve both occurrences');
    assert.deepEqual(imageBlocks.map((block) => block.sourcePage), [1, 2]);
    assert.deepEqual(imageOccurrenceModel.metadata.sourcePages.map((page) => page.number), [1, 2]);

    const secondImage = {
      filename: 'image_002.png',
      mimeType: 'image/png',
      data: Buffer.from('second-image-bytes'),
    };
    const xmlAnchoredImages = kordocResultsToPlanIR([
      {
        sourcePage: 1,
        imageReferences: ['image1', 'image2'],
        result: {
          success: true,
          fileType: 'hwpx',
          metadata: {},
          blocks: [{ type: 'image', text: 'image_001.png', imageData: { ...sharedImage, filename: 'image1' } }],
          images: [{ ...sharedImage, filename: 'image_001.png' }, secondImage],
        },
      },
      {
        sourcePage: 2,
        imageReferences: [],
        result: {
          success: true,
          fileType: 'hwpx',
          metadata: {},
          blocks: [
            { type: 'image', text: 'image_001.png', imageData: { ...sharedImage, filename: 'BinData/image1.png' } },
            { type: 'image', text: 'image_002.png', imageData: { ...secondImage, filename: 'BinData/image2.png' } },
          ],
          images: [{ ...sharedImage, filename: 'image_001.png' }, secondImage],
        },
      },
    ], { filePath: 'xml-anchored.hwpx', title: 'XML 이미지 참조 검증' });
    const anchoredImageBlocks = xmlAnchoredImages.blocks.filter((block) => block.type === 'image');
    assert.equal(anchoredImageBlocks.length, 2, 'XML-referenced images on page 1 were not preserved');
    assert.ok(anchoredImageBlocks.every((block) => block.sourcePage === 1), 'package-global images leaked into an unreferenced page');
    assert.deepEqual(xmlAnchoredImages.metadata.sourcePages.map((page) => page.number), [1, 2], 'blank source page ownership was dropped');
    assert.equal(xmlAnchoredImages.metadata.sourcePages[1].blockIndices.length, 0, 'unreferenced image blocks remained on page 2');
    assert.equal(
      minimumPhysicalHeight({ width: 595, height: 159, pageCount: 1 }),
      842,
      'short rendered page must retain A4 minimum height',
    );

    console.log(JSON.stringify({
      gate: 'plan-ir-source-pages',
      passed: true,
      checks: [
        'untrusted HWPX section numbers not promoted',
        'hard page-break chunks preserved',
        'block sourcePage provenance',
        'source page role inference',
        'body opening and continuation page types',
        'same-image cross-page occurrence preservation',
        'XML-anchored image occurrence filtering',
        'blank source-page preservation',
        'A4 minimum preview height',
      ],
      sourcePages: sourcePages.map(({ number, role, blockIndices }) => ({
        number,
        role,
        blockCount: blockIndices.length,
      })),
    }, null, 2));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
