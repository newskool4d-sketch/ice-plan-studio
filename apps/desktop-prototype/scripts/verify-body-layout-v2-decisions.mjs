#!/usr/bin/env node
import { parseMarkdown } from "../src/domain/markdownParser.js";
import {
  applyBulletDecision,
  applyFrontMatterDecision,
  ensurePlanDecisions,
  insertPage,
  movePage,
  pagePlanFromDecisions,
  planDecisionGate,
  removePage,
} from "../src/domain/planDecisions.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pageTypes(pages) {
  return pages.map((page) => page.type);
}

function main() {
  const withToc = parseMarkdown([
    "# 합성 기본계획",
    "",
    "## 목차",
    "",
    "Ⅰ. 추진 근거 ........ 1",
    "",
    "## Ⅰ. 추진 근거",
    "",
    "교육 목적을 확인한다.",
  ].join("\n"), { title: "합성 기본계획" });

  const prepared = ensurePlanDecisions(withToc, { documentKind: "school-guidance-basic-plan" });
  assert(prepared.metadata.plan.detected.toc.detected, "source TOC was not detected");
  assert(prepared.metadata.plan.frontMatter.toc.mode === "source", "source TOC mode was not stored");
  assert(!planDecisionGate(prepared).passed, "unresolved summary should block analysis");
  assert(planDecisionGate(prepared).blocking.includes("summary-decision"), "summary gate reason missing");

  const withTemplate = applyFrontMatterDecision(prepared, "summary", { mode: "template" });
  assert(planDecisionGate(withTemplate).passed, "source TOC + summary template should pass the decision gate");
  assert(pageTypes(pagePlanFromDecisions(withTemplate)).join("|") === "cover|toc|summary|body-opening", "page plan order is incorrect");

  const withOmittedToc = applyFrontMatterDecision(
    ensurePlanDecisions(parseMarkdown("# 내부 계획\n\n본문", { title: "내부 계획" }), { documentKind: "school-guidance-basic-plan" }),
    "toc",
    { mode: "omitted", userDecision: "confirmed-with-warning", warningAcknowledged: true },
  );
  const withOmittedSummary = applyFrontMatterDecision(withOmittedToc, "summary", { mode: "omitted" });
  assert(planDecisionGate(withOmittedSummary).passed, "explicit TOC warning acknowledgement should pass");
  assert(withOmittedSummary.metadata.plan.frontMatter.toc.warningAcknowledged, "TOC warning acknowledgement was not persisted");

  const withBulletOverride = applyBulletDecision(withTemplate, {
    userDecision: "keep-source-marker",
    overrideReason: "담당자 서식 유지",
  });
  assert(withBulletOverride.metadata.plan.bullet.userDecision === "keep-source-marker", "bullet decision was not persisted");
  assert(withBulletOverride.metadata.plan.bullet.overrideReason === "담당자 서식 유지", "bullet override reason was not persisted");

  const pages = pagePlanFromDecisions(withTemplate).map((page, index) => ({ ...page, id: "p" + (index + 1) }));
  const inserted = insertPage(pages, { type: "body", role: "body-continuation" }, 3);
  assert(inserted.length === pages.length + 1, "page insertion did not add one page");
  const moved = movePage(inserted, 3, "up");
  assert(moved[2].role === "body-continuation", "page move did not reorder the selected page");
  const removed = removePage(moved, 3);
  assert(removed.length === pages.length, "page removal did not restore the page count");

  const paragraphFrontMatter = ensurePlanDecisions({
    schemaVersion: "0.2",
    kind: "plan-ir",
    metadata: {
      title: "직접기관 기본계획",
      sourcePages: [
        { number: 1, role: "cover", blockIndices: [0] },
        { number: 2, role: "inner-cover", blockIndices: [1] },
        { number: 3, role: "toc", blockIndices: [2, 3] },
        { number: 4, role: "summary", blockIndices: [4, 5] },
        { number: 5, role: "body-opening", blockIndices: [6, 7] },
        { number: 6, role: "body-continuation", blockIndices: [8] },
        { number: 7, role: "body-continuation", blockIndices: [9] },
      ],
    },
    blocks: [
      { type: "paragraph", text: "표지", sourcePage: 1 },
      { type: "paragraph", text: "속표지", sourcePage: 2 },
      { type: "paragraph", text: "목 차", sourcePage: 3 },
      { type: "paragraph", text: "Ⅰ. 추진 근거 ........ 1", sourcePage: 3 },
      { type: "paragraph", text: "요약", sourcePage: 4 },
      { type: "paragraph", text: "비전과 목표", sourcePage: 4 },
      { type: "listItem", marker: "1.", text: "추진 배경", sourcePage: 5 },
      { type: "paragraph", text: "본문", sourcePage: 5 },
      { type: "paragraph", text: "계속 본문", sourcePage: 6 },
      { type: "paragraph", text: "계속 본문", sourcePage: 7 },
    ],
  }, { documentKind: "school-guidance-basic-plan" });
  assert(paragraphFrontMatter.metadata.plan.detected.toc.sourcePage === 3, "paragraph TOC page was not detected");
  assert(paragraphFrontMatter.metadata.plan.detected.summary.sourcePage === 4, "paragraph summary page was not detected");
  const sourcePages = pagePlanFromDecisions(paragraphFrontMatter);
  assert(
    pageTypes(sourcePages).join("|") === "cover|inner-cover|toc|summary|body-opening|body-continuation|body-continuation",
    "source page roles were flattened or reordered",
  );
  assert(sourcePages[0].sourcePolicy === "retemplate" && sourcePages[0].sourceBlockCount === 1, "cover retemplate policy is not auditable");
  assert(sourcePages[1].sourcePolicy === "retemplate" && sourcePages[1].sourceBlockCount === 1, "inner-cover retemplate policy is not auditable");
  assert(sourcePages[2].blocks.length === 1 && sourcePages[2].blocks[0].sourcePage === 3, "TOC source-page ownership was not preserved");
  assert(sourcePages[4].blocks[0].marker === "1.", "body opening did not start at its source section");
  assert(sourcePages[5].blocks[0].text === "계속 본문", "body continuation source page was not preserved");
  assert(sourcePages[6].sourcePage === 7, "intentional identical continuation page was deleted");

  const malformedRepeatedExport = ensurePlanDecisions({
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
  const collapsedMalformed = pagePlanFromDecisions(malformedRepeatedExport);
  assert(
    pageTypes(collapsedMalformed).join("|") === "cover|body-opening",
    "document-title-wrapped repeated export pages were not collapsed",
  );
  assert(collapsedMalformed[1].blocks.length === 2, "body content changed while collapsing malformed repeated export pages");
  assert(collapsedMalformed[1].collapsedSourcePages.join("|") === "6|7", "collapsed source pages were not recorded");
  assert(collapsedMalformed[1].collapseReason === "repeated-document-title-wrapper", "collapse reason was not recorded");

  const report = {
    gate: "body-layout-v2-decisions",
    passed: true,
    checks: [
      "source TOC detection",
      "unresolved front-matter gate",
      "template and omission decisions",
      "TOC warning acknowledgement",
      "bullet override persistence",
      "page insert/move/remove",
      "paragraph front-matter detection",
      "source-page bounded front matter",
      "source-page role and block preservation",
      "intentional identical source-page preservation",
      "auditable cover and inner-cover retemplate policy",
      "document-title-wrapped repeated export collapse",
      "collapsed source-page audit trail",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
