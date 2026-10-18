// Downloads a real video with the yt-dlp installed on this machine. Off by
// default because it needs the network and YouTube changes often:
// YAS_LIVE=1 npm run test:e2e
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { launchApp, videoInput } from './app.js'

test.skip(!process.env.YAS_LIVE, 'Set YAS_LIVE=1 to download from YouTube')

test('downloads a real video', async () => {
  // "Me at the zoo", 19 seconds.
  const run = await launchApp({ env: { YTDLP_PATH: '' } })
  try {
    const input = videoInput(run.window)
    await input.fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await input.press('Enter')
    await expect(run.window.getByTestId('queue').locator('.job')).toHaveAttribute('data-status', 'done', { timeout: 120 * 1000 })
    const [file] = fs.readdirSync(run.audioFolder)
    expect(file).toMatch(/\.mp3$/)
  } finally {
    await run.close()
  }
})
