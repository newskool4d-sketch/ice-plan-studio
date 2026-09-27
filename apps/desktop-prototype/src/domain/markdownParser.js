import { createDocumentModel, validateDocumentModel } from './documentModel.js';
import { inspectDocumentRules } from './ruleEngine.js';

// 1열 표와 현장 Markdown에서 쓰는 축약 정렬 구분선(`| :-: |`)도 인식한다.
// 파이프가 전혀 없는 순수 "---"(수평선)는 표로 오인하지 않도록 제외한다.
const isTableSeparator = (line) => {
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
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
};

// 공문서 항목기호(시행규칙 제2조①: 1. 가. 1) 가) (1) (가) ① ㉮)와 특수기호 — plan-ir.cjs와 같은 집합(V4 G-1).
const LIST_MARKER_KOREAN = '가나다라마바사아자차카타파하';
const LIST_LINE = new RegExp(`^(\\s*)((?:[-*]|\\d+[.)]|\\(\\d+\\)|[${LIST_MARKER_KOREAN}][.)]|\\([${LIST_MARKER_KOREAN}]\\)|[①-⑮]|[㉮-㉻]|[□○❍▪■◈❖◎◦￭∙ㆍ])\\s+)\\s*(.+)$`);
const ORDERED_MARKER = new RegExp(`^(?:\\d+[.)]|\\(\\d+\\)|[${LIST_MARKER_KOREAN}][.)]|\\([${LIST_MARKER_KOREAN}]\\)|[①-⑮]|[㉮-㉻])$`);

// 들여쓰기 폭 2 = 1단계. 전각 공백은 2타라 폭 2로 센다(plan-ir.cjs listIndentLevel과 같은 규칙).
function indentWidth(indent) {
  return [...indent].reduce((sum, character) => sum + (character === '　' ? 2 : character === '\t' ? 4 : 1), 0);
}

function listIndentLevel(indent) {
  return Math.floor(indentWidth(indent) / 2);
}

// 항목 바로 아래 항목보다 깊게 들여쓴 줄만 그 항목의 이어지는 줄로 합친다(plan-ir.cjs와 같은 규칙 —
// 들여쓰지 않은 줄은 새 문단, 코드 울타리·구분선·인용은 이어지는 줄이 아님).
const NOT_CONTINUATION = /^\s*(?:```|~~~|>|(?:[-*_]\s*){3,}$)/;

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

  let openItem = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { flushParagraph(); openItem = null; continue; }
    const blockquote = /^\s*>\s?(.*)$/.exec(line);
    if (blockquote) {
      flushParagraph();
      openItem = null;
      blocks.push({ type: 'paragraph', blockquote: true, text: blockquote[1].trim() });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); openItem = null; blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() }); continue; }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      openItem = null;
      const header = splitCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitCells(lines[index])); index += 1; }
      index -= 1;
      blocks.push({ type: 'table', header, rows, layout: { treatAsChar: false, repeatHeader: true } });
      continue;
    }
    // electron/plan-ir.cjs와 동일한 마커 집합·들여쓰기 폭 규칙을 쓴다. 과거엔 -·*·숫자만
    // 인식해 공문 불릿(□ ○ ❍ 등)이 문단으로 병합됐고, 그 결과 항목기호 규칙·
    // 팔레트가 전혀 동작하지 않았다(Electron 38이 File.path를 제거해 앱이 이
    // 렌더러 파서로 폴백하므로 실사용 경로임). 마커도 함께 보존한다.
    const list = LIST_LINE.exec(line);
    if (list) {
      flushParagraph();
      const marker = list[2].trim();
      const block = { type: 'listItem', marker, ordered: ORDERED_MARKER.test(marker), level: listIndentLevel(list[1]), text: list[3].trim() };
      blocks.push(block);
      openItem = { block, width: indentWidth(list[1]) };
      continue;
    }
    if (openItem && indentWidth(/^\s*/.exec(line)[0]) > openItem.width && !NOT_CONTINUATION.test(line)) {
      openItem.block.text = `${openItem.block.text} ${line.trim()}`;
      continue;
    }
    openItem = null;
    paragraph.push(line.trim());
  }
  flushParagraph();
  const model = validateDocumentModel(createDocumentModel({ title, blocks }));
  return { ...model, ruleFindings: inspectDocumentRules(model) };
}
