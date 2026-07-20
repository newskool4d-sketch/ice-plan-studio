const crypto = require('node:crypto');

const PLAN_IR_SCHEMA_VERSION = '0.2';
const PAGE_TYPES = new Set(['cover', 'inner-cover', 'preflight', 'toc', 'summary', 'body', 'task', 'schedule', 'appendix']);
const PAGE_TYPE_ALIASES = { review: 'preflight', innerCover: 'inner-cover' };

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

function sourceOf(format, filePath, blockIndex, original) {
  return { format, filePath: filePath || null, blockIndex, original: String(original ?? '') };
}

function makeTable(cells, rowCnt, colCnt, { repeatHeader = false, treatAsChar = false } = {}) {
  return {
    rowCnt,
    colCnt,
    cells: cells.map((row) => row.map((cell) => ({
      text: normalizeText(cell?.text),
      rowSpan: Number(cell?.rowSpan) || 1,
      colSpan: Number(cell?.colSpan) || 1,
      isHeader: Boolean(cell?.isHeader),
    }))),
    repeatHeader: Boolean(repeatHeader),
    treatAsChar: Boolean(treatAsChar),
  };
}

function tableCompatibility(table) {
  const rows = table.cells.map((row) => row.map((cell) => cell.text));
  return {
    header: rows[0] || [],
    rows: rows.slice(1),
    layout: { repeatHeader: table.repeatHeader, treatAsChar: table.treatAsChar },
  };
}

function createPlanIR({ title = '', format, filePath = null, blocks = [], diagnostics = [], pageTypes = [], approvalStatus = 'unapproved' }) {
  if (!format) throw new Error('Plan IR requires a source format');
  return {
    schemaVersion: PLAN_IR_SCHEMA_VERSION,
    kind: 'plan-ir',
    metadata: { title: normalizeText(title) },
    source: { format, filePath },
    approval: { status: approvalStatus },
    pageTypes: pageTypes.map((pageType) => PAGE_TYPE_ALIASES[pageType] || pageType).filter((pageType) => PAGE_TYPES.has(pageType)),
    diagnostics,
    blocks,
  };
}

function parseTextToPlanIR(input, { format, title = '', filePath = null } = {}) {
  const lines = normalizeText(input).split('\n');
  const blocks = [];
  let paragraph = [];
  let paragraphStart = 0;
  const pushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', role: 'body', text, source: sourceOf(format, filePath, paragraphStart, paragraph.join('\n')) });
    paragraph = [];
  };
  // 원래 정규식은 `(...)+`(1회 이상)라 1열 표 구분선(`| --- |`)을 인식하지 못했다.
  // `*`(0회 이상)로 바꿔 1열도 인식하되, 파이프가 전혀 없는 순수 "---"(수평선으로
  // 오인 가능)는 여전히 표로 오인하지 않도록 파이프 포함을 별도 조건으로 요구한다.
  const isTableDivider = (line) => {
    const trimmed = line.trim();
    return trimmed.includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(trimmed);
  };
  const splitCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => ({ text: cell.trim(), rowSpan: 1, colSpan: 1 }));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { pushParagraph(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      pushParagraph();
      blocks.push({ type: 'heading', role: 'heading', level: heading[1].length, text: heading[2].trim(), source: sourceOf(format, filePath, index, line) });
      continue;
    }
    if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
      pushParagraph();
      const cells = [splitCells(line)];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { cells.push(splitCells(lines[index])); index += 1; }
      index -= 1;
      const table = makeTable(cells, cells.length, Math.max(...cells.map((row) => row.length)), { repeatHeader: true });
      blocks.push({ type: 'table', role: 'table', table, ...tableCompatibility(table), source: sourceOf(format, filePath, index - cells.length, cells.map((row) => row.map((cell) => cell.text).join('|')).join('\n')) });
      continue;
    }
    const list = /^\s*((?:[-*]|\d+\.|[□○❍▪■])\s+)\s*(.+)$/.exec(line);
    if (list) {
      pushParagraph();
      const marker = list[1].trim();
      blocks.push({ type: 'listItem', role: 'list', marker, ordered: /^\d+\.$/.test(marker), level: Math.floor(line.search(/\S/)) / 2, text: list[2].trim(), source: sourceOf(format, filePath, index, line) });
      continue;
    }
    if (!paragraph.length) paragraphStart = index;
    paragraph.push(line.trim());
  }
  pushParagraph();
  return createPlanIR({ title, format, filePath, blocks });
}

function imageHash(image) {
  const data = image?.data;
  if (!data) return null;
  return crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
}

function flattenKordocList(block, context, output) {
  const children = Array.isArray(block.children) ? block.children : [];
  if (!children.length) {
    output.push({ type: 'listItem', role: 'list', ordered: block.listType === 'ordered', level: block.listDepth || 0, text: normalizeText(block.text), source: context });
    return;
  }
  for (const child of children) flattenKordocList(child, context, output);
}

function kordocResultToPlanIR(result, { filePath, title = '' } = {}) {
  if (!result?.success) throw new Error(result?.error || 'kordoc failed to parse the document');
  const format = result.fileType;
  const blocks = [];
  const seenImageHashes = new Set();
  for (const [index, block] of (result.blocks || []).entries()) {
    const source = sourceOf(format, filePath, index, block.text || block.table?.cells?.flat().map((cell) => cell.text).join('\n') || '');
    if (block.type === 'heading') {
      blocks.push({ type: 'heading', role: 'heading', level: block.level || 1, text: normalizeText(block.text), source });
    } else if (block.type === 'table' && block.table) {
      const table = makeTable(block.table.cells || [], block.table.rows || 0, block.table.cols || 0, { repeatHeader: block.table.hasHeader });
      blocks.push({ type: 'table', role: 'table', table, ...tableCompatibility(table), source });
    } else if (block.type === 'image') {
      const image = block.imageData || (result.images || []).find((candidate) => candidate.filename === block.text);
      const sha256 = imageHash(image);
      if (sha256) seenImageHashes.add(sha256);
      blocks.push({ type: 'image', role: 'image', image: { filename: image?.filename || null, mimeType: image?.mimeType || null, sha256 }, source });
    } else if (block.type === 'list') {
      flattenKordocList(block, source, blocks);
    } else if (block.type !== 'separator') {
      const text = normalizeText(block.text);
      const list = /^(?:[-*]|\d+\.|[□○❍▪■])\s+(.+)$/.exec(text);
      if (list) {
        const marker = text.slice(0, text.length - list[1].length).trim();
        blocks.push({ type: 'listItem', role: 'list', marker, ordered: /^\d+\.$/.test(marker), level: 0, text: list[1], source });
      } else if (text) {
        blocks.push({ type: 'paragraph', role: 'body', text, source });
      }
    }
  }
  for (const [index, image] of (result.images || []).entries()) {
    const sha256 = imageHash(image);
    if (sha256 && seenImageHashes.has(sha256)) continue;
    if (sha256) seenImageHashes.add(sha256);
    blocks.push({
      type: 'image',
      role: 'image',
      image: { filename: image.filename || null, mimeType: image.mimeType || null, sha256 },
      source: sourceOf(format, filePath, 'image:' + index, image.filename || ''),
    });
  }
  const diagnostics = (result.warnings || []).map((warning) => ({ code: warning.code, message: warning.message, page: warning.page || null }));
  return createPlanIR({ title: title || result.metadata?.title || '', format, filePath, blocks, diagnostics });
}

function semanticProjection(ir, { excludeImages = false } = {}) {
  const blocks = excludeImages ? (ir.blocks || []).filter((block) => block.type !== 'image') : (ir.blocks || []);
  return {
    approvalStatus: ir.approval?.status || 'unapproved',
    pageTypes: ir.pageTypes || [],
    blocks: blocks.map((block) => ({
      role: block.role,
      type: block.type,
      level: block.type === 'heading' ? block.level || 1 : undefined,
      list: block.type === 'listItem' ? { marker: block.marker || '', ordered: Boolean(block.ordered), level: block.level || 0 } : undefined,
      text: block.type === 'table' || block.type === 'image' ? undefined : normalizeText(block.text),
      table: block.type === 'table' ? {
        rowCnt: block.table.rowCnt,
        colCnt: block.table.colCnt,
        cells: block.table.cells.map((row) => row.map((cell) => normalizeText(cell.text))),
      } : undefined,
      // 이미지 정체성(해시)을 비교에 포함한다 — 이게 빠지면 내용이 다른 이미지가
      // 섞여도 블록 개수만 같으면 "동일"로 오판정된다.
      image: block.type === 'image' ? { filename: block.image?.filename ?? null, sha256: block.image?.sha256 ?? null } : undefined,
    })),
  };
}

function structureProjection(ir) {
  return {
    counts: (ir.blocks || []).reduce((counts, block) => ({ ...counts, [block.type]: (counts[block.type] || 0) + 1 }), {}),
    blocks: (ir.blocks || []).map((block) => ({
      type: block.type,
      table: block.type === 'table' ? {
        rowCnt: block.table.rowCnt,
        colCnt: block.table.colCnt,
        cells: block.table.cells.map((row) => row.map((cell) => ({ text: normalizeText(cell.text), rowSpan: cell.rowSpan, colSpan: cell.colSpan }))),
        repeatHeader: block.table.repeatHeader,
        treatAsChar: block.table.treatAsChar,
      } : undefined,
      image: block.type === 'image' ? block.image : undefined,
    })),
  };
}

function compareProjection(kind, expected, actual) {
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  return { kind, passed: expectedJson === actualJson, expected, actual, mismatches: expectedJson === actualJson ? [] : [{ path: '$', expected, actual }] };
}

function comparePlanIR(expected, actual, options = {}) {
  return compareProjection('semantic', semanticProjection(expected, options), semanticProjection(actual, options));
}

function comparePlanStructure(expected, actual) {
  return compareProjection('structure', structureProjection(expected), structureProjection(actual));
}

module.exports = {
  PLAN_IR_SCHEMA_VERSION,
  comparePlanIR,
  comparePlanStructure,
  createPlanIR,
  kordocResultToPlanIR,
  normalizeText,
  parseTextToPlanIR,
  semanticProjection,
  structureProjection,
};
