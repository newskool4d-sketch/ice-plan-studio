import { createDocumentModel, validateDocumentModel } from './documentModel.js';
import { inspectDocumentRules } from './ruleEngine.js';

// `(...)+`(1회 이상)는 최소 2열을 요구해 1열 표 구분선(`| --- |`)을 인식하지
// 못했다(electron/plan-ir.cjs에서 고친 것과 동일한 결함). `*`로 바꾸되, 파이프가
// 전혀 없는 순수 "---"(수평선)를 표로 오인하지 않도록 파이프 포함을 별도 요구한다.
const isTableSeparator = (line) => {
  const trimmed = line.trim();
  return trimmed.includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(trimmed);
};

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

