import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { denyPermissions, hardenContents, isTrustedSender, isTrustedUrl, windowOptions } from '../../src/main/security.js'

const indexFile = path.resolve('src/renderer/index.html')
const indexUrl = pathToFileURL(indexFile).href

describe('windowOptions', () => {
  it('isolates the renderer from Node', () => {
    const { webPreferences } = windowOptions('/app/preload.cjs')
    expect(webPreferences).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
  })
})

describe('isTrustedUrl', () => {
  it('accepts the app page', () => {
    expect(isTrustedUrl(indexUrl, indexFile)).toBe(true)
    expect(isTrustedUrl(`${indexUrl}#x`, indexFile)).toBe(true)
  })

  it.each([
    'https://example.com/',
    pathToFileURL(path.resolve('src/renderer/other.html')).href,
    'file:///etc/passwd',
    'not a url',
    undefined
  ])('rejects %s', url => {
    expect(isTrustedUrl(url, indexFile)).toBe(false)
  })

  it('reads the sender frame', () => {
    expect(isTrustedSender({ senderFrame: { url: indexUrl } }, indexFile)).toBe(true)
    expect(isTrustedSender({ senderFrame: null }, indexFile)).toBe(false)
  })
})

describe('hardenContents', () => {
  it('blocks navigation, webviews and new windows', () => {
    const handlers = {}
    const contents = {
      on: (name, handler) => { handlers[name] = handler },
      setWindowOpenHandler: vi.fn()
    }
    hardenContents(contents)

    for (const name of ['will-navigate', 'will-attach-webview']) {
      const event = { preventDefault: vi.fn() }
      handlers[name](event)
      expect(event.preventDefault).toHaveBeenCalled()
    }
    const openHandler = contents.setWindowOpenHandler.mock.calls[0][0]
    expect(openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
  })
})

describe('denyPermissions', () => {
  it('refuses every permission', () => {
    const session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    denyPermissions(session)

    const callback = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0]({}, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(session.setPermissionCheckHandler.mock.calls[0][0]({}, 'clipboard-read')).toBe(false)
  })
})
