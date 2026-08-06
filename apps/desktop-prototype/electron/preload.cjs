const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  // Electron 32부터 File.path가 제거됐다. 이것 없이 input.path에 의존하면 경로가
  // undefined가 되어 렌더러가 HWPX 바이너리를 markdown 텍스트로 파싱한다
  // (실측: 블록이 ZIP 헤더 'PK\x03\x04'로 채워져 section0.xml이 깨졌다).
  pathForFile: (file) => webUtils.getPathForFile(file),
  extractHwpx: (filePath) => ipcRenderer.invoke('extract-hwpx', filePath),
  checkFonts: (required) => ipcRenderer.invoke('check-fonts', required),
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  loadProject: () => ipcRenderer.invoke('load-project'),
});



