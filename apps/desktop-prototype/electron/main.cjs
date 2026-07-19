const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

// 패키징(asar) 환경에서는 Python이 asar 내부를 읽지 못하므로 unpacked 경로로 치환한다.
const scriptPath = (name) =>
  path.join(__dirname, '..', 'scripts', name).replace('app.asar', 'app.asar.unpacked');

// Python 실행기: py 런처가 없는 PC(파이썬 직접 설치)를 위해 python 폴백을 지원한다.
function runPython(args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const tryLaunch = (candidates) => {
      const [command, ...rest] = candidates;
      const child = spawn(command, args, { windowsHide: true });
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
        else settle(reject, new Error(stderr || `변환 실패 (${code})`));
      });
    };
    tryLaunch(['py', 'python']);
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

function runGenerator(modelPath, outputPath) {
  return runPython([scriptPath('model_to_hwpx.py'), modelPath, outputPath]);
}

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
    await runGenerator(modelPath, result.filePath);
    return { canceled: false, filePath: result.filePath };
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
  await fs.writeFile(result.filePath, JSON.stringify({ schemaVersion: '0.1', ...profile }, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('load-profile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'ICE Plan Studio 프로필 불러오기',
    properties: ['openFile'],
    filters: [{ name: 'ICE Plan Studio 프로필', extensions: ['iceprofile'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const profile = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
  return { canceled: false, filePath: result.filePaths[0], profile };
});

ipcMain.handle('extract-hwpx', async (_event, filePath) => {
  let stdout = '';
  await runPython([scriptPath('extract_hwpx_text.py'), filePath], {
    onStdout: (chunk) => { stdout += chunk.toString(); },
  });
  return { text: stdout };
});

ipcMain.handle('save-project', async (_event, project) => {
  const result = await dialog.showSaveDialog({
    title: 'ICE Plan Studio 프로젝트 저장',
    defaultPath: `${project?.loadedFile || '문서작업'}.iceplan`,
    filters: [{ name: 'ICE Plan Studio 프로젝트', extensions: ['iceplan'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify({ schemaVersion: '0.1', ...project }, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('load-project', async () => {
  const result = await dialog.showOpenDialog({
    title: 'ICE Plan Studio 프로젝트 불러오기',
    properties: ['openFile'],
    filters: [{ name: 'ICE Plan Studio 프로젝트', extensions: ['iceplan'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const project = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
  return { canceled: false, filePath: result.filePaths[0], project };
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });



