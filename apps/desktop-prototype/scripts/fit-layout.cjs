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

const { fitLayout, spacingCalibrationCurrent } = require(path.join(__dirname, '..', 'electron', 'layout-fit.cjs'));
const TOKENS = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout-tokens.json'), 'utf8'));

// py 런처가 없는 PC(파이썬 직접 설치)를 위해 python 폴백을 둔다 — main.cjs와 같은 정책.
function python(args) {
  let lastError = null;
  const runners = process.platform === 'win32'
    ? [['py', '-3'], ['python']]
    : [['python3'], ['python']];
  for (const [runner, ...prefixArgs] of runners) {
    try {
      return execFileSync(runner, [...prefixArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const profileId = model?.metadata?.layout?.profile
    || (model?.metadata?.documentKind === 'school-guidance-basic-plan' ? 'worldschool-2026' : null);
  const layoutProfile = profileId ? TOKENS.layoutProfiles?.[profileId] : null;
  const regenerate = async (spacing) => {
    const candidate = path.join(workDir, `fit-${spacing.lineSpacingPercent}-${spacing.paraNextHwpUnit}.hwpx`);
    python([generator, modelPath, candidate, '--template', template,
            '--line-spacing', String(spacing.lineSpacingPercent),
            '--para-next', String(spacing.paraNextHwpUnit)]);
    return fs.readFileSync(candidate);
  };

  try {
    const bodySizePt = layoutProfile?.bodySizePt || TOKENS.typography.body.sizePt;
    const calibrationStale = !spacingCalibrationCurrent(TOKENS.adaptiveSpacing, bodySizePt);
    if (template === TOKENS.adaptiveSpacing.template
      && (layoutProfile?.adaptiveSpacingCalibrated === false || calibrationStale)) {
      python([generator, modelPath, outputPath, '--template', template]);
      console.log(JSON.stringify({
        applied: false,
        reason: 'profile-calibration-pending',
        notice: `본문 ${bodySizePt}pt 적용 — 한글 COM 실물 교정 전까지 자동 간격 조정을 사용하지 않습니다.`,
        final: {
          spacing: {
            lineSpacingPercent: TOKENS.adaptiveSpacing.baseLineSpacingPercent,
            paraNextHwpUnit: 0,
          },
        },
        attempts: [],
      }, null, 2));
      return;
    }
    const { finalBuffer, ...report } = await fitLayout(regenerate, TOKENS.adaptiveSpacing);
    // 생성이 결정적이므로 채택 간격의 후보 바이트가 곧 최종 산출물이다 — 재생성하지 않는다.
    fs.writeFileSync(outputPath, finalBuffer);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
