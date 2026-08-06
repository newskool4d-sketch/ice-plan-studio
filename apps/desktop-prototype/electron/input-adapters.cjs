const fs = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { parse, renderHwpxToSvg, VERSION: kordocVersion } = require('kordoc');
const { chunkBuffers } = require('./preview-split.cjs');
const { applyHwpxLayout, extractHwpxLayout, stripReviewAnnotations } = require('./hwpx-layout.cjs');
const {
  kordocResultToPlanIR,
  kordocResultsToPlanIR,
  normalizeImportedHeadings,
  parseTextToPlanIR,
} = require('./plan-ir.cjs');

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.hwp', '.hwpx']);

function inputFormat(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`지원하지 않는 입력 형식입니다: ${extension || '확장자 없음'}`);
  return extension.slice(1);
}

function hardPageChunks(source) {
  try {
    const archive = new AdmZip(source);
    const sections = archive.getEntries()
      .map((entry) => entry.entryName)
      .filter((entryName) => /^Contents\/section\d+\.xml$/i.test(entryName));
    // preview-split은 section0 하나만 치환한다. 여러 section이 있는 외부 HWPX에
    // 적용하면 나머지 section이 각 조각에 반복되므로, 앱 생성형 단일-section
    // 문서에서만 안전하게 재사용한다.
    if (sections.length !== 1 || sections[0].toLowerCase() !== 'contents/section0.xml') return null;
    const chunks = chunkBuffers(source);
    return chunks.length > 1
      ? chunks.map((buffer) => {
        const chunkArchive = new AdmZip(buffer);
        const section = chunkArchive.readAsText('Contents/section0.xml');
        return {
          buffer,
          imageReferences: [...new Set(
            [...section.matchAll(/binaryItemIDRef="([^"]+)"/g)].map((match) => match[1]),
          )],
        };
      })
      : null;
  } catch {
    // ZIP 복구·오류 진단은 기존 kordoc 단일 파싱 경로가 담당한다.
    return null;
  }
}

async function loadPlanInput(filePath) {
  const format = inputFormat(filePath);
  const title = path.basename(filePath);
  if (format === 'md' || format === 'txt') {
    const input = await fs.readFile(filePath, 'utf8');
    return parseTextToPlanIR(input, { format, title, filePath });
  }

  const source = await fs.readFile(filePath);
  const sanitized = format === 'hwpx' ? stripReviewAnnotations(source) : null;
  let hwpxPhysicalPageCount = null;
  if (format === 'hwpx') {
    const importSource = sanitized.buffer;
    const layout = extractHwpxLayout(importSource);
    const physicalPageCount = await renderHwpxToSvg(importSource, { reflow: true, reflowMode: 'keep' })
      .then((rendered) => rendered.pageCount)
      .catch(() => layout.hardPageCount);
    hwpxPhysicalPageCount = physicalPageCount;
    const chunks = hardPageChunks(importSource);
    if (chunks) {
      const results = await Promise.all(chunks.map((chunk) => parse(chunk.buffer, { filePath, keepTrailingEmptyCols: true })));
      const model = kordocResultsToPlanIR(
        results.map((result, index) => ({
          result,
          sourcePage: index + 1,
          imageReferences: chunks[index].imageReferences,
        })),
        { filePath, title, inferPageRoles: true },
      );
      const prepared = normalizeImportedHeadings(applyHwpxLayout(model, layout, physicalPageCount));
      return {
        ...prepared,
        metadata: {
          ...prepared.metadata,
          sourceLayout: {
            ...prepared.metadata.sourceLayout,
            reviewNoteCount: sanitized.count,
          },
        },
      };
    }
  }
  const importSource = sanitized?.buffer || source;
  const result = await parse(importSource, { filePath, keepTrailingEmptyCols: true });
  const model = kordocResultToPlanIR(result, { filePath, title });
  if (format !== 'hwpx') return model;
  const layout = extractHwpxLayout(importSource);
  const normalized = normalizeImportedHeadings(applyHwpxLayout(
    model,
    layout,
    hwpxPhysicalPageCount ?? result.metadata?.pageCount,
  ));
  return {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      sourceLayout: {
        ...normalized.metadata?.sourceLayout,
        reviewNoteCount: sanitized?.count || 0,
      },
    },
  };
}

function kordocSmokeInfo() {
  return { package: 'kordoc', version: kordocVersion };
}

module.exports = { inputFormat, kordocSmokeInfo, loadPlanInput };
