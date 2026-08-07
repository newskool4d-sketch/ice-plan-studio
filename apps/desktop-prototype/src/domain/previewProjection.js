import layoutTokens from "../../scripts/layout-tokens.json" with { type: "json" };
import { classifyStructuredHeading, isPlausibleHeadingTitle } from "./headingPresentation.js";

const PAGE_TYPES = new Set(Object.keys(layoutTokens.pageTypes));

function normalizePage(page) {
  const type = page?.type;
  if (!PAGE_TYPES.has(type)) throw new Error(`지원하지 않는 페이지 유형입니다: ${type || "없음"}`);
  return { ...page, type };
}

function normalizeBlock(block) {
  if (block?.type !== "table") return block;
  if (Array.isArray(block.header) && Array.isArray(block.rows)) return block;
  const cells = block.table?.cells || [];
  return {
    ...block,
    header: (cells[0] || []).map((cell) => cell?.text ?? ""),
    rows: cells.slice(1).map((row) => row.map((cell) => cell?.text ?? "")),
  };
}

export function tableColumnWidths(rows, totalWidth = layoutTokens.page.bodyWidthHwpUnit) {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  let minimumWidth = layoutTokens.table.minimumColumnWidthHwpUnit;
  if (columnCount * minimumWidth > totalWidth) minimumWidth = Math.max(1, Math.floor(totalWidth / columnCount));
  const lengths = Array.from({ length: columnCount }, (_, column) => Math.max(1, ...rows.map((row) => String(row[column] ?? "").length)));
  const usable = totalWidth - minimumWidth * columnCount;
  const totalLength = Math.max(1, lengths.reduce((sum, length) => sum + length, 0));
  const widths = lengths.map((length) => minimumWidth + Math.floor((usable * length) / totalLength));
  widths[widths.length - 1] += totalWidth - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

export function tableRowHeights(rows, widths) {
  const capacity = (width) => Math.max(1, Math.floor(width / layoutTokens.table.estimatedCharWidthHwpUnit));
  return rows.map((row) => {
    const lines = Math.max(1, ...row.map((value, index) => Math.max(1, Math.ceil(String(value ?? "").length / capacity(widths[index])))));
    return layoutTokens.table.baseRowHeightHwpUnit + Math.min(lines, layoutTokens.table.maxEstimatedLines) * layoutTokens.table.lineHeightHwpUnit;
  });
}

function placeholders(type) {
  if (type === "preflight") return [{ type: "table", header: ["점검 항목", "검토완료", "해당없음"], rows: [["형식 점검", "□", "□"], ["내용 확인", "□", "□"]] }];
  if (type === "schedule") return [{ type: "table", header: ["구분", "내용"], rows: [["일정", "입력 대기"]] }];
  if (["inner-cover", "toc", "summary"].includes(type)) return [];
  const text = { task: "세부과제 내용 입력", appendix: "부록·붙임 내용 입력" }[type];
  return text ? [{ type: "paragraph", text }] : [];
}

function blockPlainText(block) {
  const normalized = normalizeBlock(block);
  if (normalized?.type !== "table") return String(normalized?.text || "").trim();
  return [...(normalized.header || []), ...(normalized.rows || []).flat()]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function tocEntries(model) {
  const seen = new Set();
  const entries = [];
  for (const block of model?.blocks || []) {
    const match = /^\s*((?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d+)\.)\s*(.+?)\s*$/.exec(blockPlainText(block));
    if (!match || !isPlausibleHeadingTitle(match[2])) continue;
    const text = `${match[1]} ${match[2].trim()}`;
    if (seen.has(text)) continue;
    seen.add(text);
    entries.push(text);
  }
  return entries;
}

function tocBlocksEffectivelyEmpty(blocks) {
  const meaningful = (blocks || []).flatMap((block) => {
    if (block?.type !== "table") {
      const text = String(block?.text || "").trim();
      return text && !/^목\s*차$/.test(text) ? [text] : [];
    }
    const normalized = normalizeBlock(block);
    return [...(normalized.header || []), ...(normalized.rows || []).flat()]
      .map((value) => String(value || "").trim())
      .filter((value) => value && !["구성 항목", "쪽"].includes(value));
  });
  return meaningful.length === 0;
}

function automaticTocBlock(model) {
  return {
    type: "table",
    header: ["구성 항목", "쪽"],
    rows: tocEntries(model).map((text) => [text, "자동"]),
  };
}

// 요약 발췌 상한(문자). model_to_hwpx.py의 SUMMARY_EXCERPT_MAX_CHARS·summary_rows와
// 값·알고리즘이 같아야 빠른 미리보기와 HWPX 출력이 어긋나지 않는다.
const SUMMARY_EXCERPT_MAX_CHARS = 120;
const SUMMARY_ELEMENT_KEYWORDS = [
  ["추진 근거", /근거|배경/],
  ["추진 목적", /목적|목표/],
  ["기대 효과", /기대\s*효과/],
];

function summaryJoin(items) {
  let joined = "";
  for (const item of items) {
    const candidate = joined ? `${joined} / ${item}` : item;
    if (candidate.length <= SUMMARY_EXCERPT_MAX_CHARS) {
      joined = candidate;
      continue;
    }
    if (!joined) joined = item.slice(0, SUMMARY_EXCERPT_MAX_CHARS - 1) + "…";
    break;
  }
  return joined;
}

function summaryExcerptText(block) {
  if (!["paragraph", "listItem"].includes(block?.type)) return "";
  const text = String(block?.text || "").replace(/\*\*(.+?)\*\*/g, "$1").trim();
  return /^-{3,}$/.test(text) ? "" : text;
}

function bodySourceBlocks(model, pages) {
  return pages
    .filter((page) => ["body", "body-opening", "body-continuation"].includes(page.type))
    .flatMap((page) => (Object.hasOwn(page, "blocks") ? page.blocks || [] : model?.blocks || []));
}

// 요약 페이지 4요소(근거·목적·과제·기대효과) 파생 — 실물 양식 판정(2026-08-07).
// 과제는 과제 제목 목록(그 자체가 요약), 나머지는 키워드가 일치하는 첫 장의 본문
// 발췌. 요소를 찾지 못하면 빈 칸으로 남겨 수기 입력 여지를 유지한다.
function summaryRows(model, pages) {
  const blocks = bodySourceBlocks(model, pages);
  const chapters = [];
  const tasks = [];
  const seenTasks = new Set();
  blocks.forEach((block, index) => {
    const parts = classifyStructuredHeading(blockPlainText(block));
    if (!parts) return;
    if (parts.kind === "roman-chapter") {
      chapters.push({ title: parts.title, index });
    } else if (parts.kind === "task-section") {
      const entry = `${parts.label} ${parts.title}`;
      if (!seenTasks.has(entry)) {
        seenTasks.add(entry);
        tasks.push(entry);
      }
    }
  });
  const excerptFor = (pattern) => {
    const position = chapters.findIndex((chapter) => pattern.test(chapter.title));
    if (position < 0) return "";
    const end = position + 1 < chapters.length ? chapters[position + 1].index : blocks.length;
    return summaryJoin(blocks.slice(chapters[position].index + 1, end).map(summaryExcerptText).filter(Boolean));
  };
  const contents = Object.fromEntries(SUMMARY_ELEMENT_KEYWORDS.map(([label, pattern]) => [label, excerptFor(pattern)]));
  return [
    ["추진 근거", contents["추진 근거"]],
    ["추진 목적", contents["추진 목적"]],
    ["추진 과제", summaryJoin(tasks)],
    ["기대 효과", contents["기대 효과"]],
  ];
}

function automaticSummaryBlock(model, pages) {
  return {
    type: "table",
    header: ["구분", "내용"],
    rows: summaryRows(model, pages),
  };
}

function pageSequence(model, profile) {
  const metadata = model?.metadata || {};
  const requested = metadata.pages?.length ? metadata.pages : (metadata.pageTypes?.length ? metadata.pageTypes.map((type) => ({ type })) : (model?.pageTypes?.length ? model.pageTypes.map((type) => ({ type })) : [{ type: "cover" }, { type: "body" }]));
  const pages = requested.map(normalizePage);
  const innerCover = metadata.layout?.innerCover ?? profile.innerCover;
  if (innerCover && !pages.some((page) => page.type === "inner-cover")) {
    const coverIndex = pages.findIndex((page) => page.type === "cover");
    pages.splice(coverIndex + 1, 0, { type: "inner-cover" });
  }
  return pages;
}

function projectTable(block) {
  const normalized = normalizeBlock(block);
  const rows = [normalized.header || [], ...(normalized.rows || [])];
  const sourceTable = normalized.layout?.table;
  const sourceWidths = sourceTable?.columnWidthsHwpUnit;
  const useSourceWidths = Array.isArray(sourceWidths)
    && sourceWidths.length === Math.max(1, ...rows.map((row) => row.length))
    && sourceWidths.every((width) => Number(width) > 0);
  const columnWidthsHwpUnit = useSourceWidths ? sourceWidths.map(Number) : tableColumnWidths(rows);
  const sourceHeights = sourceTable?.rowHeightsHwpUnit;
  const rowHeightsHwpUnit = Array.isArray(sourceHeights)
    && sourceHeights.length === rows.length
    && sourceHeights.every((height) => Number(height) > 0)
    ? sourceHeights.map(Number)
    : tableRowHeights(rows, columnWidthsHwpUnit);
  const measuredWidth = columnWidthsHwpUnit.reduce((sum, width) => sum + width, 0);
  return {
    ...normalized,
    rows,
    columnWidthsHwpUnit,
    rowHeightsHwpUnit,
    widthHwpUnit: Number(sourceTable?.widthHwpUnit) || measuredWidth || layoutTokens.page.bodyWidthHwpUnit,
  };
}

export function createPreviewProjection(model) {
  const metadata = model?.metadata || {};
  const cover = metadata.cover || {};
  const profileId = metadata.layout?.coverProfile || metadata.coverProfile || "metropolitan-a";
  const layoutProfileId = metadata.layout?.profile || (metadata.documentKind === "school-guidance-basic-plan" ? "worldschool-2026" : null);
  const profile = layoutTokens.coverProfiles[profileId];
  if (!profile) throw new Error(`지원하지 않는 표지 프로필입니다: ${profileId}`);
  const requestedPages = pageSequence(model, profile);
  const bodyStartIndex = requestedPages.findIndex((page) => page.type === "body-opening" || page.type === "body");
  const pages = requestedPages.map((page, index) => {
    const rawPageBlocks = page.type === "body-continuation"
      ? (page.blocks || [])
      : ["body", "body-opening"].includes(page.type)
        ? (Object.hasOwn(page, "blocks") ? page.blocks : model?.blocks || [])
        : (page.blocks || placeholders(page.type));
    const pageBlocks = (
      page.type === "toc"
      && tocBlocksEffectivelyEmpty(rawPageBlocks)
      && (model?.source?.format === "hwpx" || (metadata.sourcePages || []).length > 0)
    )
      ? [automaticTocBlock(model)]
      // HWPX 경로(model_to_hwpx.py)와 동일 조건: 빈 요약 페이지는 본문 4요소
      // 파생 표로 채우고, 원문 요약 블록이 있으면 그대로 보존한다.
      : page.type === "summary" && rawPageBlocks.length === 0
        ? [automaticSummaryBlock(model, requestedPages)]
        : rawPageBlocks;
    const blocks = pageBlocks.map(normalizeBlock).map((block) => block.type === "table" ? projectTable(block) : block);
    const title = page.title || (["body", "body-opening", "body-continuation"].includes(page.type) ? metadata.title || "일반 본문" : layoutTokens.pageTypes[page.type]);
    const isBodyPage = ["body", "body-opening", "body-continuation"].includes(page.type);
    return {
      id: `${page.type}-${index + 1}`,
      number: index + 1,
      displayNumber: bodyStartIndex >= 0 && index >= bodyStartIndex ? index - bodyStartIndex + 1 : null,
      type: page.type,
      role: page.role || page.type,
      decisionMode: page.decisionMode || null,
      sourcePage: page.sourcePage || null,
      sourcePolicy: page.sourcePolicy || null,
      sourceBlockCount: Number(page.sourceBlockCount) || 0,
      collapsedSourcePages: Array.isArray(page.collapsedSourcePages) ? [...page.collapsedSourcePages] : [],
      collapseReason: page.collapseReason || null,
      label: layoutTokens.pageTypes[page.type],
      title,
      blocks,
    };
  });
  // 영문 기관명은 기관 레지스트리 값(cover.englishName)을 우선한다. 직속기관
  // 다수가 같은 coverProfile(direct-g)을 공유하므로 프로필 토큰의 englishName을
  // 그대로 쓰면 전부 학생교육원 영문명으로 나온다(HWPX 경로와 불일치). cover에
  // englishName 키가 있으면(빈 값 포함) 그 값을, 없으면 프로필 기본값으로 폴백해
  // 빠른 미리보기와 실조판·HWPX 출력을 일치시킨다.
  const resolvedEnglishName = "englishName" in cover ? cover.englishName : profile.englishName;
  return {
    tokens: layoutTokens,
    title: metadata.title || cover.title || "제목 없음",
    cover,
    organization: {
      displayName: metadata.organization?.displayName || cover.displayName || "",
      department: metadata.organization?.department || cover.department || "",
    },
    profile: { id: profileId, ...profile, englishName: resolvedEnglishName },
    layoutProfile: layoutProfileId ? { id: layoutProfileId, ...layoutTokens.layoutProfiles?.[layoutProfileId] } : null,
    sourceFormat: model?.source?.format || null,
    sourceLayout: metadata.sourceLayout || null,
    pages,
    bodyWidthMm: layoutTokens.page.bodyWidthHwpUnit / layoutTokens.page.hwpUnitPerMm,
  };
}

export { layoutTokens };
