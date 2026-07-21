#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewProjection } from "../src/domain/previewProjection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const modelPath = process.argv[2] || path.join(appRoot, "test-data/layout-engine/metropolitan-a.model.json");
const hwpxPath = process.argv[3] || path.join(appRoot, "test-data/layout-engine/metropolitan-a.hwpx");
const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
const preview = createPreviewProjection(model);
const inspected = JSON.parse(execFileSync(process.platform === "win32" ? "py" : "python3", [path.join(here, "inspect_hwpx_layout.py"), hwpxPath], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
const expectedTables = preview.pages.flatMap((page) => page.blocks).filter((block) => block.type === "table");
const outputTables = inspected.tables.filter((table) => table.widthHwpUnit === preview.tokens.page.bodyWidthHwpUnit);
const failures = [];
if (expectedTables.length !== outputTables.length) failures.push(`표 개수: preview=${expectedTables.length}, hwpx=${outputTables.length}`);
for (const [index, expected] of expectedTables.entries()) {
  const actual = outputTables[index];
  if (!actual) continue;
  if (actual.widthHwpUnit !== expected.widthHwpUnit) failures.push(`표 ${index + 1} 너비: ${actual.widthHwpUnit} != ${expected.widthHwpUnit}`);
  if (actual.rowCnt !== expected.rows.length || actual.colCnt !== expected.rows[0].length) failures.push(`표 ${index + 1} 구조: ${actual.rowCnt}x${actual.colCnt} != ${expected.rows.length}x${expected.rows[0].length}`);
  if (actual.repeatHeader !== preview.tokens.table.repeatHeader) failures.push(`표 ${index + 1} 머리글 반복 불일치`);
  if (JSON.stringify(actual.rows) !== JSON.stringify(expected.rows)) failures.push(`표 ${index + 1} 셀 내용 불일치`);
}
for (const page of preview.pages) if (!["body", "cover", "inner-cover"].includes(page.type) && !inspected.text.includes(page.title)) failures.push(`페이지 유형 제목 누락: ${page.type} (${page.title})`);
const report = { model: path.relative(appRoot, modelPath), hwpx: path.relative(appRoot, hwpxPath), pageCount: preview.pages.length, expectedTableCount: expectedTables.length, outputTableCount: outputTables.length, passed: failures.length === 0, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
