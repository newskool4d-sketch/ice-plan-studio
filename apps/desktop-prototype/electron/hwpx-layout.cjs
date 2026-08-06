const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const REVIEW_NOTE_PATTERNS = [
  /폰트/,
  /글자\s*크기/,
  /페이지\s*삭제/,
  /미리\s*보기|미리보기/,
  /실구현|SVG/,
  /표형태로\s*구현/,
  /양쪽\s*정렬/,
  /모든\s*표\s*공통/,
  /통일.*(?:해야|바람)/,
  /파트\s*간.*간격/,
  /해당\s*부분\s*모두\s*삭제/,
  /^삭제$/,
  /^[가나다]\s*파트$/,
  /함초롬바탕|휴[먼명]\s*명조/,
];

function elements(node, localName) {
  return Array.from(node?.getElementsByTagName?.('*') || [])
    .filter((element) => element.localName === localName);
}

function firstElement(node, localName) {
  return elements(node, localName)[0] || null;
}

function directChildren(node, localName) {
  const result = [];
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (!localName || child.localName === localName)) result.push(child);
  }
  return result;
}

function normalizedText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function fingerprint(value) {
  return normalizedText(value).replace(/\s/g, '');
}

function nodeText(node) {
  return normalizedText(elements(node, 't').map((item) => item.textContent || '').join(''));
}

function integerAttribute(node, name) {
  const value = Number(node?.getAttribute?.(name));
  return Number.isFinite(value) ? value : null;
}

function readFonts(header) {
  const fonts = new Map();
  for (const fontface of elements(header, 'fontface')) {
    if (fontface.getAttribute('lang') !== 'HANGUL') continue;
    for (const font of directChildren(fontface, 'font')) {
      fonts.set(font.getAttribute('id'), font.getAttribute('face') || null);
    }
  }
  return fonts;
}

function readCharProperties(header, fonts) {
  const properties = new Map();
  for (const charPr of elements(header, 'charPr')) {
    const fontRef = firstElement(charPr, 'fontRef');
    const spacing = firstElement(charPr, 'spacing');
    const id = charPr.getAttribute('id');
    properties.set(id, {
      sourceCharPrId: id,
      fontFamily: fonts.get(fontRef?.getAttribute('hangul')) || null,
      sizePt: integerAttribute(charPr, 'height') / 100,
      charSpacingPercent: integerAttribute(spacing, 'hangul') || 0,
      color: charPr.getAttribute('textColor') || '#000000',
      bold: Boolean(firstElement(charPr, 'bold')),
    });
  }
  return properties;
}

function readParaProperties(header) {
  const properties = new Map();
  for (const paraPr of elements(header, 'paraPr')) {
    const id = paraPr.getAttribute('id');
    const align = firstElement(paraPr, 'align');
    const margin = firstElement(paraPr, 'margin');
    const lineSpacing = firstElement(paraPr, 'lineSpacing');
    const valueOf = (name) => integerAttribute(firstElement(margin, name), 'value') || 0;
    properties.set(id, {
      sourceParaPrId: id,
      align: align?.getAttribute('horizontal') || null,
      marginLeftHwpUnit: valueOf('left'),
      firstLineIndentHwpUnit: valueOf('intent'),
      spaceBeforeHwpUnit: valueOf('prev'),
      spaceAfterHwpUnit: valueOf('next'),
      lineSpacingPercent: lineSpacing?.getAttribute('type') === 'PERCENT'
        ? integerAttribute(lineSpacing, 'value')
        : null,
    });
  }
  return properties;
}

function runStyle(paragraph, charProperties) {
  const runs = directChildren(paragraph, 'run');
  const run = runs.find((candidate) => nodeText(candidate)) || runs[0] || null;
  return charProperties.get(run?.getAttribute('charPrIDRef')) || null;
}

function paragraphLayout(paragraph, charProperties, paraProperties) {
  const paraPrId = paragraph.getAttribute('paraPrIDRef');
  return {
    kind: 'paragraph',
    paragraph: {
      ...(paraProperties.get(paraPrId) || { sourceParaPrId: paraPrId }),
      character: runStyle(paragraph, charProperties),
    },
  };
}

function cellLayout(cell, charProperties, paraProperties) {
  const paragraphs = elements(cell, 'p');
  const paragraph = paragraphs.find((candidate) => nodeText(candidate)) || paragraphs[0] || null;
  const size = firstElement(cell, 'cellSz');
  const margin = firstElement(cell, 'cellMargin');
  return {
    widthHwpUnit: integerAttribute(size, 'width'),
    heightHwpUnit: integerAttribute(size, 'height'),
    colSpan: integerAttribute(firstElement(cell, 'cellSpan'), 'colSpan') || 1,
    rowSpan: integerAttribute(firstElement(cell, 'cellSpan'), 'rowSpan') || 1,
    borderFillId: cell.getAttribute('borderFillIDRef') || null,
    margin: {
      leftHwpUnit: integerAttribute(margin, 'left') || 0,
      rightHwpUnit: integerAttribute(margin, 'right') || 0,
      topHwpUnit: integerAttribute(margin, 'top') || 0,
      bottomHwpUnit: integerAttribute(margin, 'bottom') || 0,
    },
    paragraph: paragraph ? paragraphLayout(paragraph, charProperties, paraProperties).paragraph : null,
  };
}

function tableLayout(table, charProperties, paraProperties) {
  const rows = elements(table, 'tr').map((row) =>
    directChildren(row, 'tc').map((cell) => cellLayout(cell, charProperties, paraProperties)));
  const size = firstElement(table, 'sz');
  const position = firstElement(table, 'pos');
  return {
    kind: 'table',
    table: {
      sourceTableId: table.getAttribute('id') || null,
      widthHwpUnit: integerAttribute(size, 'width'),
      heightHwpUnit: integerAttribute(size, 'height'),
      repeatHeader: table.getAttribute('repeatHeader') === '1',
      treatAsChar: position?.getAttribute('treatAsChar') === '1',
      columnWidthsHwpUnit: (rows[0] || []).map((cell) => cell.widthHwpUnit),
      rowHeightsHwpUnit: rows.map((row) => row[0]?.heightHwpUnit || null),
      headerStyle: rows[0]?.[0]?.paragraph?.character || null,
      bodyStyle: rows[1]?.[0]?.paragraph?.character || rows[0]?.[0]?.paragraph?.character || null,
      headerParagraph: rows[0]?.[0]?.paragraph || null,
      bodyParagraph: rows[1]?.[0]?.paragraph || rows[0]?.[0]?.paragraph || null,
      cellMargin: rows[0]?.[0]?.margin || null,
    },
  };
}

function sourceDescriptors(section, charProperties, paraProperties) {
  const descriptors = [];
  let hardPage = 1;
  for (const paragraph of directChildren(section, 'p')) {
    if (paragraph.getAttribute('pageBreak') === '1' && descriptors.length) hardPage += 1;
    const table = firstElement(paragraph, 'tbl');
    if (table) {
      descriptors.push({
        type: 'table',
        text: nodeText(table),
        hardPage,
        layout: tableLayout(table, charProperties, paraProperties),
      });
      continue;
    }
    const text = nodeText(paragraph);
    if (!text) continue;
    descriptors.push({
      type: 'paragraph',
      text,
      hardPage,
      layout: paragraphLayout(paragraph, charProperties, paraProperties),
    });
  }
  return { descriptors, hardPageCount: hardPage };
}

function blockText(block) {
  if (block?.type === 'table') {
    const cells = block.table?.cells || [];
    return cells.flat().map((cell) => cell?.text || '').join('');
  }
  return [block?.marker, block?.text].filter(Boolean).join(' ');
}

function descriptorType(block) {
  return block?.type === 'table' ? 'table' : 'paragraph';
}

function matchDescriptors(blocks, descriptors) {
  let cursor = 0;
  return blocks.map((block) => {
    if (block.type === 'image') return block;
    const wantedType = descriptorType(block);
    const wantedText = fingerprint(blockText(block));
    let matched = null;
    for (let index = cursor; index < descriptors.length; index += 1) {
      const candidate = descriptors[index];
      if (candidate.type !== wantedType) continue;
      const candidateText = fingerprint(candidate.text);
      if (candidateText === wantedText || candidateText.includes(wantedText) || wantedText.includes(candidateText)) {
        matched = candidate;
        cursor = index + 1;
        break;
      }
    }
    return matched ? { ...block, sourceHardPage: matched.hardPage, layout: matched.layout } : block;
  });
}

function extractHwpxLayout(source) {
  const archive = new AdmZip(source);
  const parser = new DOMParser();
  const header = parser.parseFromString(archive.readAsText('Contents/header.xml'), 'text/xml');
  const section = parser.parseFromString(archive.readAsText('Contents/section0.xml'), 'text/xml').documentElement;
  const fonts = readFonts(header);
  const charProperties = readCharProperties(header, fonts);
  const paraProperties = readParaProperties(header);
  const { descriptors, hardPageCount } = sourceDescriptors(section, charProperties, paraProperties);
  return {
    descriptors,
    hardPageCount,
    fontCount: fonts.size,
    characterStyleCount: charProperties.size,
    paragraphStyleCount: paraProperties.size,
  };
}

function isReviewNoteParagraph(paragraph) {
  if (paragraph?.getAttribute?.('paraPrIDRef') !== '12') return false;
  const text = nodeText(paragraph);
  return Boolean(text) && REVIEW_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

function stripReviewAnnotations(source) {
  const archive = new AdmZip(source);
  const parser = new DOMParser();
  const section = parser.parseFromString(archive.readAsText('Contents/section0.xml'), 'text/xml');
  const notes = elements(section, 'p').filter(isReviewNoteParagraph);
  if (!notes.length) return { buffer: source, count: 0 };
  for (const paragraph of notes) {
    if (paragraph.getAttribute('pageBreak') === '1') {
      for (const textNode of elements(paragraph, 't')) textNode.textContent = '';
      continue;
    }
    paragraph.parentNode?.removeChild(paragraph);
  }
  if (!notes.length) return { buffer: Buffer.isBuffer(source) ? source : Buffer.from(source), count: 0 };
  archive.updateFile(
    'Contents/section0.xml',
    Buffer.from(new XMLSerializer().serializeToString(section), 'utf8'),
  );
  return { buffer: archive.toBuffer(), count: notes.length };
}

function applyHwpxLayout(model, layout, physicalPageCount = null) {
  return {
    ...model,
    metadata: {
      ...model.metadata,
      sourceLayout: {
        hardPageCount: layout.hardPageCount,
        physicalPageCount: Number(physicalPageCount) || layout.hardPageCount,
        fontCount: layout.fontCount,
        characterStyleCount: layout.characterStyleCount,
        paragraphStyleCount: layout.paragraphStyleCount,
      },
    },
    blocks: matchDescriptors(model.blocks || [], layout.descriptors),
  };
}

module.exports = {
  applyHwpxLayout,
  extractHwpxLayout,
  fingerprint,
  matchDescriptors,
  stripReviewAnnotations,
};
