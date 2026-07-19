import { createDocumentModel, validateDocumentModel } from './documentModel.js';
import { inspectDocumentRules } from './ruleEngine.js';

const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const splitCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

export function parseMarkdown(input, { title = '' } = {}) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { flushParagraph(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() }); continue; }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      const header = splitCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitCells(lines[index])); index += 1; }
      index -= 1;
      blocks.push({ type: 'table', header, rows, layout: { treatAsChar: false, repeatHeader: true } });
      continue;
    }
    const list = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (list) { flushParagraph(); blocks.push({ type: 'listItem', ordered: /^\d/.test(list[1]), text: list[2].trim() }); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph();
  const model = validateDocumentModel(createDocumentModel({ title, blocks }));
  return { ...model, ruleFindings: inspectDocumentRules(model) };
}

