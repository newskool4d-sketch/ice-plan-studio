#!/usr/bin/env node
import { parseMarkdown } from "../src/domain/markdownParser.js";
import { classifyStructuredHeading } from "../src/domain/headingPresentation.js";
import { applyFrontMatterDecision, ensurePlanDecisions, pagePlanFromDecisions } from "../src/domain/planDecisions.js";
import { createPreviewProjection } from "../src/domain/previewProjection.js";
import { modelTitle, pageDraftsFrom, withPagePlan } from "../src/domain/workflowModel.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = parseMarkdown([
  "# 2026 인천세계로배움학교 추진 계획",
  "",
  "## 목차",
  "",
  "Ⅰ. 추진 근거 ........ 1",
  "",
  "## 요약",
  "",
  "비전: 세계를 품은 인천교육",
  "",
  "## Ⅰ. 추진 근거",
  "",
  "교육 목적과 추진 방향",
].join("\n"), { title: "2026 인천세계로배움학교 추진 계획" });
const prepared = ensurePlanDecisions(source, { documentKind: "school-guidance-basic-plan" });
const decided = applyFrontMatterDecision(prepared, "summary", { mode: "source" });
const pages = pagePlanFromDecisions(decided);
assert(pages.map((page) => page.type).join("|") === "cover|toc|summary|body-opening", "profile page sequence mismatch");
assert(pages[1].blocks.some((block) => String(block.text).includes("추진 근거")), "source TOC content missing");
assert(pages[2].blocks.some((block) => String(block.text).includes("세계")), "source summary content missing");
assert(!pages[3].blocks.some((block) => String(block.text).includes("목차")), "TOC was duplicated into body opening");
assert(!pages[3].blocks.some((block) => String(block.text).includes("비전")), "summary was duplicated into body opening");
const projection = createPreviewProjection({
  ...decided,
  metadata: { ...decided.metadata, pages, layout: { coverProfile: "metropolitan-a" } },
});
assert(projection.layoutProfile?.id === "worldschool-2026", "worldschool profile was not resolved");
assert(projection.layoutProfile?.bodySizePt === 13, "school-guidance body size must be 13pt");
assert(
  projection.layoutProfile?.adaptiveSpacingCalibrated === false,
  "13pt school-guidance profile must bypass the legacy 12pt spacing calibration",
);
assert(projection.layoutProfile?.openingTitleSizePt === 22, "body-opening title token must match the 22pt HWPX style");
assert(projection.layoutProfile?.openingDepartmentSizePt === 13, "department token must match the 13pt HWPX style");
assert(
  JSON.stringify(classifyStructuredHeading("Ⅰ. 추진 근거")) === JSON.stringify({
    kind: "roman-chapter",
    label: "Ⅰ",
    title: "추진 근거",
  }),
  "roman chapter heading classification changed",
);
assert(
  JSON.stringify(classifyStructuredHeading("[과제1] 체험교육 강화")) === JSON.stringify({
    kind: "task-section",
    label: "[과제1]",
    title: "체험교육 강화",
  }),
  "compact task heading classification changed",
);
assert(
  JSON.stringify(classifyStructuredHeading("[과제 1] 체험교육 강화")) === JSON.stringify({
    kind: "task-section",
    label: "[과제 1]",
    title: "체험교육 강화",
  }),
  "spaced task heading classification changed",
);
assert(
  JSON.stringify(classifyStructuredHeading("[과제 1-1] 운영 기반 조성")) === JSON.stringify({
    kind: "task-subsection",
    label: "[과제 1-1]",
    title: "운영 기반 조성",
  }),
  "task subsection heading classification changed",
);
assert(
  JSON.stringify(classifyStructuredHeading("1. 일반 항목")) === JSON.stringify({
    kind: "roman-chapter",
    label: "1.",
    title: "일반 항목",
  }),
  "numeric chapter heading must use the roman-chapter frame",
);
assert(
  JSON.stringify(classifyStructuredHeading("과제 1. 체험교육 강화")) === JSON.stringify({
    kind: "task-section",
    label: "과제 1.",
    title: "체험교육 강화",
  }),
  "unbracketed task heading classification changed",
);
assert(
  JSON.stringify(classifyStructuredHeading("과제 1-1. 운영 기반 조성")) === JSON.stringify({
    kind: "task-subsection",
    label: "과제 1-1.",
    title: "운영 기반 조성",
  }),
  "unbracketed task subsection classification changed",
);
assert(projection.layoutProfile?.chapterTitleSizePt === 18, "roman chapter title must remain 18pt");
assert(projection.layoutProfile?.taskTitleSizePt === 14, "task title must be smaller than the roman chapter");
assert(projection.layoutProfile?.taskSubTitleSizePt === 12, "task subsection title must be smaller than the task title");
const blank = createPreviewProjection({
  ...decided,
  metadata: { ...decided.metadata, pages: pages.map((page) => page.type === "toc" ? { ...page, blocks: [], decisionMode: "template" } : page) },
});
assert(blank.pages.find((page) => page.type === "toc").blocks.length === 0, "blank TOC gained synthetic text");
const importedWithEmptyToc = createPreviewProjection({
  ...decided,
  source: { format: "hwpx", filePath: "fixture.hwpx" },
  metadata: {
    ...decided.metadata,
    sourcePages: [{ number: 1, role: "cover", blockIndices: [] }],
    pages: pages.map((page) => page.type === "toc" ? { ...page, blocks: [], decisionMode: "source" } : page),
  },
});
const importedToc = importedWithEmptyToc.pages.find((page) => page.type === "toc");
// 실물 양식 판정(2026-08-07): 자동 목차는 표가 아니라 `제목 ····· 자동` 문단형이다.
assert(
  importedToc.blocks.some((block) => block.type === "paragraph"
    && block.tocEntry === true
    && String(block.text).includes("추진 근거")
    && String(block.text).includes("····")),
  "empty imported HWPX TOC was not populated as dot-leader paragraphs",
);
assert(
  !importedToc.blocks.some((block) => block.type === "table"),
  "auto TOC regressed to the legacy table form",
);

const directPages = [
  ...pages,
  { type: "body-continuation", role: "body-continuation", blocks: [] },
  { type: "appendix", role: "appendix", blocks: [] },
];
const direct = createPreviewProjection({
  ...decided,
  metadata: {
    ...decided.metadata,
    cover: {
      ...(decided.metadata.cover || {}),
      title: "학생교육원 공약사업 이행을 위한 체험교육 프로그램 고도화 추진 계획(안)",
      displayName: "인천광역시교육청학생교육원",
      direction: "",
    },
    organization: {
      displayName: "인천광역시교육청학생교육원",
      department: "교학과",
    },
    layout: { coverProfile: "direct-g" },
    pages: directPages,
  },
});
assert(
  direct.pages.map((page) => page.type).join("|") === "cover|inner-cover|toc|summary|body-opening|body-continuation|appendix",
  "direct-g page insertion changed page ownership",
);
assert(direct.pages[2].role === "toc" && direct.pages[2].blocks.some((block) => String(block.text).includes("추진 근거")), "TOC blocks shifted after inner-cover insertion");
assert(direct.pages[3].role === "summary" && direct.pages[3].blocks.some((block) => String(block.text).includes("세계")), "summary blocks shifted after inner-cover insertion");
assert(direct.pages.map((page) => page.displayNumber).join("|") === "||||1|2|3", "logical page numbers do not continue after body opening");
assert(direct.pages[5].blocks.length === 0, "empty body continuation duplicated the full body");
assert(direct.organization.department === "교학과", "department metadata was not projected");

const imported = createPreviewProjection({
  ...decided,
  source: { format: "hwpx", filePath: "fixture.hwpx" },
  metadata: {
    ...decided.metadata,
    sourceLayout: { hardPageCount: 4, physicalPageCount: 14 },
    pages: [{
      type: "body-opening",
      blocks: [{
        type: "table",
        header: ["제목"],
        rows: [["내용"]],
        layout: {
          table: {
            widthHwpUnit: 30000,
            columnWidthsHwpUnit: [30000],
            rowHeightsHwpUnit: [1800, 2200],
            headerStyle: { sourceCharPrId: "9", fontFamily: "함초롬바탕", sizePt: 14 },
            bodyStyle: { sourceCharPrId: "417", fontFamily: "맑은 고딕", sizePt: 10 },
          },
        },
      }],
    }],
  },
});
assert(imported.sourceFormat === "hwpx", "imported HWPX source format was not projected");
assert(imported.sourceLayout?.physicalPageCount === 14, "physical page count was not projected");
assert(imported.pages[0].blocks[0].widthHwpUnit === 30000, "source table width was not preserved");
assert(imported.pages[0].blocks[0].rowHeightsHwpUnit.join("|") === "1800|2200", "source row heights were not preserved");
assert(
  modelTitle({ source: { format: "hwpx" }, metadata: { title: "실제 계획안.hwpx" }, blocks: [{ type: "heading", level: 1, text: "1. 추진 배경" }] }, "fallback.hwpx") === "실제 계획안",
  "imported HWPX filename title was replaced by its first numbered heading",
);
assert(!JSON.stringify(direct).includes("인천을 품고 세계로 나아가는 글로벌 인재 양성"), "unrelated template phrase remains in preview projection");

const sourcePageProjection = createPreviewProjection({
  ...decided,
  metadata: {
    ...decided.metadata,
    pages: [
      { type: "cover", role: "cover", sourcePage: 1, sourcePolicy: "retemplate", sourceBlockCount: 7, blocks: [] },
      {
        type: "body-opening",
        role: "body-opening",
        sourcePage: 5,
        collapsedSourcePages: [6, 7],
        collapseReason: "repeated-document-title-wrapper",
        blocks: [],
      },
      { type: "appendix", role: "appendix", sourcePage: 6, blocks: [] },
    ],
  },
});
assert(sourcePageProjection.pages.map((page) => page.sourcePage).join("|") === "1|5|6", "page-level source provenance was dropped");
assert(sourcePageProjection.pages[0].sourcePolicy === "retemplate" && sourcePageProjection.pages[0].sourceBlockCount === 7, "retemplate audit metadata was dropped");
assert(sourcePageProjection.pages[1].collapsedSourcePages.join("|") === "6|7", "collapsed source-page audit trail was dropped");
assert(sourcePageProjection.pages[1].collapseReason === "repeated-document-title-wrapper", "collapse reason was dropped");

const draftSourceModel = ensurePlanDecisions({
  schemaVersion: "0.2",
  kind: "plan-ir",
  metadata: {
    title: "출처 쪽 검증",
    sourcePages: [
      { number: 1, role: "cover", blockIndices: [0] },
      { number: 5, role: "body-opening", blockIndices: [1] },
    ],
  },
  blocks: [
    { type: "paragraph", text: "표지", sourcePage: 1 },
    { type: "listItem", marker: "1.", ordered: true, level: 0, text: "추진 배경", sourcePage: 5 },
  ],
}, { documentKind: "internal-plan" });
const sourceDrafts = pageDraftsFrom(draftSourceModel, {
  displayName: "인천광역시교육청학생교육원",
  englishName: "",
  coverProfile: "metropolitan-a",
});
assert(sourceDrafts.map((page) => page.sourcePage).join("|") === "1|5", "page drafts dropped sourcePage");
assert(sourceDrafts[0].sourcePolicy === "retemplate" && sourceDrafts[0].sourceBlockCount === 1, "page drafts dropped retemplate audit metadata");
const studentDrafts = pageDraftsFrom(draftSourceModel, {
  displayName: "인천광역시교육청학생교육원",
  englishName: "",
  coverProfile: "direct-g",
  innerCover: false,
});
assert(!studentDrafts.some((page) => page.type === "inner-cover"), "student institute must omit the inner cover");
const auditedSourceModel = ensurePlanDecisions({
  schemaVersion: "0.2",
  kind: "plan-ir",
  metadata: {
    title: "직접기관 기본계획.hwpx",
    sourcePages: [
      { number: 1, role: "cover", blockIndices: [0] },
      { number: 5, role: "body-opening", blockIndices: [1, 2] },
      { number: 6, role: "body-continuation", blockIndices: [3, 4, 5] },
      { number: 7, role: "body-continuation", blockIndices: [6, 7, 8] },
    ],
  },
  blocks: [
    { type: "paragraph", text: "표지", sourcePage: 1 },
    { type: "listItem", marker: "1.", text: "추진 배경", sourcePage: 5 },
    { type: "paragraph", text: "본문", sourcePage: 5 },
    { type: "paragraph", text: "직접기관 기본계획", sourcePage: 6 },
    { type: "listItem", marker: "1.", text: "추진 배경", sourcePage: 6 },
    { type: "paragraph", text: "본문", sourcePage: 6 },
    { type: "paragraph", text: "직접기관 기본계획", sourcePage: 7 },
    { type: "listItem", marker: "1.", text: "추진 배경", sourcePage: 7 },
    { type: "paragraph", text: "본문", sourcePage: 7 },
  ],
}, { documentKind: "school-guidance-basic-plan" });
const auditedDrafts = pageDraftsFrom(auditedSourceModel, {
  displayName: "인천광역시교육청학생교육원",
  englishName: "",
  coverProfile: "metropolitan-a",
});
assert(auditedDrafts[1].collapsedSourcePages.join("|") === "6|7", "page drafts dropped collapsed source pages");
assert(auditedDrafts[1].collapseReason === "repeated-document-title-wrapper", "page drafts dropped collapse reason");
const savedAuditModel = withPagePlan(auditedSourceModel, auditedDrafts);
assert(savedAuditModel.metadata.pages[1].collapsedSourcePages.join("|") === "6|7", "saved page plan dropped collapsed source pages");
assert(savedAuditModel.metadata.pages[1].collapseReason === "repeated-document-title-wrapper", "saved page plan dropped collapse reason");
console.log(JSON.stringify({
  gate: "body-layout-v2-rendering",
  passed: true,
  checks: [
    "dedicated source TOC",
    "dedicated source summary",
    "front-matter de-duplication",
    "worldschool profile",
    "13pt school-guidance body",
    "legacy 12pt spacing bypass",
    "22pt title and 13pt department tokens",
    "roman, task, and task-subsection heading classification",
    "18pt, 14pt, and 12pt structured-heading hierarchy",
    "blank frame without synthetic text",
    "direct-g role alignment",
    "body-relative page numbering",
    "post-body page-number continuation",
    "empty continuation preservation",
    "page-level source provenance",
    "collapsed source-page provenance",
    "draft source provenance",
    "saved page-plan audit provenance",
    "department projection",
    "unrelated phrase removal",
  ],
}, null, 2));
