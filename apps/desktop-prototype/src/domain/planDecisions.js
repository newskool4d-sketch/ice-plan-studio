export const DOCUMENT_KINDS = [
  { value: "school-guidance-basic-plan", label: "학교 배포용 기본계획" },
  { value: "internal-plan", label: "기관 내부 계획" },
  { value: "other", label: "기타 문서" },
];

export const FRONT_MATTER_MODES = new Set(["source", "template", "omitted", "unresolved"]);

const TOC_HEADING = /^(목\s*차|contents?)$/i;
const SUMMARY_HEADING = /^(요약|summary|추진계획\s*\(\s*요약\s*\))$/i;
const TEMPLATE_ARTIFACTS = new Set([
  "내용 입력 대기",
  "운영 계획",
  "인천을 품고 세계로 나아가는 글로벌 인재 양성",
]);

function normalize(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function withoutKnownExtension(value) {
  return normalize(value).replace(/\.(?:md|txt|hwpx?|iceplan)$/i, "");
}

function documentTitleCandidates(model) {
  const candidates = new Set();
  for (const value of [model.metadata?.title, model.metadata?.cover?.title]) {
    const normalized = normalize(value);
    const withoutExtension = withoutKnownExtension(value);
    if (normalized) candidates.add(normalized);
    if (withoutExtension) candidates.add(withoutExtension);
  }
  return candidates;
}

function blockText(block) {
  const marker = normalize(block?.marker);
  const text = normalize(block?.text);
  return marker && text ? `${marker} ${text}` : text;
}

function sourcePageOf(block) {
  const value = block?.sourcePage ?? block?.source?.pageNumber ?? block?.source?.page;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function isBodySectionStart(block) {
  const text = blockText(block);
  if (block?.type === "heading") return !TOC_HEADING.test(text) && !SUMMARY_HEADING.test(text);
  if (block?.type === "listItem" && /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|\d+\.)$/.test(normalize(block.marker))) return true;
  return /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|\d+\.)\s+\S/.test(text);
}

function detectedSection(blocks, headingPattern) {
  const index = blocks.findIndex((block) => headingPattern.test(blockText(block)));
  if (index < 0) return { detected: false, headingIndex: null, blockIndices: [] };
  const sourcePage = sourcePageOf(blocks[index]);
  if (sourcePage) {
    return {
      detected: true,
      headingIndex: index,
      sourcePage,
      blockIndices: blocks
        .map((block, blockIndex) => sourcePageOf(block) === sourcePage ? blockIndex : null)
        .filter((blockIndex) => blockIndex !== null),
    };
  }
  const headingLevel = Number(blocks[index].level) || 1;
  const blockIndices = [index];
  for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
    const block = blocks[cursor];
    const text = blockText(block);
    if (TOC_HEADING.test(text) || SUMMARY_HEADING.test(text)) break;
    if (blocks[index]?.type === "heading") {
      if (block?.type === "heading" && (Number(block.level) || 1) <= headingLevel) break;
    } else if (isBodySectionStart(block)) {
      break;
    }
    blockIndices.push(cursor);
  }
  return { detected: true, headingIndex: index, blockIndices };
}

export function detectFrontMatter(blocks = []) {
  return {
    toc: detectedSection(blocks, TOC_HEADING),
    summary: detectedSection(blocks, SUMMARY_HEADING),
  };
}

function decision(mode = "unresolved", userDecision = null, warningAcknowledged = false, source = null) {
  return {
    mode,
    contentGeneration: "none",
    userDecision,
    warningAcknowledged: Boolean(warningAcknowledged),
    source,
  };
}

export function ensurePlanDecisions(model, { documentKind = null } = {}) {
  const metadata = model?.metadata || {};
  const existing = metadata.plan || {};
  const kind = documentKind || existing.documentKind || metadata.documentKind || "unknown";
  const detected = detectFrontMatter(model?.blocks || []);
  const previous = existing.frontMatter || {};
  const toc = previous.toc?.mode
    ? { ...decision(), ...previous.toc }
    : detected.toc.detected
      ? decision("source", "detected", false, detected.toc)
      : decision();
  const summary = previous.summary?.mode
    ? { ...decision(), ...previous.summary }
    : detected.summary.detected
      ? decision("source", "detected", false, detected.summary)
      : decision();
  return {
    ...model,
    metadata: {
      ...metadata,
      documentKind: kind,
      plan: {
        ...existing,
        documentKind: kind,
        detected,
        frontMatter: { toc, summary },
        bullet: existing.bullet || {
          mode: "preserve-with-suggestions",
          userDecision: null,
          overrideReason: null,
        },
      },
    },
  };
}

function requireMode(mode, field) {
  if (!FRONT_MATTER_MODES.has(mode) || mode === "unresolved") throw new Error(field + " 결정값이 올바르지 않습니다.");
}

export function applyFrontMatterDecision(model, field, { mode, userDecision = "confirmed", warningAcknowledged = false } = {}) {
  if (!["toc", "summary"].includes(field)) throw new Error("지원하지 않는 앞부분 항목입니다: " + field);
  requireMode(mode, field);
  const next = ensurePlanDecisions(model);
  const kind = next.metadata.plan.documentKind;
  if (field === "toc" && mode === "omitted" && kind === "school-guidance-basic-plan" && !warningAcknowledged) {
    throw new Error("학교 배포용 기본계획에서 목차 제외는 경고 확인이 필요합니다.");
  }
  const previous = next.metadata.plan.frontMatter[field];
  return {
    ...next,
    metadata: {
      ...next.metadata,
      plan: {
        ...next.metadata.plan,
        frontMatter: {
          ...next.metadata.plan.frontMatter,
          [field]: {
            ...previous,
            mode,
            contentGeneration: "none",
            userDecision,
            warningAcknowledged: Boolean(warningAcknowledged),
          },
        },
      },
    },
  };
}

export function applyBulletDecision(model, { userDecision, overrideReason = null } = {}) {
  if (!["keep-source-marker", "apply-recommendation", "custom"].includes(userDecision)) {
    throw new Error("불릿 결정값이 올바르지 않습니다: " + userDecision);
  }
  const next = ensurePlanDecisions(model);
  return {
    ...next,
    metadata: {
      ...next.metadata,
      plan: {
        ...next.metadata.plan,
        bullet: {
          ...next.metadata.plan.bullet,
          mode: "preserve-with-suggestions",
          userDecision,
          overrideReason: normalize(overrideReason) || null,
        },
      },
    },
  };
}

export function planDecisionGate(model) {
  const next = ensurePlanDecisions(model);
  const kind = next.metadata.plan.documentKind;
  const frontMatter = next.metadata.plan.frontMatter;
  const blocking = [];
  if (kind === "unknown") blocking.push("document-kind");
  if (frontMatter.toc.mode === "unresolved" && kind === "school-guidance-basic-plan") blocking.push("toc-decision");
  if (frontMatter.summary.mode === "unresolved") blocking.push("summary-decision");
  return { passed: blocking.length === 0, blocking, documentKind: kind, frontMatter };
}

function blocksFromSourcePage(model, sourcePage) {
  return (sourcePage?.blockIndices || [])
    .map((index) => model.blocks?.[index])
    .filter(Boolean);
}

function withoutFrontMatterHeading(blocks, headingPattern) {
  return blocks.filter((block) => !headingPattern.test(blockText(block)));
}

function cleanedBodyPageBlocks(blocks, model, opening) {
  const titleCandidates = documentTitleCandidates(model);
  const organizationCandidates = new Set(
    [
      model.metadata?.organization?.displayName,
      model.metadata?.cover?.displayName,
      [
        model.metadata?.organization?.displayName || model.metadata?.cover?.displayName,
        model.metadata?.organization?.department || model.metadata?.cover?.department,
      ].filter(Boolean).join(" "),
    ]
      .map(normalize)
      .filter(Boolean),
  );
  const leadingWindow = blocks.slice(0, 8);
  const repeatedDocumentTitle = leadingWindow.some((block) => titleCandidates.has(withoutKnownExtension(blockText(block))));
  let bodyBlocks = [...blocks];
  const stripLeadingWrapper = () => {
    while (bodyBlocks.length) {
      const text = blockText(bodyBlocks[0]);
      if (
        titleCandidates.has(text)
        || titleCandidates.has(withoutKnownExtension(text))
        || organizationCandidates.has(text)
        || TEMPLATE_ARTIFACTS.has(text)
      ) {
        bodyBlocks.shift();
        continue;
      }
      break;
    }
  };
  if (opening) {
    const bodyStart = bodyBlocks.findIndex(isBodySectionStart);
    if (bodyStart >= 0) bodyBlocks = bodyBlocks.slice(bodyStart);
    else if (repeatedDocumentTitle) stripLeadingWrapper();
  } else if (repeatedDocumentTitle) {
    stripLeadingWrapper();
  }
  return { blocks: bodyBlocks, repeatedDocumentTitle };
}

function bodyPageFingerprint(blocks) {
  return JSON.stringify(blocks.map((block) => {
    if (block.type === "table") {
      return {
        type: block.type,
        cells: block.table?.cells?.map((row) => row.map((cell) => normalize(cell?.text)))
          || [block.header || [], ...(block.rows || [])],
      };
    }
    if (block.type === "image") return { type: block.type, sha256: block.image?.sha256 || null };
    return {
      type: block.type,
      marker: normalize(block.marker),
      level: Number(block.level) || 0,
      text: normalize(block.text),
    };
  }));
}

function sourcePagePlan(model, frontMatter) {
  const sourcePages = (model.metadata?.sourcePages || [])
    .filter((page) => Number.isInteger(Number(page?.number)))
    .sort((left, right) => Number(left.number) - Number(right.number));
  if (!sourcePages.length) return null;

  const pages = [];
  let bodySeen = false;
  const seenBodyFingerprints = new Map();
  for (const sourcePage of sourcePages) {
    const role = sourcePage.role;
    if (role === "cover") {
      pages.push({
        type: "cover",
        role: "cover",
        sourcePage: sourcePage.number,
        sourcePolicy: "retemplate",
        sourceBlockCount: sourcePage.blockIndices?.length || 0,
        blocks: [],
      });
      continue;
    }
    if (role === "inner-cover") {
      pages.push({
        type: "inner-cover",
        role: "inner-cover",
        sourcePage: sourcePage.number,
        sourcePolicy: "retemplate",
        sourceBlockCount: sourcePage.blockIndices?.length || 0,
        blocks: [],
      });
      continue;
    }
    if (role === "toc") {
      if (!["source", "template"].includes(frontMatter.toc.mode)) continue;
      const blocks = frontMatter.toc.mode === "source"
        ? withoutFrontMatterHeading(blocksFromSourcePage(model, sourcePage), TOC_HEADING)
        : [];
      pages.push({ type: "toc", role: "toc", sourcePage: sourcePage.number, decisionMode: frontMatter.toc.mode, blocks });
      continue;
    }
    if (role === "summary") {
      if (!["source", "template"].includes(frontMatter.summary.mode)) continue;
      const blocks = frontMatter.summary.mode === "source"
        ? withoutFrontMatterHeading(blocksFromSourcePage(model, sourcePage), SUMMARY_HEADING)
        : [];
      pages.push({ type: "summary", role: "summary", sourcePage: sourcePage.number, decisionMode: frontMatter.summary.mode, blocks });
      continue;
    }
    const bodyRole = bodySeen ? "body-continuation" : "body-opening";
    const rawBlocks = blocksFromSourcePage(model, sourcePage);
    const cleaned = cleanedBodyPageBlocks(rawBlocks, model, !bodySeen);
    const blocks = cleaned.blocks;
    const fingerprint = bodyPageFingerprint(blocks);
    if (bodySeen && cleaned.repeatedDocumentTitle && seenBodyFingerprints.has(fingerprint)) {
      const preserved = seenBodyFingerprints.get(fingerprint);
      const page = pages[preserved.pageIndex];
      pages[preserved.pageIndex] = {
        ...page,
        collapsedSourcePages: [
          ...(page.collapsedSourcePages || []),
          sourcePage.number,
        ],
        collapseReason: "repeated-document-title-wrapper",
      };
      continue;
    }
    pages.push({ type: bodyRole, role: bodyRole, sourcePage: sourcePage.number, blocks });
    if (!seenBodyFingerprints.has(fingerprint)) {
      seenBodyFingerprints.set(fingerprint, {
        sourcePage: sourcePage.number,
        pageIndex: pages.length - 1,
      });
    }
    bodySeen = true;
  }

  if (!pages.some((page) => page.type === "cover")) pages.unshift({ type: "cover", role: "cover", blocks: [] });
  const insertFrontMatterPage = (field, type) => {
    if (frontMatter[field].mode !== "template" || pages.some((page) => page.type === type)) return;
    const firstBody = pages.findIndex((page) => ["body", "body-opening", "body-continuation"].includes(page.type));
    const index = firstBody >= 0 ? firstBody : pages.length;
    pages.splice(index, 0, { type, role: type, decisionMode: "template", blocks: [] });
  };
  insertFrontMatterPage("toc", "toc");
  insertFrontMatterPage("summary", "summary");
  if (!pages.some((page) => ["body", "body-opening", "body-continuation"].includes(page.type))) {
    pages.push({ type: "body-opening", role: "body-opening", blocks: [] });
  }
  return pages;
}

export function pagePlanFromDecisions(model) {
  const next = ensurePlanDecisions(model);
  const frontMatter = next.metadata.plan.frontMatter;
  const preservedSourcePages = sourcePagePlan(next, frontMatter);
  if (preservedSourcePages) return preservedSourcePages;
  const pages = [{ type: "cover", role: "cover" }];
  const sourceBlocks = (section) => section.mode === "source"
    ? (section.source?.blockIndices || []).slice(1).map((index) => next.blocks?.[index]).filter(Boolean)
    : [];
  if (["source", "template"].includes(frontMatter.toc.mode)) {
    pages.push({ type: "toc", role: "toc", decisionMode: frontMatter.toc.mode, blocks: sourceBlocks(frontMatter.toc) });
  }
  if (["source", "template"].includes(frontMatter.summary.mode)) {
    pages.push({ type: "summary", role: "summary", decisionMode: frontMatter.summary.mode, blocks: sourceBlocks(frontMatter.summary) });
  }
  const frontMatterIndices = new Set(
    [frontMatter.toc, frontMatter.summary]
      .filter((section) => section.mode === "source")
      .flatMap((section) => section.source?.blockIndices || []),
  );
  const bodySourceBlocks = (next.blocks || []).filter((_block, index) => !frontMatterIndices.has(index));
  const bodyBlocks = cleanedBodyPageBlocks(bodySourceBlocks, next, true).blocks;
  pages.push({ type: "body-opening", role: "body-opening", blocks: bodyBlocks });
  return pages;
}

function withPageId(page, index) {
  return { ...page, id: page.id || "page-" + (index + 1), confirmed: Boolean(page.confirmed) };
}

export function normalizePagePlan(pages = []) {
  return pages.map(withPageId);
}

export function insertPage(pages, page, index = pages.length) {
  const next = normalizePagePlan(pages);
  const at = Math.max(0, Math.min(next.length, Number(index) || 0));
  next.splice(at, 0, withPageId(page, at));
  return next.map(withPageId);
}

export function removePage(pages, index) {
  const next = normalizePagePlan(pages);
  if (next.length <= 1) throw new Error("페이지는 한 쪽 이상 남아야 합니다.");
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= next.length) throw new Error("삭제할 페이지가 없습니다.");
  next.splice(at, 1);
  if (!next.some((page) => ["body", "body-opening", "body-continuation"].includes(page.type))) {
    next.push(withPageId({ type: "body-continuation", role: "body-continuation" }, next.length));
  }
  return next.map(withPageId);
}

export function movePage(pages, index, direction) {
  const next = normalizePagePlan(pages);
  const from = Number(index);
  const to = from + (direction === "up" ? -1 : 1);
  if (!Number.isInteger(from) || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next.map(withPageId);
}
