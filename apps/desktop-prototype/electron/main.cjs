const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

// 패키징(asar) 환경에서는 Python이 asar 내부를 읽지 못하므로 unpacked 경로로 치환한다.
const scriptPath = (name) =>
  path.join(__dirname, '..', 'scripts', name).replace('app.asar', 'app.asar.unpacked');

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
  return new Promise((resolve, reject) => {
    const script = scriptPath('model_to_hwpx.py');
    const child = spawn('py', [script, modelPath, outputPath], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `변환 실패 (${code})`)));
  });
}

ipcMain.handle('export-hwpx', async (_event, model) => {
  const result = await dialog.showSaveDialog({
    title: 'HWPX로 내보내기',
    defaultPath: `${model?.metadata?.title || 'ice-plan-document'}.hwpx`,
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
  return new Promise((resolve, reject) => {
    const script = scriptPath('extract_hwpx_text.py');
    const child = spawn('py', [script, filePath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ text: stdout }) : reject(new Error(stderr || `HWPX 추출 실패 (${code})`)));
  });
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



