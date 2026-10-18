import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_TAG_BYTES, parseTag, readTag, tagSize } from '../../src/main/id3.js'
import { makeSong } from '../helpers/make-song.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6])

const syncsafe = size => Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])

function frame (id, data, { version = 3, flags = 0 } = {}) {
  const header = Buffer.alloc(10)
  header.write(id, 0, 'latin1')
  if (version === 4) syncsafe(data.length).copy(header, 4)
  else header.writeUInt32BE(data.length, 4)
  header[9] = flags
  return Buffer.concat([header, data])
}

function tag (frames, { version = 3, flags = 0, padding = 16, extended } = {}) {
  const body = Buffer.concat([...(extended ? [extended] : []), ...frames, Buffer.alloc(padding)])
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, flags]), syncsafe(body.length), body])
}

const text = (value, encoding = 3) => {
  const encoded = {
    0: () => Buffer.from(value, 'latin1'),
    1: () => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]),
    2: () => Buffer.from(value, 'utf16le').swap16(),
    3: () => Buffer.from(value, 'utf8')
  }[encoding]()
  return Buffer.concat([Buffer.from([encoding]), encoded])
}

const picture = (mime, type, image, description = '') =>
  Buffer.concat([Buffer.from([0]), Buffer.from(`${mime}\0`, 'latin1'), Buffer.from([type]), Buffer.from(`${description}\0`, 'latin1'), image])

describe('tagSize', () => {
  it('reads the size of ID3v2.3 and 2.4 tags', () => {
    expect(tagSize(tag([], { padding: 100 }))).toBe(110)
    expect(tagSize(tag([], { version: 4, padding: 300 }))).toBe(310)
  })

  it('is 0 for anything else', () => {
    expect(tagSize(Buffer.from('not an mp3 at all'))).toBe(0)
    expect(tagSize(Buffer.from('ID3'))).toBe(0)
    expect(tagSize(tag([], { version: 2 }))).toBe(0)
  })
})

describe('parseTag', () => {
  it('reads text frames in every encoding', () => {
    for (const encoding of [0, 1, 2, 3]) {
      const parsed = parseTag(tag([frame('TIT2', text('Café song', encoding)), frame('TPE1', text('Band', encoding))]))
      expect(parsed).toMatchObject({ title: 'Café song', artist: 'Band' })
    }
  })

  it('reads UTF-16 big-endian with a byte order mark', () => {
    const bigEndian = Buffer.concat([Buffer.from([1, 0xfe, 0xff]), Buffer.from('Ünïcode ♫', 'utf16le').swap16()])
    expect(parseTag(tag([frame('TIT2', bigEndian)])).title).toBe('Ünïcode ♫')
  })

  it('joins ID3v2.4 multiple values', () => {
    const parsed = parseTag(tag([frame('TPE1', text('One\0Two\0'), { version: 4 }), frame('TALB', text('Album'), { version: 4 })], { version: 4 }))
    expect(parsed).toMatchObject({ artist: 'One, Two', album: 'Album' })
  })

  it('reads the comment from COMM, or from the TXXX frame ffmpeg writes', () => {
    const comm = Buffer.concat([Buffer.from([3]), Buffer.from('eng'), Buffer.from('\0https://youtu.be/x', 'utf8')])
    expect(parseTag(tag([frame('COMM', comm)])).comment).toBe('https://youtu.be/x')

    const described = Buffer.concat([Buffer.from([3]), Buffer.from('eng'), Buffer.from('iTunNORM\0 000', 'utf8')])
    expect(parseTag(tag([frame('COMM', described)])).comment).toBe('')

    const txxx = text('comment\0https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(parseTag(tag([frame('TXXX', txxx)])).comment).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(parseTag(tag([frame('TXXX', text('other\0value'))])).comment).toBe('')
  })

  it('returns the front cover, or else the first picture', () => {
    const parsed = parseTag(tag([frame('APIC', picture('image/png', 0, PNG)), frame('APIC', picture('image/jpeg', 3, JPEG, 'Cover'))]))
    expect(parsed.cover).toEqual({ mime: 'image/jpeg', data: JPEG })
    expect(parseTag(tag([frame('APIC', picture('image/jpg', 0, JPEG))])).cover).toEqual({ mime: 'image/jpeg', data: JPEG })
  })

  it('only says whether there is a cover when asked not to copy it', () => {
    expect(parseTag(tag([frame('APIC', picture('image/png', 3, PNG))]), { cover: false }).cover).toBe(true)
    expect(parseTag(tag([]), { cover: false }).cover).toBeNull()
  })

  it('ignores pictures that are not JPEG or PNG', () => {
    expect(parseTag(tag([frame('APIC', picture('image/svg+xml', 3, Buffer.from('<svg/>')))])).cover).toBeNull()
    expect(parseTag(tag([frame('APIC', picture('-->', 3, JPEG))])).cover).toBeNull()
  })

  it('undoes unsynchronisation', () => {
    const image = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xe0])
    const unsync = buffer => Buffer.from([...buffer].flatMap((byte, i) => byte === 0xff && (buffer[i + 1] === 0 || buffer[i + 1] >= 0xe0) ? [byte, 0] : [byte]))

    // ID3v2.3 unsynchronises the whole tag; frame sizes are before that.
    const v3 = tag([unsync(frame('APIC', picture('image/jpeg', 3, image)))], { flags: 0x80 })
    expect(parseTag(v3).cover.data).toEqual(image)

    // ID3v2.4 does it per frame, and the size is after.
    const v4 = tag([frame('APIC', unsync(picture('image/jpeg', 3, image)), { version: 4, flags: 0x02 })], { version: 4 })
    expect(parseTag(v4).cover.data).toEqual(image)
  })

  it('skips extended headers and data length indicators', () => {
    const v3 = tag([frame('TIT2', text('Three'))], { flags: 0x40, extended: Buffer.from([0, 0, 0, 6, 0, 0, 0, 0, 0, 0]) })
    expect(parseTag(v3).title).toBe('Three')

    const withLength = Buffer.concat([syncsafe(5), text('Four')])
    const v4 = tag([frame('TIT2', withLength, { version: 4, flags: 0x01 })], { version: 4, flags: 0x40, extended: Buffer.concat([syncsafe(6), Buffer.from([1, 0])]) })
    expect(parseTag(v4).title).toBe('Four')
  })

  it('skips compressed frames', () => {
    expect(parseTag(tag([frame('TIT2', text('Zipped'), { flags: 0x80 })])).title).toBe('')
  })

  it('survives truncated and malformed tags', () => {
    const full = tag([frame('TIT2', text('Song')), frame('APIC', picture('image/jpeg', 3, JPEG))])
    for (let length = 0; length < full.length; length += 3) {
      expect(() => parseTag(full.subarray(0, length))).not.toThrow()
    }
    const lying = tag([frame('TIT2', text('Song'))])
    lying.writeUInt32BE(0x7fffffff, 14) // frame claims to be huge
    expect(parseTag(lying).title).toBe('')
    expect(parseTag(tag([frame('APIC', Buffer.from([0, 0x69]))])).cover).toBeNull()
  })

  it('returns empty fields without a tag', () => {
    expect(parseTag(Buffer.from('plain audio'))).toEqual({ title: '', artist: '', album: '', comment: '', cover: null })
  })
})

describe('readTag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yas-id3-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads what ffmpeg writes for youtube-audio-server', async () => {
    const file = makeSong(dir, { title: 'Real Song', artist: 'Real Band', album: 'LP', comment: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', cover: true })
    const tags = await readTag(file)
    expect(tags).toMatchObject({ title: 'Real Song', artist: 'Real Band', album: 'LP', comment: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(tags.cover.mime).toBe('image/jpeg')
    expect(tags.cover.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it('reads files without a tag or cover', async () => {
    const file = path.join(dir, 'raw.mp3')
    fs.writeFileSync(file, Buffer.alloc(64))
    expect(await readTag(file)).toMatchObject({ title: '', cover: null })
    expect((await readTag(makeSong(dir, { title: 'Bare' }))).cover).toBeNull()
  })

  it('reads at most MAX_TAG_BYTES of a huge tag', async () => {
    const file = path.join(dir, 'huge.mp3')
    const header = tag([frame('TIT2', text('Big'))], { padding: 0 })
    syncsafe(MAX_TAG_BYTES * 4).copy(header, 6)
    fs.writeFileSync(file, header)
    expect((await readTag(file)).title).toBe('Big')
  })
})
