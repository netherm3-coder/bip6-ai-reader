// Спільне для всіх форматів: чистка тексту й складання книги з блоків.
// Книга для годинника — простий текст: абзаци через \n, без порожніх рядків,
// абзац до MAX_PARA символів. Розділи — [зсув, назва], заголовки — зсуви.

export const MAX_CHARS = 4000000
export const MAX_PARA = 1500
const MAX_CHAPTERS = 1500
const MAX_HEADINGS = 4000

const MAP = {
  'ʼ': '’', // ʼ (рекомендований апостроф) → ’ — він є в більшості шрифтів
  '‐': '-',
  '‑': '-',
  '‒': '–',
  '―': '—',
  '−': '-',
  '‚': "'",
  '‛': "'",
  '‟': '"',
  '′': "'",
  '″': '"',
  '´': "'",
  '․': '.',
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st'
}
const MAP_RE = new RegExp('[' + Object.keys(MAP).join('') + ']', 'g')

// Один рядок тексту: без емодзі, керівних і невидимих символів, з одинарними пробілами.
export function cleanInline(s) {
  let t = String(s || '')
  try {
    t = t.normalize('NFC')
  } catch (e) {}
  return t
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[\u0300-\u036F\u00AD\u200B-\u200F\u2060-\u2064\uFEFF\uFE00-\uFE0F\u202A-\u202E]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\t\r\n\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(MAP_RE, (c) => MAP[c])
    .replace(/ {2,}/g, ' ')
    .trim()
}

// Довгий абзац ділиться на шматки до MAX_PARA — по кінцю речення, де можна.
export function splitLong(s, max) {
  const limit = max || MAX_PARA
  const out = []
  let rest = s
  while (rest.length > limit) {
    const head = rest.slice(0, limit)
    let cut = -1
    const re = /[.!?…][»"”)]?\s/g
    let m
    while ((m = re.exec(head))) {
      if (m.index + m[0].length >= limit * 0.45) cut = m.index + m[0].length
    }
    if (cut < 0) {
      const sp = head.lastIndexOf(' ')
      cut = sp > limit * 0.5 ? sp + 1 : limit
    }
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export class BookError extends Error {
  constructor(code, detail) {
    super(code)
    this.code = code
    this.detail = detail || ''
  }
}

// blocks: { k: 'p' | 'h', s, lvl?, ids?: [], chap?: 'назва розділу' }
// opts.headingChapters — розділи із заголовків до рівня opts.maxLevel (коли немає змісту).
export function assemble(blocks, opts) {
  const o = opts || {}
  const maxLevel = o.maxLevel || 2
  const parts = []
  const ch = []
  const h = []
  const anchors = {}
  let len = 0
  let pendingIds = []
  let pendingChap = null
  blocks.forEach((b) => {
    if (b.ids && b.ids.length) pendingIds = pendingIds.concat(b.ids)
    if (b.chap && !pendingChap) pendingChap = cleanInline(b.chap)
    const s = cleanInline(b.s)
    if (!s) return
    const start = len + (parts.length ? 1 : 0)
    pendingIds.forEach((id) => {
      if (anchors[id] === undefined) anchors[id] = start
    })
    pendingIds = []
    const heading = b.k === 'h'
    if (heading && h.length < MAX_HEADINGS) h.push(start)
    let title = pendingChap
    if (!title && heading && o.headingChapters && (b.lvl || 1) <= maxLevel) title = s
    if (title && ch.length < MAX_CHAPTERS && (!ch.length || ch[ch.length - 1][0] !== start)) ch.push([start, title.slice(0, 80)])
    pendingChap = null
    const pieces = heading ? [s.slice(0, 300)] : splitLong(s)
    pieces.forEach((piece) => {
      len += (parts.length ? 1 : 0) + piece.length
      parts.push(piece)
    })
    if (len > MAX_CHARS) throw new BookError('too_big')
  })
  return { text: parts.join('\n'), ch, h, anchors }
}

// Розділи зі змісту (EPUB): [{ title, key }] → [зсув, назва] за мітками в тексті.
export function chaptersFromToc(entries, anchors) {
  const out = []
  const seen = {}
  entries.forEach((e) => {
    const o = anchors[e.key] !== undefined ? anchors[e.key] : anchors[e.key.split('#')[0]]
    const title = cleanInline(e.title)
    if (o === undefined || !title || seen[o]) return
    seen[o] = 1
    out.push([o, title.slice(0, 80)])
  })
  out.sort((a, b) => a[0] - b[0])
  return out.slice(0, MAX_CHAPTERS)
}

export function nameFromFile(name) {
  const base = String(name || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(fb2\.zip|fb2|epub|txt|docx|pdf|zip)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
  return cleanInline(base) || 'Без назви'
}

// Байти → рядок: BOM, UTF-8, інакше Windows-1251 (кирилиця).
export function decodeText(bytes, declared) {
  const b = bytes
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3))
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  if (declared) {
    try {
      return new TextDecoder(declared).decode(b)
    } catch (e) {}
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch (e) {}
  try {
    return new TextDecoder('windows-1251').decode(b)
  } catch (e) {
    return new TextDecoder('utf-8').decode(b)
  }
}

// Абзаци, розбиті переносами рядків (TXT, PDF): «сло-\nво» → «слово».
export function joinLines(lines) {
  let out = ''
  lines.forEach((line) => {
    const l = line.trim()
    if (!l) return
    if (!out) out = l
    else if (/[A-Za-zА-Яа-яЁёЇїІіЄєҐґ]-$/.test(out) && /^[a-zа-яёїієґ]/.test(l)) out = out.slice(0, -1) + l
    else out += ' ' + l
  })
  return out
}
