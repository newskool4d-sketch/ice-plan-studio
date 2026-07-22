#!/usr/bin/env node
/**
 * 적응 조판 2-pass 루프 CLI.
 *
 * 사용: node scripts/fit-layout.cjs <model.json> <출력.hwpx> [--template boncheong]
 * 출력: 보정 리포트 JSON (stdout). 최종 채택 간격으로 <출력.hwpx>가 남는다.
 *
 * 보정 로직은 electron/layout-fit.cjs에 있고 여기서는 생성기(파이썬) 실행만 맡는다.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fitLayout } = require(path.join(__dirname, '..', 'electron', 'layout-fit.cjs'));
const TOKENS = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout-tokens.json'), 'utf8'));

// py 런처가 없는 PC(파이썬 직접 설치)를 위해 python 폴백을 둔다 — main.cjs와 같은 정책.
function python(args) {
  let lastError = null;
  for (const runner of ['py', 'python']) {
    try {
      return execFileSync(runner, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`파이썬 실행 실패: ${lastError && (lastError.stderr || lastError.message)}`);
}

async function main() {
  const [modelPath, outputPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const templateIndex = process.argv.indexOf('--template');
  const template = templateIndex === -1 ? 'boncheong' : process.argv[templateIndex + 1];
  if (!modelPath || !outputPath) {
    console.error('사용법: node scripts/fit-layout.cjs <model.json> <출력.hwpx> [--template boncheong]');
    process.exit(2);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-fit-'));
  const generator = path.join(__dirname, 'model_to_hwpx.py');
  const regenerate = async (spacing) => {
    const candidate = path.join(workDir, `fit-${spacing.lineSpacingPercent}-${spacing.paraNextHwpUnit}.hwpx`);
    python([generator, modelPath, candidate, '--template', template,
            '--line-spacing', String(spacing.lineSpacingPercent),
            '--para-next', String(spacing.paraNextHwpUnit)]);
    return fs.readFileSync(candidate);
  };

  try {
    const report = await fitLayout(regenerate, TOKENS.adaptiveSpacing);
    // 최종 채택 간격으로 산출물을 한 번 더 생성한다(중간 후보를 그대로 쓰지 않음).
    python([generator, modelPath, outputPath, '--template', template,
            '--line-spacing', String(report.final.spacing.lineSpacingPercent),
            '--para-next', String(report.final.spacing.paraNextHwpUnit)]);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
