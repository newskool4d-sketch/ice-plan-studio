const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('icePlan', {
  exportHwpx: (model) => ipcRenderer.invoke('export-hwpx', model),
  renderCompositionPreview: (model) => ipcRenderer.invoke('render-composition-preview', model),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  loadProfile: () => ipcRenderer.invoke('load-profile'),
  loadPlanInput: (filePath) => ipcRenderer.invoke('load-plan-input', filePath),
  extractHwpx: (filePath) => ipcRenderer.invoke('extract-hwpx', filePath),
  checkFonts: (required) => ipcRenderer.invoke('check-fonts', required),
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  loadProject: () => ipcRenderer.invoke('load-project'),
});



