const ROMAN_CHAPTER = /^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$/;
const TASK_SUBSECTION = /^\s*(\[과제\s*\d+\s*-\s*\d+\])\s*(.+)$/;
const TASK_SECTION = /^\s*(\[과제\s*\d+\])\s*(.+)$/;

export function classifyStructuredHeading(text) {
  const value = String(text || "");
  const candidates = [
    ["task-subsection", TASK_SUBSECTION],
    ["task-section", TASK_SECTION],
    ["roman-chapter", ROMAN_CHAPTER],
  ];
  for (const [kind, pattern] of candidates) {
    const match = pattern.exec(value);
    if (match) return { kind, label: match[1], title: match[2].trim() };
  }
  return null;
}
