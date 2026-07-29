import layoutTokens from "../../scripts/layout-tokens.json" with { type: "json" };

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

function pageSequence(model, profile) {
  const metadata = model?.metadata || {};
  const requested = metadata.pages?.length ? metadata.pages : (metadata.pageTypes?.length ? metadata.pageTypes.map((type) => ({ type })) : (model?.pageTypes?.length ? model.pageTypes.map((type) => ({ type })) : [{ type: "cover" }, { type: "body" }]));
  const pages = requested.map(normalizePage);
  if (profile.innerCover && !pages.some((page) => page.type === "inner-cover")) {
    const coverIndex = pages.findIndex((page) => page.type === "cover");
    pages.splice(coverIndex + 1, 0, { type: "inner-cover" });
  }
  return pages;
}

function projectTable(block) {
  const normalized = normalizeBlock(block);
  const rows = [normalized.header || [], ...(normalized.rows || [])];
  const columnWidthsHwpUnit = tableColumnWidths(rows);
  return { ...normalized, rows, columnWidthsHwpUnit, rowHeightsHwpUnit: tableRowHeights(rows, columnWidthsHwpUnit), widthHwpUnit: layoutTokens.page.bodyWidthHwpUnit };
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
    const pageBlocks = page.type === "body-continuation"
      ? (page.blocks || [])
      : ["body", "body-opening"].includes(page.type)
        ? (Object.hasOwn(page, "blocks") ? page.blocks : model?.blocks || [])
        : (page.blocks || placeholders(page.type));
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
    pages,
    bodyWidthMm: layoutTokens.page.bodyWidthHwpUnit / layoutTokens.page.hwpUnitPerMm,
  };
}

export { layoutTokens };
