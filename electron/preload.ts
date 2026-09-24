import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, Snap } from '../src/types'

const api: Api = {
  snap: () => ipcRenderer.invoke('snap'),
  on: (cb) => {
    const f = (_: IpcRendererEvent, s: Snap) => cb(s)
    ipcRenderer.on('snap', f)
    return () => {
      ipcRenderer.off('snap', f)
    }
  },
  hover: (on) => ipcRenderer.send('hover', on),
}

contextBridge.exposeInMainWorld('api', api)
