export const DOCUMENT_SCHEMA_VERSION = '0.1';

export function createDocumentModel({ title = '', blocks = [], metadata = {} } = {}) {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: { title, ...metadata },
    styles: {
      coverTitle: { fontFamily: '맑은 고딕', fontSizePt: 22, charPrId: '7' },
      heading: { fontFamily: '맑은 고딕', fontSizePt: 16, charPrId: '7' },
      body: { fontFamily: '맑은 고딕', fontSizePt: 11, charPrId: '38' },
      tableHeader: { fontFamily: '맑은 고딕', fontSizePt: 12, bold: true, charPrId: '513', charSpacingPercent: 0, lineSpacingPercent: 160 },
      tableBody: { fontFamily: '맑은 고딕', fontSizePt: 12, charPrId: '514', charSpacingPercent: 0, lineSpacingPercent: 160 },
      paragraph: { lineSpacingPercent: 160, bodyParaPrId: '4', headingParaPrId: '20', firstLineIndentHwpUnit: 0, hangingIndentHwpUnit: 0, charSpacingPercent: 0 },
    },
    layout: {
      page: 'A4',
      table: {
        treatAsChar: false,
        repeatHeader: true,
        splitAcrossPages: true,
        overflowStrategy: ['semantic-width', 'wrap', 'shrink', 'split-proposal'],
      },
    },
    blocks,
  };
}

export function validateDocumentModel(model) {
  if (!model || model.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported document model schema: ${model?.schemaVersion ?? 'missing'}`);
  }
  if (!Array.isArray(model.blocks)) throw new Error('Document blocks must be an array');
  for (const [index, block] of model.blocks.entries()) {
    if (!block || typeof block.type !== 'string') throw new Error(`Block ${index} has no type`);
    if (block.type === 'table' && !Array.isArray(block.rows)) throw new Error(`Table ${index} has no rows`);
  }
  return model;
}


