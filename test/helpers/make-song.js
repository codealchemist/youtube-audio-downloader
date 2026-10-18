// Writes a short mp3 the way youtube-audio-server does: ID3v2.3 tags and,
// optionally, a JPEG cover. Uses the bundled ffmpeg, so no network.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const run = args => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

export function makeSong (folder, { title, artist = '', album = '', comment = '', cover = false, colors = 'e5383b f48c06', seconds = 2 } = {}) {
  const file = path.join(folder, `${title}.mp3`)
  const tags = { title, artist, album, comment }
  const args = ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`]
  const image = cover && path.join(os.tmpdir(), `cover-${randomUUID()}.jpg`)
  try {
    if (image) {
      const [c0, c1] = colors.split(' ')
      run(['-f', 'lavfi', '-i', `gradients=s=240x240:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=240:y1=240`, '-frames:v', '1', image])
      args.push('-i', image, '-map', '0:a', '-map', '1:v', '-codec:v', 'copy', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
    }
    for (const [name, value] of Object.entries(tags)) {
      if (value) args.push('-metadata', `${name}=${value}`)
    }
    run([...args, '-codec:a', 'libmp3lame', '-b:a', '64k', '-id3v2_version', '3', file])
  } finally {
    if (image) fs.rmSync(image, { force: true })
  }
  return file
}
