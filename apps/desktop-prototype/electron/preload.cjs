const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('icePlan', {
  // 설치본이 어느 빌드인지 앱에서 바로 확인하려면 필요하다 — 없으면 app.asar을
  // 뜯어 마커를 찾아야 했다(2026-07-23 실사용 확인 과정).
  appVersion: () => ipcRenderer.invoke('app-version'),
  exportHwpx: (model) => ipcRenderer.invoke('export-hwpx', model),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  renderCompositionPreview: (model) => ipcRenderer.invoke('render-composition-preview', model),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  loadProfile: () => ipcRenderer.invoke('load-profile'),
  loadPlanInput: (filePath) => ipcRenderer.invoke('load-plan-input', filePath),
  extractHwpx: (filePath) => ipcRenderer.invoke('extract-hwpx', filePath),
  checkFonts: (required) => ipcRenderer.invoke('check-fonts', required),
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  loadProject: () => ipcRenderer.invoke('load-project'),
});



