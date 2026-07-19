const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('icePlan', {
  exportHwpx: (model) => ipcRenderer.invoke('export-hwpx', model),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  loadProfile: () => ipcRenderer.invoke('load-profile'),
  extractHwpx: (filePath) => ipcRenderer.invoke('extract-hwpx', filePath),
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  loadProject: () => ipcRenderer.invoke('load-project'),
});



