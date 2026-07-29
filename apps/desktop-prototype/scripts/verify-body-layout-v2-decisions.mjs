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
