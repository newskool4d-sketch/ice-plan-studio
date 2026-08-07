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
const python = process.platform === "win32" ? "py" : "python3";
const pythonArgs = process.platform === "win32" ? ["-3"] : [];
const inspected = JSON.parse(execFileSync(python, [...pythonArgs, path.join(here, "inspect_hwpx_layout.py"), hwpxPath], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
// 비교 제외 2종: ① 구조 제목 틀(repeatHeader=0) — 표가 아니라 제목 표현이며
// verify-body-layout-v2-hwpx.py가 서식까지 따로 검증한다. ② 목차 표 — HWPX는
// 실제 조판 쪽번호, 미리보기는 "자동" 표기가 설계상 정답이라 셀 동등성이 성립
// 하지 않는다. 요약 4요소 파생 표는 양쪽 동일해야 하므로 비교에 포함된다.
const isTocTable = (rows) => JSON.stringify(rows[0] || []) === JSON.stringify(["구성 항목", "쪽"]);
const expectedTables = preview.pages.flatMap((page) => page.blocks).filter((block) => block.type === "table" && !isTocTable(block.rows));
const outputTables = inspected.tables.filter((table) => table.widthHwpUnit === preview.tokens.page.bodyWidthHwpUnit && table.repeatHeader && !isTocTable(table.rows));
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
