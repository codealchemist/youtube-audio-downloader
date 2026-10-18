import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { canFakeYtdlp, launchApp, videoInput } from './app.js'

let run

test.afterEach(async () => {
  await run?.close()
  run = null
})

test.describe('window', () => {
  test.beforeEach(async () => {
    run = await launchApp()
  })

  test('shows the downloader and the download folder', async () => {
    const { window, audioFolder } = run
    await expect(window).toHaveTitle('YouTube Audio Downloader')
    await expect(videoInput(window)).toBeVisible()
    await expect(window.getByTestId('folder')).toHaveText(audioFolder)
    expect(fs.existsSync(audioFolder)).toBe(true)
  })

  test('the page has no Node access and only the bridge API', async () => {
    const page = await run.window.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      module: typeof window.module,
      bridge: Object.keys(window.yas).sort()
    }))
    expect(page).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      bridge: ['changeFolder', 'download', 'getState', 'onMetadata', 'onProgress', 'showFile']
    })
  })

  test('the window is sandboxed and isolated', async () => {
    const prefs = await run.app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox }
    })
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true })
  })

  test('blocks pop-ups and navigation away from the app', async () => {
    const { window } = run
    const url = window.url()
    expect(await window.evaluate(() => window.open('https://example.com') === null)).toBe(true)
    await window.evaluate(() => { window.location.href = 'https://example.com' })
    await window.waitForTimeout(500)
    expect(window.url()).toBe(url)
  })

  test('has a Content-Security-Policy that blocks inline scripts', async () => {
    const { window } = run
    const ran = await window.evaluate(async () => {
      const script = document.createElement('script')
      script.textContent = 'window.inlineRan = true'
      document.body.append(script)
      await new Promise(resolve => setTimeout(resolve, 100))
      return window.inlineRan === true
    })
    expect(ran).toBe(false)
  })

  test('rejects input that is not a YouTube video', async () => {
    const { window } = run
    const input = videoInput(window)
    await input.fill('https://example.com/watch?v=dQw4w9WgXcQ')
    await input.press('Enter')
    await expect(window.getByTestId('metadata')).toHaveText('ERROR: That is not a YouTube link or video id.')
    await expect(input).toBeEnabled()
  })
})

test.describe('downloading', () => {
  test.skip(!canFakeYtdlp, 'The fake yt-dlp only runs on macOS and Linux')

  test.beforeEach(async () => {
    run = await launchApp()
  })

  test('saves a video as mp3 and plays it', async () => {
    const { window, audioFolder } = run
    const input = videoInput(window)
    await input.fill('https://www.youtube.com/watch?v=e2eTestSong')
    await input.press('Enter')

    await expect(window.getByRole('button', { name: 'Show in folder' })).toBeVisible({ timeout: 30 * 1000 })
    // The title is shown as text, not HTML.
    await expect(window.getByTestId('metadata')).toHaveText('E2E Test Song <b>not bold</b>')
    expect(await window.locator('#metadata b').count()).toBe(0)

    const files = fs.readdirSync(audioFolder)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^E2E Test Song .*not bold.*\.mp3$/)
    const mp3 = fs.readFileSync(path.join(audioFolder, files[0]))
    // ID3 tag first, as written with metadata.
    expect(mp3.subarray(0, 3).toString()).toBe('ID3')

    const audioSrc = await window.locator('#audio').getAttribute('src')
    expect(decodeURIComponent(audioSrc).endsWith(files[0])).toBe(true)
    await expect(input).toBeEnabled()
  })

  test('shows when a video is unavailable', async () => {
    const { window, audioFolder } = run
    const input = videoInput(window)
    await input.fill('e2eMissing0')
    await input.press('Enter')
    await expect(window.getByTestId('metadata')).toHaveText('ERROR: Video unavailable', { timeout: 30 * 1000 })
    expect(fs.readdirSync(audioFolder)).toEqual([])
  })
})

test('warns when yt-dlp is not installed', async () => {
  run = await launchApp({ env: { YTDLP_PATH: path.join(process.cwd(), 'no-such-yt-dlp') } })
  await expect(run.window.getByTestId('warning')).toContainText('yt-dlp not found')
})
