const fs = require('node:fs/promises');
const path = require('node:path');
const { parse, VERSION: kordocVersion } = require('kordoc');
const { kordocResultToPlanIR, parseTextToPlanIR } = require('./plan-ir.cjs');

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.hwp', '.hwpx']);

function inputFormat(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`지원하지 않는 입력 형식입니다: ${extension || '확장자 없음'}`);
  return extension.slice(1);
}

async function loadPlanInput(filePath) {
  const format = inputFormat(filePath);
  const title = path.basename(filePath);
  if (format === 'md' || format === 'txt') {
    const input = await fs.readFile(filePath, 'utf8');
    return parseTextToPlanIR(input, { format, title, filePath });
  }

  const source = await fs.readFile(filePath);
  const result = await parse(source, { filePath, keepTrailingEmptyCols: true });
  return kordocResultToPlanIR(result, { filePath, title });
}

function kordocSmokeInfo() {
  return { package: 'kordoc', version: kordocVersion };
}

module.exports = { inputFormat, kordocSmokeInfo, loadPlanInput };
