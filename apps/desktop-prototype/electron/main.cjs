const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { renderHwpxToSvg } = require('kordoc');
const { kordocSmokeInfo, loadPlanInput } = require('./input-adapters.cjs');
const { createProfileArchive, createProjectArchive, readProfileArchive, readProjectArchive } = require('./workspace-packages.cjs');
const { renderPagedPreview } = require('./preview-split.cjs');
const { fitLayout } = require('./layout-fit.cjs');

const LAYOUT_TOKENS = JSON.parse(
  require('node:fs').readFileSync(
    path.join(__dirname, '..', 'scripts', 'layout-tokens.json').replace('app.asar', 'app.asar.unpacked'),
    'utf8'));

// 패키징(asar) 환경에서는 Python이 asar 내부를 읽지 못하므로 unpacked 경로로 치환한다.
const scriptPath = (name) =>
  path.join(__dirname, '..', 'scripts', name).replace('app.asar', 'app.asar.unpacked');

// Python 실행기: py 런처가 없는 PC(파이썬 직접 설치)를 위해 python 폴백을 지원한다.
function runPython(args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const tryLaunch = (candidates) => {
      const [[command, ...prefixArgs], ...rest] = candidates;
      const child = spawn(command, [...prefixArgs, ...args], {
        windowsHide: true,
        env: { ...process.env, ICE_PLAN_ELECTRON_EXEC: process.execPath, PYTHONIOENCODING: 'utf-8' },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      if (onStdout) child.stdout.on('data', onStdout);
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          if (rest.length) { tryLaunch(rest); return; }
          settle(reject, new Error('Python을 찾을 수 없습니다. Python 3.11 이상을 설치해 주세요.'));
          return;
        }
        settle(reject, error);
      });
      child.on('close', (code) => {
        if (code === 0) settle(resolve);
        else if (rest.length && /WindowsApps|Unable to create process/i.test(stderr)) tryLaunch(rest);
        else settle(reject, new Error(stderr || `변환 실패 (${code})`));
      });
    };
    tryLaunch(process.platform === 'win32' ? [['py', '-3'], ['python']] : [['python3'], ['python']]);
  });
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#eef2f6',
    title: 'ICE Plan Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
};

function outputTemplate(model) {
  return model?.metadata?.layout?.template === 'gonmun' ? 'gonmun' : 'boncheong';
}

function runGenerator(modelPath, outputPath, template, spacing) {
  const args = [scriptPath('model_to_hwpx.py'), modelPath, outputPath, '--template', template];
  if (spacing) {
    args.push('--line-spacing', String(spacing.lineSpacingPercent),
              '--para-next', String(spacing.paraNextHwpUnit));
  }
  return runPython(args);
}

/**
 * 9단계 적응 조판 — 분량에 따라 본문 간격을 조정해 생성한다.
 *
 * 미리보기와 내보내기가 **같은 간격**을 써야 한다. 한쪽만 보정하면 화면과 출력이
 * 갈라진다. 그래서 두 IPC 핸들러가 이 함수 하나를 공유한다.
 *
 * 보정 루프는 후보를 여러 번 생성하므로(최대 사다리 길이만큼) 무보정 경로보다 느리다.
 * 적응 조판 대상이 아닌 템플릿은 예전처럼 한 번만 생성한다.
 */
// 모델 내용 → 보정 결정 캐시. 미리보기가 계산한 결정을 내보내기가 재사용해
// 같은 루프를 두 번 돌지 않는다(루프 1회 실측 7초 내외 — 실사용 지연 보고의 원인).
// 결정은 모델+토큰만의 함수라 결정적이며, 캐시 히트 시 채택 간격으로 1회만 생성한다.
const fitDecisionCache = new Map();
const FIT_CACHE_LIMIT = 24;

function fitCacheKey(model) {
  return require('node:crypto').createHash('sha1').update(JSON.stringify(model)).digest('hex');
}

async function generateFitted(model, workDir, modelPath, outputPath) {
  const template = outputTemplate(model);
  const tokens = LAYOUT_TOKENS.adaptiveSpacing;
  const profileId = model?.metadata?.layout?.profile
    || (model?.metadata?.documentKind === 'school-guidance-basic-plan' ? 'worldschool-2026' : null);
  const layoutProfile = profileId ? LAYOUT_TOKENS.layoutProfiles?.[profileId] : null;
  if (template !== tokens.template) {
    await runGenerator(modelPath, outputPath, template);
    return null;
  }
  if (layoutProfile?.adaptiveSpacingCalibrated === false) {
    await runGenerator(modelPath, outputPath, template);
    const spacing = {
      lineSpacingPercent: tokens.baseLineSpacingPercent,
      paraNextHwpUnit: 0,
    };
    return {
      applied: false,
      reason: 'profile-calibration-pending',
      notice: `본문 ${layoutProfile.bodySizePt}pt 적용 — 한글 COM 실물 교정 전까지 자동 간격 조정을 사용하지 않습니다.`,
      base: { spacing, pageCount: null },
      final: { spacing, pageCount: null },
    };
  }
  const cacheKey = fitCacheKey(model);
  const cached = fitDecisionCache.get(cacheKey);
  if (cached) {
    await runGenerator(modelPath, outputPath, template, cached.final.spacing);
    return cached;
  }
  let candidateIndex = 0;
  const regenerate = async (spacing) => {
    const candidate = path.join(workDir, `candidate-${candidateIndex += 1}.hwpx`);
    await runGenerator(modelPath, candidate, template, spacing);
    return fs.readFile(candidate);
  };
  const { finalBuffer, ...report } = await fitLayout(regenerate, tokens);
  // 생성이 결정적이므로 채택 간격의 후보 바이트가 곧 최종 산출물이다 — 재생성하지 않는다.
  await fs.writeFile(outputPath, finalBuffer);
  fitDecisionCache.set(cacheKey, report);
  if (fitDecisionCache.size > FIT_CACHE_LIMIT) {
    fitDecisionCache.delete(fitDecisionCache.keys().next().value);
  }
  return report;
}

/** 렌더러에 넘길 조정 고지. 묵시 변경 금지 — 조정했으면 반드시 사용자에게 보인다. */
function adjustmentPayload(report) {
  if (!report) return null;
  return {
    applied: report.applied,
    reason: report.reason,
    notice: report.notice,
    baseLineSpacingPercent: report.base.spacing.lineSpacingPercent,
    finalLineSpacingPercent: report.final.spacing.lineSpacingPercent,
    basePageCount: report.base.pageCount,
    finalPageCount: report.final.pageCount,
  };
}

ipcMain.handle('app-version', () => app.getVersion());

// 내보내기 성공 후 "폴더 열기" — 탐색기에서 방금 만든 파일을 선택한 상태로 연다.
ipcMain.handle('show-in-folder', (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('파일 경로가 필요합니다.');
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('render-composition-preview', async (_event, model) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-plan-preview-'));
  const modelPath = path.join(workDir, 'document.model.json');
  const hwpxPath = path.join(workDir, 'document.hwpx');
  try {
    await fs.writeFile(modelPath, JSON.stringify(model), 'utf8');
    const fitted = await generateFitted(model, workDir, modelPath, hwpxPath);
    // kordoc reflow는 하드 쪽 나눔(pageBreak="1")을 무시하므로 쪽 나눔 경계로
    // 분할 렌더한다 — preview-split.cjs 참조.
    const rendered = await renderPagedPreview(await fs.readFile(hwpxPath), renderHwpxToSvg);
    return {
      svg: rendered.svg,
      pages: rendered.pages,
      pageCount: rendered.pageCount,
      warnings: rendered.warnings,
      stats: rendered.stats,
      layoutAdjustment: adjustmentPayload(fitted),
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

ipcMain.handle('export-hwpx', async (_event, model) => {
  // metadata.title은 원본 파일명(예: "계획안.md")을 그대로 담고 있을 수 있어
  // 확장자를 제거하지 않으면 저장 파일명이 "계획안.md.hwpx"처럼 이중 확장자가 된다.
  const baseName = (model?.metadata?.title || 'ice-plan-document').replace(/\.(md|txt|hwpx?|iceplan)$/i, '');
  const result = await dialog.showSaveDialog({
    title: 'HWPX로 내보내기',
    defaultPath: `${baseName}.hwpx`,
    filters: [{ name: 'HWPX 문서', extensions: ['hwpx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-plan-'));
  const modelPath = path.join(workDir, 'document.model.json');
  await fs.writeFile(modelPath, JSON.stringify(model), 'utf8');
  try {
    // 미리보기와 같은 보정 경로를 쓴다 — 한쪽만 보정하면 화면과 출력이 갈라진다.
    const fitted = await generateFitted(model, workDir, modelPath, result.filePath);
    return { canceled: false, filePath: result.filePath, layoutAdjustment: adjustmentPayload(fitted) };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});


ipcMain.handle('save-profile', async (_event, profile) => {
  const result = await dialog.showSaveDialog({
    title: 'ICE Plan Studio 프로필 저장',
    defaultPath: '기관-브랜딩.iceprofile',
    filters: [{ name: 'ICE Plan Studio 프로필', extensions: ['iceprofile'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const packaged = createProfileArchive(profile);
  await fs.writeFile(result.filePath, packaged.buffer);
  return { canceled: false, filePath: result.filePath, schemaVersion: packaged.profile.schemaVersion };
});

ipcMain.handle('load-profile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'ICE Plan Studio 프로필 불러오기',
    properties: ['openFile'],
    filters: [{ name: 'ICE Plan Studio 프로필', extensions: ['iceprofile'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const loaded = readProfileArchive(await fs.readFile(result.filePaths[0]));
  return { canceled: false, filePath: result.filePaths[0], profile: loaded.profile, migratedFrom: loaded.migratedFrom, format: loaded.format };
});

ipcMain.handle('check-fonts', async (_event, required) => {
  // font_inspector는 누락 글꼴이 있으면 종료코드 1을 반환한다(정상 판정 결과이지
  // 실행 실패가 아님). runPython은 0이 아니면 reject하므로 stdout을 먼저 파싱한다.
  const args = [scriptPath('font_inspector.py')];
  if (Array.isArray(required) && required.length) args.push('--required', ...required);
  let stdout = '';
  const collect = (chunk) => { stdout += chunk.toString(); };
  try {
    await runPython(args, { onStdout: collect });
  } catch (error) {
    if (!stdout.trim()) {
      return { ok: false, error: `글꼴 검사 실행 실패: ${error.message}`, results: [], missing: [] };
    }
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return { ok: false, error: '글꼴 검사 결과를 해석하지 못했습니다.', results: [], missing: [] };
  }
});

ipcMain.handle('extract-hwpx', async (_event, filePath) => {
  let stdout = '';
  await runPython([scriptPath('extract_hwpx_text.py'), filePath], {
    onStdout: (chunk) => { stdout += chunk.toString(); },
  });
  return { text: stdout };
});

ipcMain.handle('load-plan-input', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('불러올 파일 경로가 필요합니다.');
  const model = await loadPlanInput(filePath);
  return { model, kordoc: kordocSmokeInfo() };
});

ipcMain.handle('save-project', async (_event, project) => {
  const result = await dialog.showSaveDialog({
    title: 'ICE Plan Studio 프로젝트 저장',
    // 렌더러는 v0.2 형태({ project: { metadata: { loadedFile } }, ... })로 보낸다.
    // 최상위 project.loadedFile을 읽으면 항상 undefined라 기본 파일명이 폴백으로 고정된다.
    defaultPath: `${project?.project?.metadata?.loadedFile?.replace(/\.(md|txt|hwpx?|iceplan)$/i, '') || '문서작업'}.iceplan`,
    filters: [{ name: 'ICE Plan Studio 프로젝트', extensions: ['iceplan'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const packaged = createProjectArchive(project);
  await fs.writeFile(result.filePath, packaged.buffer);
  return { canceled: false, filePath: result.filePath, schemaVersion: packaged.project.project.schemaVersion };
});

ipcMain.handle('load-project', async () => {
  const result = await dialog.showOpenDialog({
    title: 'ICE Plan Studio 프로젝트 불러오기',
    properties: ['openFile'],
    filters: [{ name: 'ICE Plan Studio 프로젝트', extensions: ['iceplan'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const loaded = readProjectArchive(await fs.readFile(result.filePaths[0]));
  return { canceled: false, filePath: result.filePaths[0], project: loaded.project, migratedFrom: loaded.migratedFrom, format: loaded.format };
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });



