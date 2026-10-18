// Stands in for yt-dlp in end-to-end tests, so they don't depend on YouTube.
// Answers metadata requests with fixed JSON and "downloads" a short tone as
// WAV, which the real (bundled) ffmpeg then converts to mp3.
const fs = require('node:fs')

const UNAVAILABLE = 'e2eMissing0'
const args = process.argv.slice(2)

function videoId () {
  const infoIndex = args.indexOf('--load-info-json')
  if (infoIndex !== -1) return JSON.parse(fs.readFileSync(args[infoIndex + 1], 'utf8')).id
  const url = args[args.indexOf('--') + 1] || ''
  return new URL(url).searchParams.get('v')
}

function tone (seconds = 1, rate = 8000) {
  const samples = seconds * rate
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const id = videoId()
if (id === UNAVAILABLE) {
  process.stderr.write('ERROR: [youtube] e2eMissing0: Video unavailable\n')
  process.exit(1)
}

if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({
    id,
    title: 'E2E Test Song <b>not bold</b>',
    description: 'A tone',
    artist: 'Test Artist',
    webpage_url: `https://www.youtube.com/watch?v=${id}`
  }))
} else {
  const audio = tone()
  process.stderr.write(`[yas-progress] ${audio.length / 2} ${audio.length} NA 1000 1\n`)
  process.stderr.write(`[yas-progress] ${audio.length} ${audio.length} NA 1000 0\n`)
  process.stdout.write(audio)
}
