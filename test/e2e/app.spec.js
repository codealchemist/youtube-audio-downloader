import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { canFakeYtdlp, launchApp, videoInput } from './app.js'

const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

let run

test.afterEach(async () => {
  await run?.close()
  run = null
})

const songRows = window => window.getByTestId('songs').locator('.song')
const songRow = (window, title) => songRows(window).filter({ has: window.locator('.song-title', { hasText: title }) })
const jobs = window => window.getByTestId('queue').locator('.job')

test.describe('window', () => {
  test.beforeEach(async () => {
    run = await launchApp()
  })

  test('shows the downloader and the download folder', async () => {
    const { window, audioFolder } = run
    await expect(window).toHaveTitle('YouTube Audio Downloader')
    await expect(videoInput(window)).toBeVisible()
    await expect(window.getByTestId('folder')).toHaveText(audioFolder)
    const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    await expect(window.getByTestId('version')).toHaveText(`v${version}`)
    await expect(window.getByText('No songs yet.')).toBeVisible()
    await expect(window.getByTestId('now-title')).toHaveText('Nothing playing')
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
      bridge: [
        'addToQueue', 'changeFolder', 'clearFinished', 'deleteSong', 'getCover', 'getQueue', 'getState',
        'listSongs', 'onQueueChanged', 'onSongsChanged', 'removeFromQueue', 'renameSong', 'retryDownload',
        'shareSong', 'showSong'
      ]
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
    await expect(window.getByTestId('toast')).toHaveText('That is not a YouTube link or video id.')
    // Kept, so it can be corrected.
    await expect(input).toHaveValue('https://example.com/watch?v=dQw4w9WgXcQ')
    await expect(jobs(window)).toHaveCount(0)
  })
})

test.describe('downloading', () => {
  test.skip(!canFakeYtdlp, 'The fake yt-dlp only runs on macOS and Linux')

  test('saves a video to the library and plays it', async () => {
    run = await launchApp()
    const { window, audioFolder } = run
    const input = videoInput(window)
    await input.fill('https://www.youtube.com/watch?v=e2eTestSong')
    await input.press('Enter')
    await expect(input).toHaveValue('')

    const job = jobs(window).first()
    await expect(job).toHaveAttribute('data-status', 'done', { timeout: 30 * 1000 })
    await expect(job).toContainText('Saved to your library')
    // The title is shown as text, not HTML.
    await expect(job.locator('.job-title')).toHaveText('E2E Test Song <b>not bold</b>')
    expect(await window.locator('.job-title b, .song-title b').count()).toBe(0)

    const files = fs.readdirSync(audioFolder)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^E2E Test Song .*not bold.*\.mp3$/)
    const mp3 = fs.readFileSync(path.join(audioFolder, files[0]))
    // ID3 tag first, as written with metadata.
    expect(mp3.subarray(0, 3).toString()).toBe('ID3')

    const row = songRows(window).first()
    await expect(row.locator('.song-title')).toHaveText(files[0].replace(/\.mp3$/, ''))
    await expect(row.locator('.song-meta')).toContainText('Test Artist')

    await job.getByRole('button', { name: 'Play' }).click()
    await expect(window.getByTestId('now-title')).toHaveText(files[0].replace(/\.mp3$/, ''))
    const audioSrc = await window.locator('#audio').getAttribute('src')
    expect(decodeURIComponent(audioSrc).endsWith(files[0])).toBe(true)
  })

  test('downloads a queue of videos one after another', async () => {
    run = await launchApp({ env: { FAKE_YTDLP_DELAY_MS: '1500' } })
    const { window, audioFolder } = run
    await videoInput(window).fill('aaaaaaaaaaa https://youtu.be/bbbbbbbbbbb')
    await window.getByRole('button', { name: 'Add to queue' }).click()

    await expect(jobs(window)).toHaveCount(2)
    await expect(jobs(window).nth(0)).toHaveAttribute('data-status', /starting|downloading/)
    await expect(jobs(window).nth(1)).toHaveAttribute('data-status', 'queued')
    await expect(jobs(window).nth(1)).toContainText('Waiting')
    // The folder can't change under a running download.
    await expect(window.getByRole('button', { name: 'Change' })).toBeDisabled()

    await expect(jobs(window).nth(1)).toHaveAttribute('data-status', 'done', { timeout: 30 * 1000 })
    await expect(jobs(window).nth(0)).toHaveAttribute('data-status', 'done')
    await expect(window.getByRole('button', { name: 'Change' })).toBeEnabled()
    expect(fs.readdirSync(audioFolder).sort()).toEqual(['Song aaaaaaaaaaa.mp3', 'Song bbbbbbbbbbb.mp3'])
    await expect(songRows(window)).toHaveCount(2)

    await window.getByRole('button', { name: 'Clear completed' }).click()
    await expect(jobs(window)).toHaveCount(0)
  })

  test('shows when a video is unavailable and can retry it', async () => {
    run = await launchApp()
    const { window, audioFolder } = run
    await videoInput(window).fill('e2eMissing0')
    await videoInput(window).press('Enter')

    const job = jobs(window).first()
    await expect(job).toHaveAttribute('data-status', 'failed', { timeout: 30 * 1000 })
    await expect(job.locator('.job-status')).toHaveText('Video unavailable')
    expect(fs.readdirSync(audioFolder)).toEqual([])

    await job.getByRole('button', { name: 'Retry' }).click()
    await expect(job).toHaveAttribute('data-status', 'failed', { timeout: 30 * 1000 })
    await job.getByRole('button', { name: 'Remove' }).click()
    await expect(jobs(window)).toHaveCount(0)
  })
})

test.describe('library', () => {
  const SONGS = [
    { title: 'Plain Song', seconds: 30 },
    { title: 'Cover Song', artist: 'Cover Band', comment: LINK, cover: true, seconds: 30 }
  ]

  test.beforeEach(async () => {
    run = await launchApp({ songs: SONGS })
  })

  test('lists songs newest first, with covers and details', async () => {
    const { window } = run
    await expect(songRows(window).locator('.song-title')).toHaveText(['Cover Song', 'Plain Song'])
    await expect(window.locator('#song-count')).toHaveText('2')
    await expect(songRow(window, 'Cover Song').locator('.song-meta')).toContainText('Cover Band')
    await expect(songRow(window, 'Cover Song').locator('.thumb')).toHaveClass(/has-cover/)
    await expect(songRow(window, 'Plain Song').locator('.thumb')).not.toHaveClass(/has-cover/)
    await expect(songRow(window, 'Plain Song').locator('.thumb-letter')).toHaveText('P')
  })

  test('plays a song and shows its cover', async () => {
    const { window } = run
    await songRow(window, 'Cover Song').locator('.song-main').click()

    await expect(window.getByTestId('now-title')).toHaveText('Cover Song')
    await expect(window.locator('#now-artist')).toHaveText('Cover Band')
    await expect(window.getByTestId('cover')).toHaveClass(/has-cover/)
    await expect(window.locator('#backdrop')).toHaveClass(/has-cover/)
    expect(await window.getByTestId('cover').evaluate(element => element.style.backgroundImage)).toMatch(/^url\("blob:/)
    await expect(songRow(window, 'Cover Song')).toHaveClass(/playing/)
    await expect(window.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect.poll(() => window.locator('#audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0)

    await window.getByRole('button', { name: 'Pause' }).click()
    expect(await window.locator('#audio').evaluate(audio => audio.paused)).toBe(true)

    // The next song has no cover, so the player shows a placeholder.
    await window.getByRole('button', { name: 'Next' }).click()
    await expect(window.getByTestId('now-title')).toHaveText('Plain Song')
    await expect(window.getByTestId('cover')).not.toHaveClass(/has-cover/)
    await expect(window.locator('#backdrop')).not.toHaveClass(/has-cover/)
  })

  test('searches songs', async () => {
    const { window } = run
    await window.getByLabel('Search songs').fill('band')
    await expect(songRows(window).locator('.song-title')).toHaveText(['Cover Song'])
    await window.getByLabel('Search songs').fill('nothing like this')
    await expect(songRows(window)).toHaveCount(0)
    await expect(window.getByText('No songs match your search.')).toBeVisible()
  })

  test('renames a song, and refuses a name in use', async () => {
    const { window, audioFolder } = run
    await songRow(window, 'Plain Song').getByRole('button', { name: 'Rename', exact: true }).click()
    await window.getByLabel('New name').fill('Renamed: Song')
    await window.getByLabel('New name').press('Enter')
    await expect(songRow(window, 'Renamed Song')).toHaveCount(1)
    expect(fs.readdirSync(audioFolder).sort()).toEqual(['Cover Song.mp3', 'Renamed Song.mp3'])

    await songRow(window, 'Renamed Song').getByRole('button', { name: 'Rename', exact: true }).click()
    await window.getByLabel('New name').fill('Cover Song')
    await window.getByLabel('New name').press('Enter')
    await expect(window.getByTestId('toast')).toHaveText('Another song already has that name.')
    expect(fs.readdirSync(audioFolder).sort()).toEqual(['Cover Song.mp3', 'Renamed Song.mp3'])

    // Escape cancels.
    await songRow(window, 'Renamed Song').getByRole('button', { name: 'Rename', exact: true }).click()
    await window.getByLabel('New name').fill('Never saved')
    await window.getByLabel('New name').press('Escape')
    await expect(songRow(window, 'Renamed Song')).toHaveCount(1)
  })

  test('keeps playing a song that is renamed', async () => {
    const { window } = run
    await songRow(window, 'Cover Song').locator('.song-main').click()
    await expect.poll(() => window.locator('#audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.5)

    await songRow(window, 'Cover Song').getByRole('button', { name: 'Rename', exact: true }).click()
    await window.getByLabel('New name').fill('Moved Song')
    await window.getByLabel('New name').press('Enter')
    await expect(window.getByTestId('now-title')).toHaveText('Moved Song')
    await expect.poll(() => window.locator('#audio').evaluate(audio => decodeURIComponent(audio.src))).toMatch(/Moved Song\.mp3$/)
    await expect.poll(() => window.locator('#audio').evaluate(audio => !audio.paused && audio.currentTime > 0.5)).toBe(true)
  })

  test('deletes a song only after confirming', async () => {
    const { app, window, audioFolder } = run
    await app.evaluate(({ dialog, shell }) => {
      const fs = process.getBuiltinModule('node:fs')
      globalThis.answer = 1
      dialog.showMessageBox = async () => ({ response: globalThis.answer })
      shell.trashItem = async file => fs.rmSync(file)
    })

    await songRow(window, 'Plain Song').getByRole('button', { name: 'Delete', exact: true }).click()
    await window.waitForTimeout(300)
    expect(fs.readdirSync(audioFolder)).toContain('Plain Song.mp3')

    await app.evaluate(() => { globalThis.answer = 0 })
    await songRow(window, 'Plain Song').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(songRow(window, 'Plain Song')).toHaveCount(0)
    expect(fs.readdirSync(audioFolder)).toEqual(['Cover Song.mp3'])
  })

  test('shares a song: copy its YouTube link or show the file', async () => {
    const { app, window } = run
    await app.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = template => {
        globalThis.shareMenu = template
        return { popup () {} }
      }
    })

    await songRow(window, 'Cover Song').getByRole('button', { name: 'Share', exact: true }).click()
    await expect.poll(() => app.evaluate(() => globalThis.shareMenu?.map(item => item.label ?? item.type))).toContain('Copy YouTube link')
    const copied = await app.evaluate(({ clipboard }) => {
      globalThis.shareMenu.find(item => item.label === 'Copy YouTube link').click()
      return clipboard.readText()
    })
    expect(copied).toBe(LINK)

    // No link to copy for a song that didn't come with one.
    await songRow(window, 'Plain Song').getByRole('button', { name: 'Share', exact: true }).click()
    await expect.poll(() => app.evaluate(() => globalThis.shareMenu.map(item => item.label ?? item.type))).not.toContain('Copy YouTube link')
  })

  test('the page can only reach songs in the folder', async () => {
    const { app, window, audioFolder } = run
    const outside = path.join(path.dirname(audioFolder), 'outside.mp3')
    fs.copyFileSync(path.join(audioFolder, 'Cover Song.mp3'), outside)
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => {
        globalThis.asked = true
        return { response: 0 }
      }
    })

    const results = await window.evaluate(async () => ({
      cover: await window.yas.getCover('../outside.mp3'),
      rename: await window.yas.renameSong('../outside.mp3', 'x'),
      escape: await window.yas.renameSong('Cover Song.mp3', '../outside'),
      remove: await window.yas.deleteSong('../outside.mp3'),
      show: await window.yas.showSong('/etc/passwd')
    }))
    expect(results.cover).toBeNull()
    expect(results.rename.ok).toBe(false)
    expect(results.remove.ok).toBe(false)
    expect(results.show.ok).toBe(false)
    // Path separators in a new name are dropped, so it stays in the folder.
    expect(results.escape).toEqual({ ok: true, name: 'outside.mp3' })
    expect(fs.readdirSync(audioFolder).sort()).toEqual(['Plain Song.mp3', 'outside.mp3'])
    expect(fs.existsSync(outside)).toBe(true)
    expect(await app.evaluate(() => globalThis.asked === true)).toBe(false)
  })
})

test('warns when yt-dlp is not installed', async () => {
  run = await launchApp({ env: { YTDLP_PATH: path.join(process.cwd(), 'no-such-yt-dlp') } })
  await expect(run.window.getByTestId('warning')).toContainText('yt-dlp not found')
})
