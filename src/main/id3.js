// Reads the ID3v2 tag at the start of an mp3: title, artist, album, comment
// (youtube-audio-server stores the video URL there) and the cover picture.
// Supports ID3v2.3 and 2.4, which is what ffmpeg and most taggers write.
// Only what the library shows is parsed; anything malformed is skipped.
import { open } from 'node:fs/promises'

const HEADER_SIZE = 10
// Covers are a few hundred KB at most; a larger tag is read up to here.
export const MAX_TAG_BYTES = 16 * 1024 * 1024
const COVER_TYPES = new Set(['image/jpeg', 'image/png'])

const TEXT_FRAMES = { TIT2: 'title', TPE1: 'artist', TALB: 'album' }

function syncsafe (buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21) | ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) | (buffer[offset + 3] & 0x7f)
}

// Undoes "unsynchronisation": every 0xFF 0x00 pair was written for 0xFF.
function resync (buffer) {
  const out = Buffer.alloc(buffer.length)
  let length = 0
  for (let i = 0; i < buffer.length; i++) {
    out[length++] = buffer[i]
    if (buffer[i] === 0xff && buffer[i + 1] === 0x00) i++
  }
  return out.subarray(0, length)
}

// Size of the whole tag (header included), or 0 when `header` isn't ID3v2.3/2.4.
export function tagSize (header) {
  if (header.length < HEADER_SIZE || header.toString('latin1', 0, 3) !== 'ID3') return 0
  const version = header[3]
  if (version !== 3 && version !== 4) return 0
  return HEADER_SIZE + syncsafe(header, 6) + (header[5] & 0x10 ? 10 : 0)
}

function decodeText (bytes, encoding) {
  switch (encoding) {
    case 0: return bytes.toString('latin1')
    case 3: return bytes.toString('utf8')
    case 1: {
      // UTF-16 with a byte order mark; big-endian when it's FE FF.
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16be(bytes.subarray(2))
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
      return bytes.toString('utf16le')
    }
    case 2: return decodeUtf16be(bytes)
    default: return ''
  }
}

function decodeUtf16be (bytes) {
  const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)))
  return swapped.swap16().toString('utf16le')
}

// Offset of the string terminator from `start`: one zero byte, or two
// aligned zero bytes for UTF-16. -1 when there is none.
function terminator (bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i
    }
    return -1
  }
  return bytes.indexOf(0, start)
}

const terminatorLength = encoding => (encoding === 1 || encoding === 2 ? 2 : 1)

// ID3v2.4 separates multiple values with zeros.
function joinValues (text) {
  return text.split('\0').map(value => value.trim()).filter(Boolean).join(', ')
}

function textFrame (data) {
  return joinValues(decodeText(data.subarray(1), data[0]))
}

// A description, then the value. Comments (COMM) put a language (3 bytes)
// first; user-defined text (TXXX) doesn't.
function describedFrame (data, start) {
  const encoding = data[0]
  const end = terminator(data, start, encoding)
  if (end === -1) return null
  return {
    description: decodeText(data.subarray(start, end), encoding),
    text: joinValues(decodeText(data.subarray(end + terminatorLength(encoding)), encoding))
  }
}

// MIME type, picture type (3 is the front cover), a description, then the image.
function pictureFrame (data) {
  const encoding = data[0]
  const mimeEnd = data.indexOf(0, 1)
  if (mimeEnd === -1) return null
  let mime = data.toString('latin1', 1, mimeEnd).toLowerCase()
  if (mime === 'image/jpg') mime = 'image/jpeg'
  const type = data[mimeEnd + 1]
  const descriptionEnd = terminator(data, mimeEnd + 2, encoding)
  if (descriptionEnd === -1) return null
  const image = data.subarray(descriptionEnd + terminatorLength(encoding))
  if (!COVER_TYPES.has(mime) || !image.length) return null
  return { mime, type, data: image }
}

// Parses a buffer that starts with an ID3 tag. Returns { title, artist,
// album, comment, cover: { mime, data } | null }; fields that aren't there
// are empty strings. With `cover: false`, `cover` is only true or null.
export function parseTag (buffer, { cover: wantCover = true } = {}) {
  const tags = { title: '', artist: '', album: '', comment: '', cover: null }
  const size = tagSize(buffer)
  if (!size) return tags

  const version = buffer[3]
  const flags = buffer[5]
  let body = buffer.subarray(HEADER_SIZE, Math.min(size, buffer.length))
  if (version === 3 && flags & 0x80) body = resync(body)

  let offset = 0
  if (flags & 0x40) {
    // Extended header: v2.3 gives its size without these 4 bytes, v2.4 with them.
    if (body.length < 4) return tags
    offset = version === 4 ? syncsafe(body, 0) : body.readUInt32BE(0) + 4
  }

  let picture = null
  while (offset + HEADER_SIZE <= body.length) {
    const id = body.toString('latin1', offset, offset + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break // padding
    const frameSize = version === 4 ? syncsafe(body, offset + 4) : body.readUInt32BE(offset + 4)
    const frameFlags = body[offset + 9]
    const start = offset + HEADER_SIZE
    offset = start + frameSize
    if (frameSize === 0 || offset > body.length) continue

    // Compressed or encrypted frames aren't supported.
    const compressed = version === 4 ? frameFlags & 0x0c : frameFlags & 0xc0
    if (compressed) continue
    let data = body.subarray(start, offset)
    if (version === 4) {
      if (frameFlags & 0x01) data = data.subarray(4) // data length indicator
      if (frameFlags & 0x02) data = resync(data)
    }

    if (TEXT_FRAMES[id]) {
      if (!tags[TEXT_FRAMES[id]]) tags[TEXT_FRAMES[id]] = textFrame(data)
    } else if (id === 'COMM' || id === 'TXXX') {
      // ffmpeg writes the comment as TXXX "comment".
      const frame = describedFrame(data, id === 'COMM' ? 4 : 1)
      const isComment = id === 'COMM' ? !frame?.description : frame?.description.toLowerCase() === 'comment'
      if (isComment && !tags.comment) tags.comment = frame.text
    } else if (id === 'APIC') {
      const found = pictureFrame(data)
      if (found && (!picture || (found.type === 3 && picture.type !== 3))) picture = found
    }
  }

  if (picture) tags.cover = wantCover ? { mime: picture.mime, data: Buffer.from(picture.data) } : true
  return tags
}

// Reads only the tag from `file`, not the audio after it.
export async function readTag (file, options) {
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(HEADER_SIZE)
    const { bytesRead } = await handle.read(header, 0, HEADER_SIZE, 0)
    const size = tagSize(header.subarray(0, bytesRead))
    if (!size) return parseTag(Buffer.alloc(0), options)

    const buffer = Buffer.alloc(Math.min(size, MAX_TAG_BYTES))
    const { bytesRead: read } = await handle.read(buffer, 0, buffer.length, 0)
    return parseTag(buffer.subarray(0, read), options)
  } finally {
    await handle.close()
  }
}
