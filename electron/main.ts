import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { read, watch } from './db'
import { money, sum } from '../src/usage'
import type { Snap } from '../src/types'

const W = 520
const H = 360
const dir = import.meta.dirname
const url = process.env.VITE_DEV_SERVER_URL
const pub = url ? join(dir, '../public') : join(dir, '../dist')
const login = { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }

let win: BrowserWindow | undefined
let tray: Tray | undefined
let menu: Menu | undefined
let snap: Snap | undefined

const place = () => {
  const { bounds: b } = screen.getPrimaryDisplay()
  win?.setBounds({ x: Math.round(b.x + (b.width - W) / 2), y: b.y, width: W, height: H })
}

const push = () => {
  snap = read()
  win?.webContents.send('snap', snap)
  tray?.setToolTip(snap.err ? `Spend Notch: ${snap.err}` : `Copilot today: ${money(sum(snap.rows, 'nano'))}`)
}

const show = (on = !win?.isVisible()) => {
  if (on) win?.showInactive()
  else win?.hide()
  const i = menu?.getMenuItemById('show')
  if (i) i.checked = on
}

const createWin = () => {
  win = new BrowserWindow({
    width: W,
    height: H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: join(dir, 'preload.cjs'), sandbox: true, backgroundThrottling: false },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  place()
  win.once('ready-to-show', () => win?.showInactive())
  if (url) win.loadURL(url)
  else win.loadFile(join(dir, '../dist/index.html'))
}

const createTray = () => {
  menu = Menu.buildFromTemplate([
    { id: 'show', label: 'Show notch', type: 'checkbox', checked: true, click: (i) => show(i.checked) },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings(login).openAtLogin,
      click: (i) => app.setLoginItemSettings({ ...login, openAtLogin: i.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ])
  tray = new Tray(nativeImage.createFromPath(join(pub, 'tray.png')))
  tray.setContextMenu(menu)
  tray.on('click', () => show())
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => show(true))
  ipcMain.handle('snap', () => snap)
  ipcMain.on('hover', (_, on: boolean) => win?.setIgnoreMouseEvents(!on, { forward: true }))
  app.whenReady().then(() => {
    createWin()
    createTray()
    push()
    watch(push)
    screen.on('display-added', place)
    screen.on('display-removed', place)
    screen.on('display-metrics-changed', place)
  })
}
