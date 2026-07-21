const ITEM_MARKERS = ['□', '❍', '-', '·', '1.', '가.', '1)', '가)'];
const TEXT_BLOCK_TYPES = new Set(['heading', 'paragraph', 'listItem']);

function cloneModel(model) {
  return typeof structuredClone === 'function'
    ? structuredClone(model)
    : JSON.parse(JSON.stringify(model));
}

function targetKey(target) {
  if (target.kind === 'tableCell') return `table:${target.blockIndex}:${target.rowIndex}:${target.columnIndex}`;
  return `block:${target.blockIndex}:${target.field}`;
}

function finding({ code, title, severity = 'warning', message, kind = 'warning', target = null, before = null, after = null, evidence }) {
  return {
    id: `${code}:${target ? targetKey(target) : 'document'}`,
    code,
    title,
    severity,
    message,
    kind,
    action: kind === 'suggestion' ? 'replace' : 'warning',
    target,
    before,
    after,
    evidence,
  };
}

function textTargets(model) {
  const targets = [];
  for (const [blockIndex, block] of (model?.blocks || []).entries()) {
    if (TEXT_BLOCK_TYPES.has(block.type)) {
      targets.push({ target: { kind: 'blockField', blockIndex, field: 'text' }, text: String(block.text ?? ''), block });
      continue;
    }
    if (block.type !== 'table') continue;
    const cells = block.table?.cells;
    if (Array.isArray(cells)) {
      cells.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => targets.push({
        target: { kind: 'tableCell', blockIndex, rowIndex, columnIndex },
        text: String(cell?.text ?? ''),
        block,
      })));
      continue;
    }
    const rows = [block.header || [], ...(block.rows || [])];
    rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => targets.push({
      target: { kind: 'tableCell', blockIndex, rowIndex, columnIndex },
      text: String(cell ?? ''),
      block,
    })));
  }
  return targets;
}

function normalizeDates(text) {
  return text.replace(/\b(20\d{2})\s*(?:[./-]|년\s*)\s*(\d{1,2})\s*(?:[./-]|월\s*)\s*(\d{1,2})\s*(?:일)?\.?(?:\s*\(([월화수목금토일])\))?/g, (_match, year, month, day, weekday) =>
    `${year}. ${Number(month)}. ${Number(day)}.${weekday ? `(${weekday})` : ''}`);
}

function normalizeTimes(text) {
  return text.replace(/(?<!\d)(?:(오전|오후)\s*)?(\d{1,2})(?:\s*시(?:\s*(\d{1,2})\s*분?)?|:(\d{1,2}))(?!\d)/g, (_match, meridiem, hourValue, minuteWord, minuteColon) => {
    let hour = Number(hourValue);
    const minute = Number(minuteWord ?? minuteColon ?? 0);
    if (meridiem === '오후' && hour < 12) hour += 12;
    if (meridiem === '오전' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return _match;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });
}

function normalizeMoney(text) {
  return text.replace(/(?<![\d,])(\d{4,}|\d{1,3}(?:,\d{3})+)\s*원/g, (_match, amount) => {
    const digits = amount.replace(/,/g, '').replace(/^0+(?=\d)/, '');
    return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
  });
}

function normalizeTitleMarks(text) {
  return text.replace(/[“"]([^"”\n]{2,60})[”"]/g, '「$1」');
}

function normalizeTildes(text) {
  return text.replace(/\s*[~∼～〜]\s*/g, '~');
}

const TEXT_RULES = [
  { code: 'DATE-FORMAT', title: '날짜 표기', message: '날짜를 YYYY. M. D. 형식으로 표기합니다.', transform: normalizeDates },
  { code: 'TIME-FORMAT', title: '시간 표기', message: '시간을 24시각제 HH:MM 형식으로 표기합니다.', transform: normalizeTimes },
  { code: 'MONEY-FORMAT', title: '금액 표기', message: '금액에 천 단위 구분과 원 표기를 적용합니다.', transform: normalizeMoney },
  { code: 'TITLE-MARK', title: '낫표 표기', message: '법령·작품·책 이름 후보의 큰따옴표를 낫표로 바꿉니다.', transform: normalizeTitleMarks },
  { code: 'TILDE-FORMAT', title: '물결표 표기', message: '기간 범위의 물결표 문자와 양옆 공백을 통일합니다.', transform: normalizeTildes },
];

function addTextSuggestions(model, findings) {
  for (const { target, text } of textTargets(model)) {
    for (const rule of TEXT_RULES) {
      const after = rule.transform(text);
      if (after === text) continue;
      findings.push(finding({
        ...rule,
        kind: 'suggestion',
        target,
        before: text,
        after,
        evidence: '교육청 계획안 자동서식 구현계획 §12.1',
      }));
    }
  }
}

function addListSuggestions(model, findings) {
  const markers = Array.isArray(model?.metadata?.rules?.itemMarkers) && model.metadata.rules.itemMarkers.length
    ? model.metadata.rules.itemMarkers.slice(0, 8)
    : ITEM_MARKERS;
  for (const [blockIndex, block] of (model?.blocks || []).entries()) {
    if (block.type !== 'listItem') continue;
    const level = Number(block.level ?? 0);
    const normalizedLevel = Math.min(7, Math.max(0, Number.isFinite(level) ? Math.round(level) : 0));
    const expectedMarker = markers[normalizedLevel] || ITEM_MARKERS[normalizedLevel];
    if (block.marker !== expectedMarker) {
      findings.push(finding({
        code: 'LIST-MARKER',
        title: '항목기호 계열',
        message: `${normalizedLevel + 1}단계 항목기호를 현재 프로필 계열에 맞춥니다.`,
        kind: 'suggestion',
        target: { kind: 'blockField', blockIndex, field: 'marker' },
        before: block.marker || (block.ordered ? '1.' : '-'),
        after: expectedMarker,
        evidence: '기준선 분석 §2.4 · 8단계 항목기호',
      }));
    }
    if (level !== normalizedLevel) {
      findings.push(finding({
        code: 'LIST-INDENT',
        title: '하위 항목 들여쓰기',
        message: '항목 깊이를 2타 단위의 8단계 범위로 맞춥니다.',
        kind: 'suggestion',
        target: { kind: 'blockField', blockIndex, field: 'level' },
        before: level,
        after: normalizedLevel,
        evidence: '교육청 계획안 자동서식 구현계획 §12.1',
      }));
    }
  }
}

function canonicalTokens(targets, pattern) {
  return new Set(targets.flatMap(({ text }) => [...text.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ''))));
}

function addWarnings(model, findings) {
  const blocks = model?.blocks || [];
  const headings = blocks.filter((block) => block.type === 'heading');
  if (!headings.some((heading) => heading.level === 1)) {
    findings.push(finding({ code: 'TITLE-001', title: '문서 제목 누락', severity: 'error', message: '문서 제목(1단계 제목)이 없습니다.', evidence: '계획안 필수 구조' }));
  }
  if (blocks.length > 2 && !headings.some((heading) => (heading.level || 1) >= 2)) {
    findings.push(finding({ code: 'SECTION-001', title: '필수 섹션 검토', message: '본문의 장·절 구분이 없어 필수 섹션 누락 여부를 확인해야 합니다.', evidence: '교육청 계획안 자동서식 구현계획 §12.2' }));
  }

  const targets = textTargets(model);
  const ambiguous = targets.find(({ text }) => /(필요시|가능한 범위에서|적절히|추후 검토|상황에 따라)/.test(text));
  if (ambiguous) {
    findings.push(finding({
      code: 'AMBIGUOUS-001',
      title: '기준이 모호한 표현',
      message: '기준이나 조건이 불명확한 표현은 의미 변경 위험 때문에 자동 수정하지 않습니다.',
      target: ambiguous.target,
      before: ambiguous.text,
      evidence: '교육청 계획안 자동서식 구현계획 §12.2',
    }));
  }

  const bodyTargets = targets.filter(({ target }) => target.kind !== 'tableCell');
  const tableTargets = targets.filter(({ target }) => target.kind === 'tableCell');
  const bodyDates = canonicalTokens(bodyTargets, /20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\./g);
  const tableDates = canonicalTokens(tableTargets, /20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\./g);
  if (bodyDates.size && tableDates.size && ![...bodyDates].some((value) => tableDates.has(value))) {
    findings.push(finding({ code: 'DATE-CONSISTENCY', title: '날짜 일치 검토', message: '본문과 표에 서로 다른 날짜만 있어 일정 일치 여부를 확인해야 합니다.', evidence: '교육청 계획안 자동서식 구현계획 §12.2' }));
  }
  const bodyMoney = canonicalTokens(bodyTargets, /\d{1,3}(?:,\d{3})*원/g);
  const tableMoney = canonicalTokens(tableTargets, /\d{1,3}(?:,\d{3})*원/g);
  if (bodyMoney.size && tableMoney.size && ![...bodyMoney].some((value) => tableMoney.has(value))) {
    findings.push(finding({ code: 'MONEY-CONSISTENCY', title: '금액 일치 검토', message: '본문과 표의 금액이 일치하는지 확인해야 합니다.', evidence: '교육청 계획안 자동서식 구현계획 §12.2' }));
  }

  blocks.filter((block) => block.type === 'table').forEach((table, index) => {
    const layout = table.table
      ? { treatAsChar: table.table.treatAsChar, repeatHeader: table.table.repeatHeader }
      : table.layout;
    if (layout?.treatAsChar !== false) findings.push(finding({ code: `TABLE-${index + 1}`, title: '표 글자처럼 취급 설정', severity: 'error', message: '표를 글자처럼 취급할지 문서 맥락에 따라 확인해야 합니다.', target: { kind: 'blockField', blockIndex: blocks.indexOf(table), field: 'layout' }, evidence: '기준선 분석 §3.1' }));
    if (layout?.repeatHeader !== true) findings.push(finding({ code: `TABLE-HEADER-${index + 1}`, title: '표 머리글 반복 미설정', message: '여러 쪽 표의 머리글 반복 여부를 확인해야 합니다.', target: { kind: 'blockField', blockIndex: blocks.indexOf(table), field: 'layout' }, evidence: '기준선 분석 §3.1' }));
  });
}

export function inspectDocumentRules(model) {
  const findings = [];
  addTextSuggestions(model, findings);
  addListSuggestions(model, findings);
  addWarnings(model, findings);
  return findings;
}

function readTarget(model, target) {
  const block = model.blocks[target.blockIndex];
  if (target.kind === 'blockField') {
    if (target.field === 'marker' && (block?.marker === undefined || block?.marker === null || block.marker === '')) {
      return block?.ordered ? '1.' : '-';
    }
    return block?.[target.field];
  }
  return block?.table?.cells?.[target.rowIndex]?.[target.columnIndex]?.text
    ?? (target.rowIndex === 0 ? block?.header?.[target.columnIndex] : block?.rows?.[target.rowIndex - 1]?.[target.columnIndex]);
}

function writeTarget(model, target, value) {
  const block = model.blocks[target.blockIndex];
  if (target.kind === 'blockField') {
    block[target.field] = value;
    return;
  }
  if (block.table?.cells?.[target.rowIndex]?.[target.columnIndex]) block.table.cells[target.rowIndex][target.columnIndex].text = value;
  if (target.rowIndex === 0 && Array.isArray(block.header)) block.header[target.columnIndex] = value;
  if (target.rowIndex > 0 && Array.isArray(block.rows?.[target.rowIndex - 1])) block.rows[target.rowIndex - 1][target.columnIndex] = value;
}

export function applyRuleSuggestion(model, ruleFinding) {
  if (ruleFinding?.kind !== 'suggestion' || ruleFinding.action !== 'replace' || !ruleFinding.target) {
    throw new Error('적용 가능한 규칙 제안이 아닙니다.');
  }
  const current = readTarget(model, ruleFinding.target);
  if (current !== ruleFinding.before) throw new Error('원문이 변경되어 제안을 다시 계산해야 합니다.');
  const next = cloneModel(model);
  writeTarget(next, ruleFinding.target, ruleFinding.after);
  const edit = {
    id: ruleFinding.id,
    code: ruleFinding.code,
    target: ruleFinding.target,
    before: ruleFinding.before,
    after: ruleFinding.after,
    status: 'approved',
  };
  next.approval = {
    ...(next.approval || {}),
    status: 'partially-approved',
    edits: [...(next.approval?.edits || []), edit],
  };
  delete next.ruleFindings;
  return { model: next, edit };
}

export function applyAllRuleSuggestions(model, { excludeIds = [] } = {}) {
  let current = cloneModel(model);
  const edits = [];
  const excluded = new Set(excludeIds);
  for (let count = 0; count < 1000; count += 1) {
    const suggestion = inspectDocumentRules(current).find((item) => item.kind === 'suggestion' && !excluded.has(item.id));
    if (!suggestion) return { model: current, edits };
    const applied = applyRuleSuggestion(current, suggestion);
    current = applied.model;
    edits.push(applied.edit);
  }
  throw new Error('규칙 제안 적용 횟수가 안전 한도를 초과했습니다.');
}

export { ITEM_MARKERS };
