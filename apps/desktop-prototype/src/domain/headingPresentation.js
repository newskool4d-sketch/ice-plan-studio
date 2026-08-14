// 제목틀(표)은 로마숫자 장 전용이다(실물 양식 판정 2026-08-14). 아라비아 숫자
// 제목도 제목틀을 쓰던 때에는 MAX_STRUCTURED_TITLE_CHARS 상한 때문에 20자 이하만
// 표가 되어, 같은 문서에서 표와 평문이 갈렸다. model_to_hwpx.py의
// STRUCTURED_HEADING_PATTERNS와 같은 집합을 유지해야 한다.
const ROMAN_CHAPTER = /^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$/;
const TASK_SUBSECTION = /^\s*(\[?과제\s*\d+\s*-\s*\d+\]?[.]?)\s*(.+)$/;
const TASK_SECTION = /^\s*(\[?과제\s*\d+\]?[.]?)\s*(.+)$/;
// `[가-하]`는 유니코드 음절 1만여 자를 모두 포함해 평문까지 소제목으로 잡는다.
// 실제 가나다 항목기호로 쓰이는 14자만 허용한다(plan-ir.cjs와 같은 집합).
const KOREAN_SUBHEADING = /^\s*([가나다라마바사아자차카타파하]\.)\s*(.+)$/;

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
