#!/usr/bin/env node
import { parseMarkdown } from "../src/domain/markdownParser.js";
import { applyFrontMatterDecision, ensurePlanDecisions, pagePlanFromDecisions } from "../src/domain/planDecisions.js";
import { createPreviewProjection } from "../src/domain/previewProjection.js";

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
const blank = createPreviewProjection({
  ...decided,
  metadata: { ...decided.metadata, pages: pages.map((page) => page.type === "toc" ? { ...page, blocks: [], decisionMode: "template" } : page) },
});
assert(blank.pages.find((page) => page.type === "toc").blocks.length === 0, "blank TOC gained synthetic text");
console.log(JSON.stringify({
  gate: "body-layout-v2-rendering",
  passed: true,
  checks: ["dedicated source TOC", "dedicated source summary", "front-matter de-duplication", "worldschool profile", "blank frame without synthetic text"],
}, null, 2));
