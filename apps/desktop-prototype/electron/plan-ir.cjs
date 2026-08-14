const crypto = require('node:crypto');

const PLAN_IR_SCHEMA_VERSION = '0.2';
const PAGE_TYPES = new Set([
  'cover',
  'inner-cover',
  'preflight',
  'toc',
  'summary',
  'body',
  'body-opening',
  'body-continuation',
  'task',
  'schedule',
  'appendix',
]);
const PAGE_TYPE_ALIASES = { review: 'preflight', innerCover: 'inner-cover' };

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

const IMPORTED_TASK_SUBHEADING = /^\s*(?:\[과제\s*\d+\s*-\s*\d+\]|과제\s*\d+\s*-\s*\d+\.?)\s*(\S.*)$/;
const IMPORTED_TASK_HEADING = /^\s*(?:\[과제\s*\d+\]|과제\s*\d+\.?)\s*(\S.*)$/;
const IMPORTED_CHAPTER_HEADING = /^\s*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|\d+\.)\s+(\S.*)$/;
// `[가-하]`는 유니코드 음절 1만여 자를 모두 포함해 "예. 그렇다"·"결. 정리" 같은
// 평문까지 소제목으로 잡는다. 실제 가나다 항목기호로 쓰이는 14자만 허용한다.
const IMPORTED_KOREAN_SUBHEADING = /^\s*[가나다라마바사아자차카타파하]\.\s+(\S.*)$/;
const IMPORTED_DATE = /^\s*\d{4}\.\s*\d{1,2}\.\s*$/;
// 번호로 시작하는 본문 문단이 제목으로 승격되는 것을 막는 상한(공백 제외).
// 점선 목차 줄("Ⅰ. 추진 근거 ......... 1")도 이 상한에 걸려 본문 제목에서 빠진다.
// model_to_hwpx.py NUMERIC_HEADING_MAX_TITLE_CHARS와 같은 값을 유지할 것.
const IMPORTED_HEADING_MAX_TITLE_CHARS = 20;

function isPlausibleImportedHeadingTitle(title) {
  const stripped = String(title || '').replace(/\s+/g, '');
  return stripped.length > 0 && stripped.length <= IMPORTED_HEADING_MAX_TITLE_CHARS;
}

function normalizeImportedHeadingBlock(block) {
  if (!['paragraph', 'listItem', 'heading'].includes(block?.type)) return block;
  const text = [block.marker, block.text].filter(Boolean).join(' ').trim();
  if (!text || IMPORTED_DATE.test(text)) return block;
  let level = null;
  let headingKind = null;
  let match = IMPORTED_TASK_SUBHEADING.exec(text);
  if (match && isPlausibleImportedHeadingTitle(match[1])) {
    level = 2;
    headingKind = 'task-subsection';
  } else if ((match = IMPORTED_TASK_HEADING.exec(text)) && isPlausibleImportedHeadingTitle(match[1])) {
    level = 1;
    headingKind = 'task-section';
  } else if ((match = IMPORTED_CHAPTER_HEADING.exec(text)) && isPlausibleImportedHeadingTitle(match[1])) {
    level = 1;
    headingKind = 'chapter';
  } else if ((match = IMPORTED_KOREAN_SUBHEADING.exec(text)) && isPlausibleImportedHeadingTitle(match[1])) {
    level = 2;
    headingKind = 'korean-subheading';
  }
  if (!level) return block;
  return {
    ...block,
    type: 'heading',
    role: 'heading',
    level,
    text,
    headingKind,
    sourceType: block.type,
  };
}

function normalizeImportedHeadings(model) {
  if ((model?.metadata?.sourcePages || []).length) {
    return {
      ...model,
      // 쪽 분할 가져오기는 blockIndices를 유지해야 하므로 필터링하거나 재정렬하지
      // 않고, 각 블록의 제목 의미만 보강한다.
      blocks: (model?.blocks || []).map(normalizeImportedHeadingBlock),
    };
  }
  const documentTitle = normalizeText(model?.metadata?.title || '')
    .replace(/\.(md|txt|hwpx?|iceplan)$/i, '')
    .trim();
  const artifact = (block) => {
    const text = normalizeText(block?.text || '').trim();
    if (/^(?:-{3,}|—{3,}|_{3,})$/.test(text)) return true;
    if (documentTitle && text === documentTitle) return true;
    if (block?.type !== 'table' || !documentTitle) return false;
    const cellText = [
      ...(block.header || []),
      ...(block.rows || []).flat(),
    ].map((value) => normalizeText(value || '').trim()).filter(Boolean).join('');
    return cellText === documentTitle;
  };
  let blocks = (model?.blocks || []).filter((block) => !artifact(block));
  const tocIndex = blocks.findIndex((block) => (
    block?.type !== 'table'
    && /^목\s*차$/.test(normalizeText(block?.text || '').trim())
  ));
  if (tocIndex > 0) blocks = blocks.slice(tocIndex);
  return {
    ...model,
    blocks: blocks.map(normalizeImportedHeadingBlock),
  };
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sourceOf(format, filePath, blockIndex, original, sourcePage = null) {
  const pageNumber = positiveInteger(sourcePage);
  return {
    format,
    filePath: filePath || null,
    blockIndex,
    original: String(original ?? ''),
    ...(pageNumber ? { pageNumber } : {}),
  };
}

function withSourcePage(block, sourcePage) {
  const number = positiveInteger(sourcePage);
  return number ? { ...block, sourcePage: number } : block;
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

function createPlanIR({
  title = '',
  format,
  filePath = null,
  blocks = [],
  diagnostics = [],
  pageTypes = [],
  sourcePages = [],
  approvalStatus = 'unapproved',
}) {
  if (!format) throw new Error('Plan IR requires a source format');
  const normalizedSourcePages = sourcePages
    .map((page) => ({
      number: positiveInteger(page?.number),
      role: PAGE_TYPE_ALIASES[page?.role] || page?.role || null,
      blockIndices: Array.isArray(page?.blockIndices)
        ? page.blockIndices.filter((index) => Number.isInteger(index) && index >= 0)
        : [],
    }))
    .filter((page) => page.number);
  return {
    schemaVersion: PLAN_IR_SCHEMA_VERSION,
    kind: 'plan-ir',
    metadata: {
      title: normalizeText(title),
      ...(normalizedSourcePages.length ? { sourcePages: normalizedSourcePages } : {}),
    },
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
  // 1열 표와 현장 Markdown에서 쓰는 축약 정렬 구분선(`| :-: |`)도 인식한다.
  // 파이프가 전혀 없는 순수 "---"(수평선)는 표로 오인하지 않도록 제외한다.
  const isTableDivider = (line) => {
    const trimmed = line.trim();
    return trimmed.includes('|') && /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(trimmed);
  };
  const splitCells = (line) => {
    const content = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cell = '';
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (character === '\\' && content[index + 1] === '|') {
        cell += '|';
        index += 1;
      } else if (character === '|') {
        cells.push({ text: cell.trim(), rowSpan: 1, colSpan: 1 });
        cell = '';
      } else {
        cell += character;
      }
    }
    cells.push({ text: cell.trim(), rowSpan: 1, colSpan: 1 });
    return cells;
  };

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
      // 들여쓰기 2칸 = 1단계. floor를 나눗셈 밖에 두면(Math.floor(x)/2) 홀수
      // 들여쓰기에서 1.5 같은 소수 레벨이 나와 위계 검증의 전제가 깨진다 —
      // floor를 나눗셈 안으로(Math.floor(x/2)) 넣어 항상 정수 레벨을 만든다.
      const indentLevel = Math.floor(line.search(/\S/) / 2);
      blocks.push({ type: 'listItem', role: 'list', marker, ordered: /^\d+\.$/.test(marker), level: indentLevel, text: list[2].trim(), source: sourceOf(format, filePath, index, line) });
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
    output.push(withSourcePage({
      type: 'listItem',
      role: 'list',
      ordered: block.listType === 'ordered',
      level: block.listDepth || 0,
      text: normalizeText(block.text),
      source: context,
    }, context.pageNumber));
    return;
  }
  for (const child of children) flattenKordocList(child, context, output);
}

function sourcePageRecords(blocks, roles = new Map(), pageNumbers = []) {
  const byPage = new Map(
    pageNumbers
      .map(positiveInteger)
      .filter(Boolean)
      .map((number) => [number, []]),
  );
  blocks.forEach((block, blockIndex) => {
    const number = positiveInteger(block.sourcePage);
    if (!number) return;
    if (!byPage.has(number)) byPage.set(number, []);
    byPage.get(number).push(blockIndex);
  });
  return [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([number, blockIndices]) => ({
      number,
      role: roles.get(number) || null,
      blockIndices,
    }));
}

function pageTextLines(page, blocks) {
  const values = [];
  for (const blockIndex of page.blockIndices) {
    const block = blocks[blockIndex];
    if (!block) continue;
    if (block.type === 'table') {
      for (const row of block.table?.cells || []) {
        for (const cell of row) {
          const text = normalizeText(cell?.text).trim();
          if (text) values.push(text);
        }
      }
      continue;
    }
    const text = normalizeText(block.text).trim();
    if (text) values.push(text);
  }
  return values;
}

function inferSourcePageRoles(sourcePages, blocks) {
  if (!sourcePages.length) return sourcePages;
  const linesByPage = sourcePages.map((page) => pageTextLines(page, blocks));
  const roles = sourcePages.map((page, index) => {
    const lines = linesByPage[index];
    if (lines.some((line) => /^(목\s*차|contents?)$/i.test(line))) return 'toc';
    if (lines.some((line) => /^(요약|summary|추진계획\s*\(\s*요약\s*\))$/i.test(line))) return 'summary';
    if (lines.some((line) => /^(사전\s*검토표?|preflight)$/i.test(line))) return 'preflight';
    return page.role || null;
  });

  if (!roles[0]) roles[0] = 'cover';
  const firstFrontMatter = roles.findIndex((role) => ['preflight', 'toc', 'summary'].includes(role));
  const secondPageLooksLikeInnerCover = linesByPage[1]?.some((line) => /^(운영\s*계획|기본\s*계획)$/i.test(line));
  if (roles.length > 1 && !roles[1] && (secondPageLooksLikeInnerCover || firstFrontMatter > 1)) {
    roles[1] = 'inner-cover';
  }

  let bodyStarted = false;
  for (let index = 1; index < roles.length; index += 1) {
    if (roles[index]) {
      if (['body', 'body-opening', 'body-continuation'].includes(roles[index])) bodyStarted = true;
      continue;
    }
    roles[index] = bodyStarted ? 'body-continuation' : 'body-opening';
    bodyStarted = true;
  }
  return sourcePages.map((page, index) => ({ ...page, role: roles[index] }));
}

function imageIdentity(image, sha256) {
  return sha256 || (image?.filename ? `filename:${image.filename}` : null);
}

function normalizeImageReference(value) {
  const filename = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const stem = filename.replace(/\.[^.]+$/, '').toLowerCase();
  const numbered = /^image_?0*(\d+)$/.exec(stem);
  return numbered ? `image${Number(numbered[1])}` : stem;
}

function imageReferenceCandidates(image, fallbackText = '') {
  return new Set(
    [image?.filename, fallbackText]
      .map(normalizeImageReference)
      .filter(Boolean),
  );
}

function kordocResultsToPlanIR(entries, { filePath, title = '', inferPageRoles = false } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('kordoc results are required');
  const normalizedEntries = entries.map((entry) => (entry?.result ? entry : { result: entry }));
  const firstResult = normalizedEntries[0].result;
  if (!firstResult?.success) throw new Error(firstResult?.error || 'kordoc failed to parse the document');
  const format = firstResult.fileType;
  const blocks = [];
  const diagnostics = [];
  let rawBlockOffset = 0;
  let imageOffset = 0;

  for (const entry of normalizedEntries) {
    const result = entry.result;
    if (!result?.success) throw new Error(result?.error || 'kordoc failed to parse the document');
    const entryPage = positiveInteger(entry.sourcePage);
    const trustedImageReferences = Array.isArray(entry.imageReferences)
      ? new Set(entry.imageReferences.map(normalizeImageReference).filter(Boolean))
      : null;
    const referencedImageIdentities = new Set();
    for (const [index, block] of (result.blocks || []).entries()) {
      const sourcePage = entryPage;
      const source = sourceOf(
        format,
        filePath,
        rawBlockOffset + index,
        block.text || block.table?.cells?.flat().map((cell) => cell.text).join('\n') || '',
        sourcePage,
      );
      if (block.type === 'heading') {
        blocks.push(withSourcePage({ type: 'heading', role: 'heading', level: block.level || 1, text: normalizeText(block.text), source }, sourcePage));
      } else if (block.type === 'table' && block.table) {
        const table = makeTable(block.table.cells || [], block.table.rows || 0, block.table.cols || 0, { repeatHeader: block.table.hasHeader });
        blocks.push(withSourcePage({ type: 'table', role: 'table', table, ...tableCompatibility(table), source }, sourcePage));
      } else if (block.type === 'image') {
        const image = block.imageData || (result.images || []).find((candidate) => candidate.filename === block.text);
        const sha256 = imageHash(image);
        const identity = imageIdentity(image, sha256);
        const referenceCandidates = imageReferenceCandidates(image, block.text);
        if (
          trustedImageReferences
          && ![...referenceCandidates].some((reference) => trustedImageReferences.has(reference))
        ) continue;
        if (identity) referencedImageIdentities.add(identity);
        blocks.push(withSourcePage({
          type: 'image',
          role: 'image',
          image: { filename: image?.filename || null, mimeType: image?.mimeType || null, sha256 },
          source,
        }, sourcePage));
      } else if (block.type === 'list') {
        flattenKordocList(block, source, blocks);
      } else if (block.type !== 'separator') {
        const text = normalizeText(block.text);
        const list = /^(?:[-*]|\d+\.|[□○❍▪■])\s+(.+)$/.exec(text);
        if (list) {
          const marker = text.slice(0, text.length - list[1].length).trim();
          blocks.push(withSourcePage({ type: 'listItem', role: 'list', marker, ordered: /^\d+\.$/.test(marker), level: 0, text: list[1], source }, sourcePage));
        } else if (text) {
          blocks.push(withSourcePage({ type: 'paragraph', role: 'body', text, source }, sourcePage));
        }
      }
    }
    rawBlockOffset += (result.blocks || []).length;

    for (const image of result.images || []) {
      const sha256 = imageHash(image);
      const identity = imageIdentity(image, sha256);
      if (identity && referencedImageIdentities.has(identity)) continue;
      const referenceCandidates = imageReferenceCandidates(image);
      if (
        trustedImageReferences
        && ![...referenceCandidates].some((reference) => trustedImageReferences.has(reference))
      ) continue;
      // 여러 쪽으로 분할한 HWPX에서 result.images는 패키지 전체 이미지를 각
      // 조각마다 되풀이할 수 있다. 실제 occurrence는 result.blocks의 image
      // 블록 또는 분할 XML의 binaryItemIDRef로만 신뢰한다.
      if (normalizedEntries.length > 1 && !trustedImageReferences) continue;
      blocks.push(withSourcePage({
        type: 'image',
        role: 'image',
        image: { filename: image.filename || null, mimeType: image.mimeType || null, sha256 },
        source: sourceOf(format, filePath, 'image:' + imageOffset, image.filename || '', entryPage),
      }, entryPage));
      imageOffset += 1;
    }
    diagnostics.push(...(result.warnings || []).map((warning) => ({
      code: warning.code,
      message: warning.message,
      page: entryPage || warning.page || null,
    })));
  }

  let sourcePages = sourcePageRecords(
    blocks,
    new Map(),
    normalizedEntries.map((entry) => entry.sourcePage),
  );
  if (inferPageRoles) sourcePages = inferSourcePageRoles(sourcePages, blocks);
  const pageTypes = sourcePages.map((page) => page.role).filter((role) => PAGE_TYPES.has(role));
  return createPlanIR({
    title: title || firstResult.metadata?.title || '',
    format,
    filePath,
    blocks,
    diagnostics,
    pageTypes,
    sourcePages,
  });
}

function kordocResultToPlanIR(result, options = {}) {
  return kordocResultsToPlanIR([{ result }], options);
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
  kordocResultsToPlanIR,
  normalizeImportedHeadingBlock,
  normalizeImportedHeadings,
  normalizeText,
  parseTextToPlanIR,
  semanticProjection,
  structureProjection,
};
