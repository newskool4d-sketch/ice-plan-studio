const ITEM_MARKERS = ['□', '❍', '-', '·', '1.', '가.', '1)', '가)'];
const TEXT_BLOCK_TYPES = new Set(['heading', 'paragraph', 'listItem']);

function cloneModel(model) {
  return typeof structuredClone === 'function'
    ? structuredClone(model)
    : JSON.parse(JSON.stringify(model));
}

function targetKey(target) {
  if (target.kind === 'tableCell') return `table:${target.blockIndex}:${target.rowIndex}:${target.columnIndex}`;
  if (target.kind === 'pageTableCell') {
    return `page:${target.pageIndex}:table:${target.blockIndex}:${target.rowIndex}:${target.columnIndex}`;
  }
  if (target.kind === 'pageBlockField') {
    return `page:${target.pageIndex}:block:${target.blockIndex}:${target.field}`;
  }
  if (target.kind === 'metadataField') return `metadata:${target.path}`;
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

function documentBlockScopes(model) {
  const plannedPages = Array.isArray(model?.metadata?.pages) ? model.metadata.pages : null;
  const pageScopes = (plannedPages || [])
    .map((page, pageIndex) => ({
      kind: 'page',
      pageIndex,
      blocks: Array.isArray(page?.blocks) ? page.blocks : [],
    }))
    .filter((scope) => scope.blocks.length);
  if (plannedPages?.length) return pageScopes;
  const rootBlocks = Array.isArray(model?.blocks) ? model.blocks : [];
  return rootBlocks.length ? [{ kind: 'root', blocks: rootBlocks }] : [];
}

function blockFieldTarget(scope, blockIndex, field) {
  return scope.kind === 'page'
    ? { kind: 'pageBlockField', pageIndex: scope.pageIndex, blockIndex, field }
    : { kind: 'blockField', blockIndex, field };
}

function tableCellTarget(scope, blockIndex, rowIndex, columnIndex) {
  return scope.kind === 'page'
    ? { kind: 'pageTableCell', pageIndex: scope.pageIndex, blockIndex, rowIndex, columnIndex }
    : { kind: 'tableCell', blockIndex, rowIndex, columnIndex };
}

function textTargets(model) {
  const targets = [];
  for (const scope of documentBlockScopes(model)) {
    for (const [blockIndex, block] of scope.blocks.entries()) {
      if (TEXT_BLOCK_TYPES.has(block.type)) {
        targets.push({
          target: blockFieldTarget(scope, blockIndex, 'text'),
          text: String(block.text ?? ''),
          block,
        });
        continue;
      }
      if (block.type !== 'table') continue;
      const cells = block.table?.cells;
      if (Array.isArray(cells)) {
        cells.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => targets.push({
          target: tableCellTarget(scope, blockIndex, rowIndex, columnIndex),
          text: String(cell?.text ?? ''),
          block,
        })));
        continue;
      }
      const rows = [block.header || [], ...(block.rows || [])];
      rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => targets.push({
        target: tableCellTarget(scope, blockIndex, rowIndex, columnIndex),
        text: String(cell ?? ''),
        block,
      })));
    }
  }
  return targets;
}

function warningTextTargets(model) {
  const targets = textTargets(model);
  const cover = model?.metadata?.cover;
  if (!cover || typeof cover !== 'object') return targets;
  for (const field of ['title', 'subtitle', 'direction', 'displayName']) {
    if (typeof cover[field] !== 'string' || !cover[field]) continue;
    targets.push({
      target: { kind: 'metadataField', path: `cover.${field}` },
      text: cover[field],
      block: null,
    });
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

// 관용 장 구조(사용자 실무 지침, 2026-07-21): 장 제목이 근거·목적·방침·배경
// 계열이면 그 하위 최상위 목록의 관용 기본 기호는 ○다. 위치(Ⅰ~Ⅲ)가 아니라
// 제목 내용으로 판정한다. 키워드는 조정 가능하도록 상수로 분리(계획 §B 키워드
// 확정 절차) — '추진 근거'·'사업 목적' 등 접두/수식이 붙어도 포함 매칭.
const CONVENTION_CHAPTER_KEYWORDS = ['근거', '목적', '방침', '배경'];
const CONVENTION_TOP_MARKER = '○';
const CONFUSABLE_MARKER_FAMILIES = [
  ['○', '❍', '◦'],
  ['-', '−', '–', '—'],
  ['·', 'ㆍ', '∙'],
];
const RESIDUAL_TEXT_WARNINGS = [
  {
    code: 'PLACEHOLDER-RESIDUAL',
    title: '입력 대기 문구 잔존',
    phrase: '내용 입력 대기',
    message: '초안용 입력 대기 문구가 남아 있습니다. 실제 본문 누락 여부를 확인해야 하며 자동 수정하지 않습니다.',
  },
  {
    code: 'WRONG-TEMPLATE-PHRASE',
    title: '다른 계획안 문구 잔존',
    phrase: '인천을 품고 세계로 나아가는 글로벌 인재 양성',
    message: '현재 계획과 무관한 다른 계획안의 문구가 남아 있습니다. 문서 맥락을 확인한 뒤 담당자가 삭제 여부를 결정해야 합니다.',
  },
];

function normalizeListLevel(level) {
  const value = Number(level ?? 0);
  return Math.min(7, Math.max(0, Number.isFinite(value) ? Math.round(value) : 0));
}

function confusableMarkerMixes(blocks) {
  const markerSetsByLevel = new Map();
  blocks.filter((block) => block.type === 'listItem').forEach((block) => {
    const level = normalizeListLevel(block.level);
    const marker = String(block.marker || '').trim();
    if (!marker) return;
    if (!markerSetsByLevel.has(level)) markerSetsByLevel.set(level, new Set());
    markerSetsByLevel.get(level).add(marker);
  });

  const mixes = [];
  for (const [level, markers] of markerSetsByLevel) {
    for (const family of CONFUSABLE_MARKER_FAMILIES) {
      const usedMarkers = family.filter((marker) => markers.has(marker));
      if (usedMarkers.length > 1) mixes.push({ level, usedMarkers });
    }
  }
  return mixes;
}

function isConventionChapter(headingText) {
  const text = String(headingText || '');
  return CONVENTION_CHAPTER_KEYWORDS.some((keyword) => text.includes(keyword));
}

function addListSuggestions(model, findings) {
  const markers = Array.isArray(model?.metadata?.rules?.itemMarkers) && model.metadata.rules.itemMarkers.length
    ? model.metadata.rules.itemMarkers.slice(0, 8)
    : ITEM_MARKERS;
  const scopes = documentBlockScopes(model);
  const reviewOnlyMarkersByLevel = new Map();
  for (const { level, usedMarkers } of confusableMarkerMixes(scopes.flatMap((scope) => scope.blocks))) {
    if (!reviewOnlyMarkersByLevel.has(level)) reviewOnlyMarkersByLevel.set(level, new Set());
    usedMarkers.forEach((marker) => reviewOnlyMarkersByLevel.get(level).add(marker));
  }
  for (const scope of scopes) {
    const blocks = scope.blocks;
    // 각 목록 항목을 지배하는 직전 heading이 관용 장인지, 직전 목록 항목의
    // 정규화 레벨은 얼마인지 추적한다(위계 건너뜀 검출용). heading을 만나면
    // 새 장이므로 위계 문맥을 초기화한다.
    let underConventionChapter = false;
    let prevListLevel = -1;
    for (const [blockIndex, block] of blocks.entries()) {
      if (block.type === 'heading') {
        underConventionChapter = isConventionChapter(block.text);
        prevListLevel = -1;
        continue;
      }
      if (block.type !== 'listItem') continue;
      const level = Number(block.level ?? 0);
      const normalizedLevel = normalizeListLevel(level);
      // 관용 장 하위의 최상위(level 0) 목록은 관용 기호 ○를 기본값으로 덮어쓴다.
      // 팔레트 규칙과 별도 제안이 아니라 여기서 기대 기호만 바꿔, 한 항목에
      // 상충하는 제안이 두 개 생기지 않게 한다(강제 아닌 suggestion — LIST-MARKER).
      const expectedMarker = (underConventionChapter && normalizedLevel === 0)
        ? CONVENTION_TOP_MARKER
        : (markers[normalizedLevel] || ITEM_MARKERS[normalizedLevel]);
      const isReviewOnlyMarker = reviewOnlyMarkersByLevel.get(normalizedLevel)?.has(String(block.marker || '').trim());
      if (block.marker !== expectedMarker && !isReviewOnlyMarker) {
        findings.push(finding({
          code: 'LIST-MARKER',
          title: '항목기호 계열',
          message: `${normalizedLevel + 1}단계 항목기호를 현재 프로필 계열에 맞춥니다.`,
          kind: 'suggestion',
          target: blockFieldTarget(scope, blockIndex, 'marker'),
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
          target: blockFieldTarget(scope, blockIndex, 'level'),
          before: level,
          after: normalizedLevel,
          evidence: '교육청 계획안 자동서식 구현계획 §12.1',
        }));
      }
      // 위계 건너뜀: 직전 목록 항목보다 깊이가 2단계 이상 뛰면(예: 0단계 다음
      // 바로 2단계) 위계가 어긋난 것 — 직전+1단계로 낮추도록 제안한다. 얕아지는
      // 방향(레벨 감소)은 정상적인 목록 종료이므로 대상이 아니다.
      if (prevListLevel >= 0 && normalizedLevel > prevListLevel + 1) {
        const suggestedLevel = prevListLevel + 1;
        findings.push(finding({
          code: 'LIST-HIERARCHY',
          title: '항목 위계 건너뜀',
          message: `상위 항목이 없는데 ${normalizedLevel + 1}단계로 건너뛰었습니다. ${suggestedLevel + 1}단계로 맞춥니다.`,
          kind: 'suggestion',
          target: blockFieldTarget(scope, blockIndex, 'level'),
          before: normalizedLevel,
          after: suggestedLevel,
          evidence: '공문서 항목 위계 · 8단계 항목기호',
        }));
        prevListLevel = suggestedLevel;
      } else {
        prevListLevel = normalizedLevel;
      }
    }
  }
}

function canonicalTokens(targets, pattern) {
  return new Set(targets.flatMap(({ text }) => [...text.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ''))));
}

function addWarnings(model, findings) {
  const scopes = documentBlockScopes(model);
  const blocks = scopes.flatMap((scope) => scope.blocks);
  const headings = blocks.filter((block) => block.type === 'heading');
  if (!headings.some((heading) => heading.level === 1)) {
    findings.push(finding({ code: 'TITLE-001', title: '문서 제목 누락', severity: 'error', message: '문서 제목(1단계 제목)이 없습니다.', evidence: '계획안 필수 구조' }));
  }
  if (blocks.length > 2 && !headings.some((heading) => (heading.level || 1) >= 2)) {
    findings.push(finding({ code: 'SECTION-001', title: '필수 섹션 검토', message: '본문의 장·절 구분이 없어 필수 섹션 누락 여부를 확인해야 합니다.', evidence: '교육청 계획안 자동서식 구현계획 §12.2' }));
  }

  const blockTargets = textTargets(model);
  const targets = warningTextTargets(model);
  for (const residual of RESIDUAL_TEXT_WARNINGS) {
    for (const { target, text } of targets.filter(({ text }) => text.includes(residual.phrase))) {
      findings.push(finding({
        code: residual.code,
        title: residual.title,
        message: residual.message,
        target,
        before: text,
        evidence: `계획안 템플릿 잔존 문구 점검 · "${residual.phrase}"`,
      }));
    }
  }

  const mixedMarkerDetails = confusableMarkerMixes(blocks)
    .map(({ level, usedMarkers }) => `${level + 1}단계 ${usedMarkers.join('·')}`);
  if (mixedMarkerDetails.length) {
    findings.push(finding({
      code: 'MIXED-BULLET-MARKER',
      title: '유사 불릿 기호 혼용',
      message: `같은 항목 단계에서 모양이 유사한 불릿 기호가 혼용되었습니다(${mixedMarkerDetails.join(', ')}). 의도된 구분인지 확인해야 하며 자동 수정하지 않습니다.`,
      evidence: '공문서 항목 표시 일관성 점검',
    }));
  }

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

  const bodyTargets = blockTargets.filter(({ target }) => !['tableCell', 'pageTableCell'].includes(target.kind));
  const tableTargets = blockTargets.filter(({ target }) => ['tableCell', 'pageTableCell'].includes(target.kind));
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

  scopes.forEach((scope) => scope.blocks.filter((block) => block.type === 'table').forEach((table, index) => {
    const blockIndex = scope.blocks.indexOf(table);
    const layout = table.table
      ? { treatAsChar: table.table.treatAsChar, repeatHeader: table.table.repeatHeader }
      : table.layout;
    if (layout?.treatAsChar !== false) findings.push(finding({ code: `TABLE-${scope.kind}-${scope.pageIndex ?? 0}-${index + 1}`, title: '표 글자처럼 취급 설정', severity: 'error', message: '표를 글자처럼 취급할지 문서 맥락에 따라 확인해야 합니다.', target: blockFieldTarget(scope, blockIndex, 'layout'), evidence: '기준선 분석 §3.1' }));
    if (layout?.repeatHeader !== true) findings.push(finding({ code: `TABLE-HEADER-${scope.kind}-${scope.pageIndex ?? 0}-${index + 1}`, title: '표 머리글 반복 미설정', message: '여러 쪽 표의 머리글 반복 여부를 확인해야 합니다.', target: blockFieldTarget(scope, blockIndex, 'layout'), evidence: '기준선 분석 §3.1' }));
  }));
}

export function inspectDocumentRules(model) {
  const findings = [];
  addTextSuggestions(model, findings);
  addListSuggestions(model, findings);
  addWarnings(model, findings);
  return findings;
}

function readTarget(model, target) {
  const block = target.kind.startsWith('page')
    ? model.metadata.pages[target.pageIndex].blocks[target.blockIndex]
    : model.blocks[target.blockIndex];
  if (target.kind === 'blockField' || target.kind === 'pageBlockField') {
    if (target.field === 'marker' && (block?.marker === undefined || block?.marker === null || block.marker === '')) {
      return block?.ordered ? '1.' : '-';
    }
    return block?.[target.field];
  }
  return block?.table?.cells?.[target.rowIndex]?.[target.columnIndex]?.text
    ?? (target.rowIndex === 0 ? block?.header?.[target.columnIndex] : block?.rows?.[target.rowIndex - 1]?.[target.columnIndex]);
}

function writeTarget(model, target, value) {
  const block = target.kind.startsWith('page')
    ? model.metadata.pages[target.pageIndex].blocks[target.blockIndex]
    : model.blocks[target.blockIndex];
  if (target.kind === 'blockField' || target.kind === 'pageBlockField') {
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

// 불릿 팔레트 (8단계) — 구조편집 단계에서 문서 마커 계열을 선택하면
// metadata.rules.itemMarkers로 저장돼 addListSuggestions가 소비한다.
// markers 배열은 1단계(level 0)부터 순서대로 최대 8단계. 기본형을 뺀
// 나머지는 회귀 corpus(reference A~G)에서 실제 관측된 계열을 근거로 한다
// (BASELINE_ANALYSIS·regression-corpus). 임의 창작 아님.
const BULLET_PALETTES = [
  { id: 'default', label: '기본형 (□ ❍ - ·)', markers: [...ITEM_MARKERS] },
  { id: 'square-a', label: '네모형 A (■ □ ❍ − ·)', markers: ['■', '□', '❍', '−', '·', '가.', '1)', '가)'] },
  { id: 'circle-conv', label: '원형 (❍ − ㆍ)', markers: ['❍', '−', 'ㆍ', '·', '1.', '가.', '1)', '가)'] },
  { id: 'diamond-d', label: '마름모형 (◈ □ ❍ − ∙)', markers: ['◈', '□', '❍', '−', '∙', '가.', '1)', '가)'] },
  { id: 'double-g', label: '겹동그라미형 (◎ ◦ − 1. 가.)', markers: ['◎', '◦', '−', '1.', '가.', '1)', '가)', '(1)'] },
];

export { ITEM_MARKERS, BULLET_PALETTES };
