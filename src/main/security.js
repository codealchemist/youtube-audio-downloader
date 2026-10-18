// Window settings and guards that keep the renderer away from Node and the
// web. The page only talks to the main process through the preload bridge.
import { fileURLToPath } from 'node:url'

export function windowOptions (preload) {
  return {
    width: 1040,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    backgroundColor: '#0c0c10',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  }
}

// Only the app's own page may call into the main process.
export function isTrustedUrl (url, indexFile) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && fileURLToPath(parsed) === indexFile
  } catch {
    return false
  }
}

export function isTrustedSender (event, indexFile) {
  return isTrustedUrl(event?.senderFrame?.url, indexFile)
}

// No navigation, pop-ups, webviews or permission prompts (camera, location...).
export function hardenContents (contents) {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function denyPermissions (session) {
  session.setPermissionRequestHandler((webContents, permission, respond) => respond(false))
  session.setPermissionCheckHandler(() => false)
}
