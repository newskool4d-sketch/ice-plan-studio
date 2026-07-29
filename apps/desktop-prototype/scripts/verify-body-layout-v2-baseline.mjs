#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "layout-14pt-boundaries",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findPage(projection, type) {
  return projection.pages.find((page) => page.type === type);
}

function knownGapFor(fixture, projection) {
  const expected = fixture.expected || {};
  const observations = [];

  if (fixture.id === "toc-source") {
    const page = findPage(projection, "toc");
    assert(page, "toc-source projection has no toc page");
    const actualText = JSON.stringify(page.blocks);
    observations.push({
      id: "source-toc-detection",
      expectedGap: fixture.baseline.gap,
      detected: actualText.includes("목차 항목 입력") || !expected.tocPreserves.every((text) => actualText.includes(text)),
    });
  }

  if (fixture.id === "toc-missing-template" || fixture.id === "summary-missing-template") {
    const type = fixture.id.startsWith("toc") ? "toc" : "summary";
    const page = findPage(projection, type);
    assert(page, fixture.id + " projection has no " + type + " page");
    observations.push({
      id: type + "-template-placeholder",
      expectedGap: fixture.baseline.gap,
      detected: page.blocks.some((block) => expected.forbiddenText.includes(block.text)),
    });
  }

  if (fixture.id === "toc-missing-omitted") {
    observations.push({
      id: "toc-omission-decision",
      expectedGap: fixture.baseline.gap,
      detected: fixture.decision.toc.userDecision === "confirmed-with-warning" && !projection.pages.some((page) => page.type === "toc"),
    });
  }

  if (fixture.id === "body-opening-continuation") {
    observations.push({
      id: "body-role-pages",
      expectedGap: fixture.baseline.gap,
      detected: projection.pages.some((page) => page.type === "body") && !projection.pages.some((page) => page.type === "body-opening"),
    });
  }

  if (fixture.id === "bullet-override") {
    observations.push({
      id: "bullet-roundtrip",
      expectedGap: fixture.baseline.gap,
      detected: true,
      status: "deferred-to-visual-and-save-load-gate",
    });
  }

  if (fixture.id === "layout-14pt-boundaries") {
    observations.push({
      id: "14pt-profile",
      expectedGap: fixture.baseline.gap,
      detected: projection.tokens.typography.body.sizePt !== expected.bodyFontSizePt,
    });
  }

  return observations;
}

async function main() {
  const fixtureSet = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  assert(fixtureSet.schemaVersion === "body-layout-v2.contract-fixture.1", "unexpected fixture schema");
  assert(fixtureSet.sourcePolicy === "synthetic-only", "fixture source policy must remain synthetic-only");
  const ids = fixtureSet.fixtures.map((fixture) => fixture.id);
  assert(JSON.stringify(ids) === JSON.stringify(requiredIds), "fixture ids mismatch: " + ids.join(", "));

  const results = [];
  for (const fixture of fixtureSet.fixtures) {
    assert(fixture.decision?.toc?.contentGeneration === "none", fixture.id + ": TOC generation must be none");
    assert(fixture.decision?.summary?.contentGeneration === "none", fixture.id + ": summary generation must be none");
    const probePageTypes = fixture.expected.pageTypes.map((type) => {
      if (type === "body-opening" || type === "body-continuation") return "body";
      return type;
    });
    const model = {
      metadata: {
        title: "합성 기본계획",
        pages: probePageTypes.map((type) => ({ type })),
        layout: { coverProfile: "metropolitan-a" },
      },
      blocks: [{ type: "paragraph", text: "합성 본문" }],
    };
    let projection = null;
    let projectionError = null;
    try {
      projection = createPreviewProjection(model);
    } catch (error) {
      projectionError = String(error?.message || error);
    }
    assert(projection, fixture.id + ": current projection could not be created: " + (projectionError || "unknown error"));
    results.push({
      id: fixture.id,
      baseline: fixture.baseline,
      observations: projection ? knownGapFor(fixture, projection) : [{ id: "unsupported-page-role", expectedGap: fixture.baseline.gap, detected: true }],
    });
  }

  const report = {
    gate: "body-layout-v2-baseline",
    mode: "expected-gap",
    fixtureCount: results.length,
    results,
    passed: results.every((result) => result.observations.every((observation) => observation.detected)),
    note: "passed means the pre-implementation gaps are still observable; it is not a feature-pass result.",
  };
  if (reportPath) await fs.writeFile(path.resolve(process.cwd(), reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
