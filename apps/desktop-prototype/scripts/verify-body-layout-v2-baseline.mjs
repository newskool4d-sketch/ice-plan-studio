#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../src/domain/markdownParser.js";
import {
  applyBulletDecision,
  applyFrontMatterDecision,
  ensurePlanDecisions,
  pagePlanFromDecisions,
} from "../src/domain/planDecisions.js";
import { createPreviewProjection } from "../src/domain/previewProjection.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const fixturePath = path.join(appRoot, "test-data/body-layout-v2/contract-fixtures.json");
const reportIndex = process.argv.indexOf("--report");
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;

const requiredIds = [
  "toc-source",
  "toc-missing-template",
  "toc-missing-omitted",
  "summary-missing-template",
  "body-opening-continuation",
  "bullet-override",
  "layout-13pt-boundaries",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function preparedModel(fixture) {
  const input = fixture.source.format === "markdown"
    ? parseMarkdown(fixture.source.text.replaceAll("\\n", "\n"), { title: "합성 기본계획" })
    : parseMarkdown("# 합성 기본계획\n\n## Ⅰ. 추진 근거\n\n합성 본문", { title: "합성 기본계획" });
  let model = ensurePlanDecisions({
    ...input,
    metadata: {
      ...input.metadata,
      title: "합성 기본계획",
      cover: { ...(input.metadata?.cover || {}), title: "합성 기본계획" },
      layout: { coverProfile: "metropolitan-a", profile: "worldschool-2026" },
    },
  }, { documentKind: "school-guidance-basic-plan" });
  for (const field of ["toc", "summary"]) {
    const decision = fixture.decision[field];
    model = applyFrontMatterDecision(model, field, {
      mode: decision.mode,
      userDecision: decision.userDecision,
      warningAcknowledged: decision.userDecision === "confirmed-with-warning",
    });
  }
  if (fixture.decision.bullet) {
    model = applyBulletDecision(model, {
      userDecision: fixture.decision.bullet.userDecision,
      overrideReason: fixture.decision.bullet.overrideReason,
    });
  }
  let pages = pagePlanFromDecisions(model);
  if (
    fixture.expected.pageTypes.includes("body-continuation")
    && !pages.some((page) => page.type === "body-continuation")
  ) {
    pages = [...pages, { type: "body-continuation", role: "body-continuation", blocks: [] }];
  }
  return {
    model: {
      ...model,
      metadata: { ...model.metadata, pages },
    },
    pages,
  };
}

function evaluateFixture(fixture) {
  const { model, pages } = preparedModel(fixture);
  const projection = createPreviewProjection(model);
  const checks = [];
  const check = (id, passed, detail = null) => checks.push({ id, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  const pageTypes = projection.pages.map((page) => page.type);
  check("page-types", JSON.stringify(pageTypes) === JSON.stringify(fixture.expected.pageTypes), pageTypes.join("|"));

  const serialized = JSON.stringify(projection.pages);
  for (const forbidden of fixture.expected.forbiddenText || []) {
    check(`forbidden:${forbidden}`, !serialized.includes(forbidden));
  }

  if (fixture.id === "toc-source") {
    const toc = projection.pages.find((page) => page.type === "toc");
    const text = JSON.stringify(toc?.blocks || []);
    check("source-toc-content", fixture.expected.tocPreserves.every((entry) => text.includes(entry)));
  }

  for (const type of fixture.expected.templateOnly || []) {
    const page = projection.pages.find((candidate) => candidate.type === type);
    // 요약 템플릿 결정은 빈 틀이 아니라 본문 4요소 파생 표를 받는다
    // (실물 양식 판정 2026-08-07 — 요소 미발견 칸만 빈 채로 남는다).
    const frameOk = type === "summary"
      ? page?.blocks?.length === 1
        && page.blocks[0].type === "table"
        && JSON.stringify([page.blocks[0].header || [], ...(page.blocks[0].rows || [])].map((row) => row[0]))
          === JSON.stringify(["구분", "추진 근거", "추진 목적", "추진 과제", "기대 효과"])
      : page?.blocks?.length === 0;
    check(`blank-${type}-frame`, Boolean(page) && frameOk && page.decisionMode === "template");
  }

  if (fixture.id === "toc-missing-omitted") {
    check("toc-omitted", !projection.pages.some((page) => page.type === "toc"));
    check("toc-warning-recorded", model.metadata.plan.frontMatter.toc.warningAcknowledged);
  }

  if (fixture.id === "body-opening-continuation") {
    check("one-opening-header", projection.pages.filter((page) => page.type === "body-opening").length === fixture.expected.openingHeaderCount);
    check("continuation-without-opening-role", projection.pages.filter((page) => page.type === "body-continuation").length === 1);
  }

  if (fixture.id === "bullet-override") {
    const body = pages.find((page) => page.type === "body-opening");
    const listItems = (body?.blocks || []).filter((block) => block.type === "listItem");
    check("source-markers", JSON.stringify(listItems.map((block) => block.marker)) === JSON.stringify(fixture.expected.sourceMarkers));
    check("source-levels", JSON.stringify(listItems.map((block) => block.level || 0)) === JSON.stringify(fixture.expected.sourceLevels));
    check(
      "override-roundtrip",
      model.metadata.plan.bullet.userDecision === fixture.expected.overrideRoundTrip.userDecision
        && model.metadata.plan.bullet.overrideReason === fixture.expected.overrideRoundTrip.overrideReason,
    );
  }

  if (fixture.id === "layout-13pt-boundaries") {
    check("13pt-layout-profile", projection.layoutProfile?.bodySizePt === fixture.expected.bodyFontSizePt);
    check("stale-12pt-calibration-disabled", projection.layoutProfile?.adaptiveSpacingCalibrated === false);
    check("com-recalibration-declared", fixture.expected.comComparisonRequired === true);
  }

  return {
    id: fixture.id,
    purpose: fixture.purpose,
    priorGap: fixture.baseline.gap,
    checks,
    passed: checks.every((item) => item.passed),
  };
}

async function main() {
  const fixtureSet = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  assert(fixtureSet.schemaVersion === "body-layout-v2.contract-fixture.1", "unexpected fixture schema");
  assert(fixtureSet.sourcePolicy === "synthetic-only", "fixture source policy must remain synthetic-only");
  const ids = fixtureSet.fixtures.map((fixture) => fixture.id);
  assert(JSON.stringify(ids) === JSON.stringify(requiredIds), "fixture ids mismatch: " + ids.join(", "));
  for (const fixture of fixtureSet.fixtures) {
    assert(fixture.decision?.toc?.contentGeneration === "none", fixture.id + ": TOC generation must be none");
    assert(fixture.decision?.summary?.contentGeneration === "none", fixture.id + ": summary generation must be none");
  }

  const results = fixtureSet.fixtures.map(evaluateFixture);
  const report = {
    gate: "body-layout-v2-baseline",
    mode: "contract-closure",
    fixtureCount: results.length,
    results,
    passed: results.every((result) => result.passed),
    note: "The historical expected gaps are retained as fixture provenance; PASS now means the v2 contract closes them.",
  };
  if (reportPath) await fs.writeFile(path.resolve(process.cwd(), reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
