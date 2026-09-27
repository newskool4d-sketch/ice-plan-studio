// 항목 위계·간격 조판 규칙 (V4, 2026-09-27 한글 PDF 실측 후속).
//
// 블록마다 조판 주석(역할·표시 단계·기호·내어쓰기·위 간격·다음 문단과 함께·줄간격)을
// 붙인다. 빠른 미리보기(PlanPreview)와 HWPX(scripts/item_layout.py)가 같은 결과를 내야
// 한다 — 쌍둥이 규칙이며 verify-item-layout 게이트가 둘을 대조한다.
//
// - 서술형 제목(마침표·'함/음/됨/임'으로 끝남)은 제목이 아니라 항목으로 조판한다.
//   길이는 기준이 아니다 — 번호 제목은 길이와 무관하게 같게 조판한다(2026-08-14 판정).
// - 기호 시작 위치는 사용자 샘플의 칸 수(1.=0·가.=1·1)=3·가)=4·①=6·㉮=7칸), 둘째 줄은 내용 첫 글자에 맞춘다.
import layoutTokens from "../../scripts/layout-tokens.json" with { type: "json" };
import { classifyStructuredHeading } from "./headingPresentation.js";

const ITEM = layoutTokens.itemLayout;
// `[가-하]`는 음절 1만여 자를 포함하므로 실제 항목기호 14자만 쓴다(headingPresentation.js와 같은 집합).
const KOREAN = "가나다라마바사아자차카타파하";
const LABEL = new RegExp(`^\\s*(\\d+\\.|[${KOREAN}]\\.|\\d+\\)|[${KOREAN}]\\)|\\(\\d+\\)|\\([${KOREAN}]\\)|[①-⑮]|[㉮-㉻])\\s*(.+)$`);
// 서술형 제목이 항목이 될 때의 단계 — 사용자 샘플 순서(1. 가. 1) 가) ① ㉮). 샘플은 가) 다음을
// ①로 두므로 ①·㉮는 4·5단계이고, 샘플에 없는 (1)·(가)도 같은 4·5단계 자리에 둔다.
const CANONICAL_LEVELS = [
  [/^\d+\.$/, 0],
  [new RegExp(`^[${KOREAN}]\\.$`), 1],
  [/^\d+\)$/, 2],
  [new RegExp(`^[${KOREAN}]\\)$`), 3],
  [/^\(\d+\)$/, 4],
  [new RegExp(`^\\([${KOREAN}]\\)$`), 5],
  [/^[①-⑮]$/, 4],
  [/^[㉮-㉻]$/, 5],
];
const SENTENCE_END = /(?:\.|[함음됨임])$/;
const FRAME_KINDS = new Set(["roman-chapter", "task-section", "task-subsection"]);

export function splitLabel(text) {
  const match = LABEL.exec(String(text ?? ""));
  return match ? { label: match[1], title: match[2].trim() } : null;
}

export function isSentenceTitle(title) {
  return SENTENCE_END.test(String(title ?? "").replace(/[\s*]+$/, ""));
}

function glyphWidth(character) {
  const widths = ITEM.glyphWidthHwpUnit;
  if (/\d/.test(character)) return widths.digit;
  if (character === "(") return widths.paren;
  if (".)·,*".includes(character)) return widths.punct;
  if ("-−–—".includes(character)) return widths.dash;
  return widths.full;
}

// 단계별 기호 시작 위치(HWPUNIT) = 샘플 칸 수 × 반각 공백 폭
export function indentPosition(level) {
  const halfSpaces = ITEM.levelIndentHalfSpaces;
  return halfSpaces[Math.min(Math.max(level, 0), halfSpaces.length - 1)] * ITEM.glyphWidthHwpUnit.space;
}

export function markerHang(marker) {
  return [...String(marker)].reduce((sum, character) => sum + glyphWidth(character), 0) + ITEM.glyphWidthHwpUnit.space;
}

function canonicalLevel(label) {
  return (CANONICAL_LEVELS.find(([pattern]) => pattern.test(label)) || [null, 0])[1];
}

// 빠른 미리보기용 인라인 스타일 — HWPX 문단 속성과 같은 값. HWPX는 첫 줄을 왼여백(단계 칸 위치)에,
// 둘째 줄부터 내어쓰기(기호+공백 폭)만큼 더 들여 쓰므로 CSS로는 padding-left=둘째 줄 위치,
// text-indent=−내어쓰기가 된다. 아래 여백은 HWPX와 같이 0.
export function noteStyle(note) {
  const pt = (hwpUnit) => `${hwpUnit / 100}pt`;
  const style = { margin: `${pt(note?.prev || 0)} 0 0` };
  if (note?.lineSpacing) style.lineHeight = note.lineSpacing / 100;
  if (["item", "heading1", "heading2"].includes(note?.role)) {
    style.paddingLeft = pt(indentPosition(note.level) + note.hang);
    style.textIndent = pt(-note.hang);
  }
  return style;
}

export function layoutBlocks(blocks) {
  const prev = ITEM.prevHwpUnit;
  const lineSpacing = ITEM.lineSpacingPercent;
  let base = 0;
  let runReference = null;
  let keepRun = 0;
  const item = (level, marker, text) => ({
    role: "item", level, marker, text, hang: markerHang(marker),
    prev: level === 0 ? prev.topItem : prev.nestedItem, keep: false, lineSpacing: lineSpacing.item,
  });
  const heading = (role, level, marker, text) => ({
    role, level, marker, text, hang: marker ? markerHang(marker) : 0,
    prev: role === "heading1" ? prev.numberedHeading : prev.koreanSubheading, keep: true, lineSpacing: lineSpacing.heading,
  });
  const annotate = (block) => {
    const text = String(block?.text ?? "");
    if (block?.type === "table") return { role: "table", level: 0, prev: 0, keep: false, lineSpacing: null };
    if (block?.type === "paragraph") {
      return block.blockquote
        ? { role: "quote", level: 0, prev: 0, keep: false, lineSpacing: null }
        : { role: "body", level: 0, prev: 0, keep: false, lineSpacing: lineSpacing.item };
    }
    if (block?.type === "listItem") {
      const parserLevel = Number(block.level) || 0;
      if (runReference === null) runReference = parserLevel;
      const level = Math.min(ITEM.maxDisplayLevel, base + Math.max(0, parserLevel - runReference));
      return item(level, block.marker || (block.ordered ? "1." : "-"), text);
    }
    if (block?.type !== "heading") return { role: "body", level: 0, prev: 0, keep: false, lineSpacing: lineSpacing.item };
    const frame = classifyStructuredHeading(text);
    if (frame && FRAME_KINDS.has(frame.kind)) {
      base = 0;
      runReference = null;
      const roman = frame.kind === "roman-chapter";
      return { role: "frame", level: 0, prev: roman ? prev.chapter : 0, keep: roman, lineSpacing: null };
    }
    runReference = null;
    const labeled = splitLabel(text);
    if (labeled && isSentenceTitle(labeled.title)) {
      const level = canonicalLevel(labeled.label);
      base = level + 1;
      return item(level, labeled.label, labeled.title);
    }
    if (labeled) {
      const numbered = /^\d+\.$/.test(labeled.label);
      base = numbered ? 1 : 2;
      return heading(numbered ? "heading1" : "heading2", numbered ? 0 : 1, labeled.label, text);
    }
    if ((Number(block.level) || 1) <= 1) {
      base = 0;
      return { role: "heading", level: 0, prev: 0, keep: false, lineSpacing: null };
    }
    const shallow = (Number(block.level) || 1) <= 3;
    base = shallow ? 1 : 2;
    return heading(shallow ? "heading1" : "heading2", shallow ? 0 : 1, null, text);
  };
  return (blocks || []).map((block) => {
    const annotation = annotate(block);
    if (annotation.keep) {
      keepRun += 1;
      if (keepRun > ITEM.maxKeepWithNextChain) {
        annotation.keep = false;
        keepRun = 0;
      }
    } else {
      keepRun = 0;
    }
    return annotation;
  });
}
