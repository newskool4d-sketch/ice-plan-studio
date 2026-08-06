const ROMAN_CHAPTER = /^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$/;
const NUMERIC_CHAPTER = /^\s*(\d+\.)\s*(?!\d)(.+)$/;
const TASK_SUBSECTION = /^\s*(\[?과제\s*\d+\s*-\s*\d+\]?[.]?)\s*(.+)$/;
const TASK_SECTION = /^\s*(\[?과제\s*\d+\]?[.]?)\s*(.+)$/;
const KOREAN_SUBHEADING = /^\s*([가-하]\.)\s*(.+)$/;

// 번호로 시작하는 일반 본문 문장이 구조 제목으로 오인되는 것을 막는 상한(공백 제외).
// model_to_hwpx.py NUMERIC_HEADING_MAX_TITLE_CHARS와 같은 값이어야 빠른 미리보기와
// HWPX 출력이 어긋나지 않는다.
const MAX_STRUCTURED_TITLE_CHARS = 20;

export function isPlausibleHeadingTitle(title) {
  const stripped = String(title || "").replace(/\s+/g, "");
  return stripped.length > 0 && stripped.length <= MAX_STRUCTURED_TITLE_CHARS;
}

export function classifyStructuredHeading(text, hintedKind = null) {
  const value = String(text || "");
  const normalizedHint = hintedKind === "chapter" || hintedKind === "numeric-chapter"
    ? "roman-chapter"
    : hintedKind;
  const candidates = [
    ["task-subsection", TASK_SUBSECTION],
    ["task-section", TASK_SECTION],
    ["roman-chapter", ROMAN_CHAPTER],
    ["roman-chapter", NUMERIC_CHAPTER],
    ["korean-subheading", KOREAN_SUBHEADING],
  ];
  for (const [kind, pattern] of candidates) {
    const match = pattern.exec(value);
    if (match && (!normalizedHint || normalizedHint === kind) && isPlausibleHeadingTitle(match[2])) {
      return { kind, label: match[1], title: match[2].trim() };
    }
  }
  return null;
}

export function classifyStructuredBlock(block) {
  return classifyStructuredHeading(block?.text, block?.headingKind);
}
