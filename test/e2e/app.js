// Starts the app the way `npm start` does, with throwaway settings and
// download folders, and the fake yt-dlp unless `env` says otherwise.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const FAKE_YTDLP = path.join(root, 'test/e2e/fixtures/fake-yt-dlp')
// Node refuses to run .cmd files without a shell, and youtube-audio-server
// never uses one, so the fake can't stand in for yt-dlp on Windows.
export const canFakeYtdlp = process.platform !== 'win32'

export const videoInput = window => window.getByPlaceholder('Paste YouTube link or video id here')

export async function launchApp ({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yasapp-e2e-'))
  const audioFolder = path.join(dir, 'audio')
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      YAS_USER_DATA: path.join(dir, 'user-data'),
      YAS_AUDIO_FOLDER: audioFolder,
      YTDLP_PATH: FAKE_YTDLP,
      ...env
    }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return {
    app,
    window,
    audioFolder,
    async close () {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}
