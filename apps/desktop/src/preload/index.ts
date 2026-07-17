import { contextBridge, ipcRenderer } from 'electron';
import type { IpcEventChannel, IpcEventMap, IpcInvokeChannel, IpcInvokeMap, SmoothcutApi } from '@smoothcut/shared';

const api: SmoothcutApi = {
  invoke: <C extends IpcInvokeChannel>(channel: C, ...args: Parameters<IpcInvokeMap[C]>) =>
    ipcRenderer.invoke(channel, ...args) as Promise<ReturnType<IpcInvokeMap[C]>>,
  on: <C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventMap[C]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: IpcEventMap[C]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform as 'darwin' | 'win32',
};

contextBridge.exposeInMainWorld('smoothcut', api);
