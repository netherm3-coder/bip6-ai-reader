// Розкладка книги на сторінки. Рядки розбиваємо самі (ширина кожного символу
// міряється шрифтом годинника), тож сторінка рівно влазить в екран, а кожен рядок
// показується окремим текстом без переносу — нічого не обрізається.

import * as hmUI from '@zos/ui'

// Символ, якого немає в жодному шрифті: так виглядає «нема гліфа».
const MISSING = '\u0378'
// Типографські знаки, яких може не бути в шрифті, → прості.
const FALLBACK = {
  '«': '"',
  '»': '"',
  '„': '"',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '—': '-',
  '–': '-',
  '…': '...',
  '№': 'N',
  '•': '-',
  '·': '.'
}
const SAMPLE = 'Читаю книгу на годиннику, 12345.'

function rawWidth(text, size) {
  try {
    const r = hmUI.getTextLayout(text, { text_size: size, text_width: 3000, wrapped: 0 })
    return r && r.width > 0 ? r.width : 0
  } catch (e) {
    return 0
  }
}

// Ширина символів одного кегля з кешем. show() — текст, як його показати
// (знаки, яких немає в шрифті, замінено).
// saved — збережене раніше { k, w, s }; годиться, лише якщо зразок має ту саму ширину
// (інакше шрифт інший).
export function createMeasure(size, saved) {
  const base = rawWidth('nn', size)
  const sampleW = base > 0 ? rawWidth(SAMPLE, size) : 0
  const reuse = !!(saved && saved.w && sampleW > 0 && saved.k === sampleW)
  const widths = reuse ? saved.w : {}
  const shown = reuse && saved.s ? saved.s : {}
  let dirty = false
  let missW = null
  const fallbackW = size * 0.56

  function measure(str) {
    if (!(base > 0)) return fallbackW * str.length
    const w = rawWidth('n' + str + 'n', size) - base
    return w > 0 ? w : fallbackW * str.length
  }

  function cw(ch) {
    let w = widths[ch]
    if (w !== undefined) return w
    let s = ch
    if (FALLBACK[ch] !== undefined && base > 0) {
      if (missW === null) missW = rawWidth('n' + MISSING + 'n', size) - base
      const real = rawWidth('n' + ch + 'n', size) - base
      if (!(real > 0) || (missW > 0 && Math.abs(real - missW) < 0.5)) s = FALLBACK[ch]
    }
    if (s !== ch) shown[ch] = s
    w = ch === ' ' && base > 0 ? Math.max(1, rawWidth('n n', size) - base) : measure(s)
    widths[ch] = w
    dirty = true
    return w
  }

  // Поправка на кернінг: реальна ширина зразка / сума ширин символів.
  let factor = 1
  if (base > 0) {
    let sum = 0
    for (let i = 0; i < SAMPLE.length; i++) sum += cw(SAMPLE[i])
    if (sum > 0 && sampleW > 0) factor = Math.max(0.85, Math.min(1.2, sampleW / sum))
  }

  return {
    size,
    factor: factor * 1.02,
    cw,
    dirty: () => dirty,
    dump: () => {
      dirty = false
      return { k: sampleW, w: widths, s: shown }
    },
    show(str) {
      let out = ''
      for (let i = 0; i < str.length; i++) {
        const ch = str[i]
        if (widths[ch] === undefined) cw(ch)
        out += shown[ch] !== undefined ? shown[ch] : ch
      }
      return out
    }
  }
}

// Абзац (без \n) → рядки [початок, кінець) відносно абзацу. Ламаємо по пробілах
// і після дефіса; тире лишається в кінці попереднього рядка; задовге слово ріжемо.
export function breakLines(text, width, indent, m) {
  const lines = []
  const n = text.length
  const f = m.factor
  let s = 0
  let first = true
  while (s < n) {
    const avail = width - (first ? indent : 0)
    let w = 0
    let cutEnd = -1
    let cutNext = -1
    let i = s
    for (; i < n; i++) {
      const ch = text[i]
      if (ch === ' ' && i > s) {
        const nx = text[i + 1]
        if (nx !== '—' && nx !== '–') {
          cutEnd = i
          cutNext = i + 1
        }
      }
      const cwi = m.cw(ch) * f
      if (w + cwi > avail && i > s) break
      w += cwi
      if (ch === '-' && i > s && i + 1 < n && text[i + 1] !== ' ' && text[i - 1] !== ' ') {
        cutEnd = i + 1
        cutNext = i + 1
      }
    }
    if (i >= n) {
      lines.push([s, n])
      break
    }
    let e
    let next
    if (text[i] === ' ' && text[i + 1] !== '—' && text[i + 1] !== '–') {
      e = i
      next = i + 1
    } else if (cutEnd > s) {
      e = cutEnd
      next = cutNext
    } else {
      e = i
      next = i
    }
    while (e > s && text[e - 1] === ' ') e--
    lines.push([s, e])
    s = next
    while (s < n && text[s] === ' ') s++
    first = false
  }
  if (!lines.length) lines.push([0, 0])
  return lines
}

// Текст книги частинами з файлів: зріз, пошук меж абзаців.
// book — { chars, p, have }, read(i) → рядок частини або null.
export function createSource(book, read) {
  const P = book.p
  const cache = []
  function part(i) {
    for (let k = 0; k < cache.length; k++) if (cache[k].i === i) return cache[k].t
    const t = read(i)
    if (typeof t !== 'string') return null
    cache.unshift({ i, t })
    if (cache.length > 4) cache.pop()
    return t
  }
  const src = {
    total: book.chars,
    len() {
      return Math.min(book.chars, book.have * P)
    },
    slice(a, b) {
      const end = Math.min(b, src.len())
      let out = ''
      let pos = Math.max(0, a)
      while (pos < end) {
        const pi = Math.floor(pos / P)
        const t = part(pi)
        if (t === null) break
        const local = pos - pi * P
        const take = Math.min(end - pos, t.length - local)
        if (take <= 0) break
        out += t.substr(local, take)
        pos += take
      }
      return out
    },
    // Індекс останнього \n перед i (або -1).
    lastNl(i) {
      let pos = Math.min(i, src.len()) - 1
      let scanned = 0
      while (pos >= 0 && scanned < 6000) {
        const pi = Math.floor(pos / P)
        const t = part(pi)
        if (t === null) return -1
        const local = pos - pi * P
        const k = t.lastIndexOf('\n', local)
        if (k >= 0) return pi * P + k
        scanned += local + 1
        pos = pi * P - 1
      }
      return pos < 0 ? -1 : pos
    },
    // Індекс першого \n від i (або кінець скачаного тексту).
    nextNl(i) {
      const len = src.len()
      let pos = i
      let scanned = 0
      while (pos < len && scanned < 6000) {
        const pi = Math.floor(pos / P)
        const t = part(pi)
        if (t === null) return len
        const local = pos - pi * P
        const k = t.indexOf('\n', local)
        if (k >= 0 && pi * P + k < len) return pi * P + k
        scanned += t.length - local
        pos = (pi + 1) * P
      }
      return Math.min(pos, len)
    }
  }
  return src
}

// Сторінки: рядки абзаців підряд; новий розділ починається з нової сторінки.
// geo — { width, indent, rows }; marks — { ch: [зсуви розділів], h: [зсуви заголовків] }.
export function createPager(src, m, geo, marks) {
  const chapters = (marks.ch || []).slice().sort((a, b) => a - b)
  const headings = {}
  ;(marks.h || []).forEach((o) => (headings[o] = 1))
  const paraCache = []

  function isChapter(o) {
    let lo = 0
    let hi = chapters.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (chapters[mid] === o) return true
      if (chapters[mid] < o) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }

  function para(ps) {
    for (let k = 0; k < paraCache.length; k++) if (paraCache[k].ps === ps) return paraCache[k]
    const pe = src.nextNl(ps)
    const text = src.slice(ps, pe)
    const heading = !!headings[ps]
    const lines = breakLines(text, geo.width, heading ? 0 : geo.indent, m).map((l) => [ps + l[0], ps + l[1]])
    const p = { ps, pe, lines, heading, complete: pe < src.len() || pe >= src.total }
    // Абзац, обрізаний на межі скачаного, не кешуємо: допишеться, коли докачається.
    if (p.complete) {
      paraCache.unshift(p)
      if (paraCache.length > 40) paraCache.pop()
    }
    return p
  }

  function lineIndex(p, o) {
    let li = 0
    for (let k = 0; k < p.lines.length; k++) if (p.lines[k][0] <= o) li = k
    return li
  }

  function pageAt(start) {
    const len = src.len()
    let o = Math.max(0, Math.min(start, Math.max(0, len - 1)))
    let ps = src.lastNl(o) + 1
    let p = para(ps)
    let li = lineIndex(p, o)
    const page = { start: p.lines[li][0], end: 0, lines: [], atEnd: false }
    for (;;) {
      for (; li < p.lines.length && page.lines.length < geo.rows; li++) {
        page.lines.push({ s: p.lines[li][0], e: p.lines[li][1], first: li === 0, heading: p.heading })
      }
      if (li < p.lines.length) {
        page.end = p.lines[li][0]
        break
      }
      const nextPs = p.pe + 1
      if (nextPs >= len || p.pe >= len) {
        page.end = Math.min(len, p.pe >= len ? len : nextPs)
        page.atEnd = true
        break
      }
      // Новий розділ — з нової сторінки (окрім сторінки, де самі заголовки: титул + розділ 1).
      if (page.lines.length >= geo.rows || (isChapter(nextPs) && !page.lines.every((l) => l.heading))) {
        page.end = nextPs
        break
      }
      ps = nextPs
      p = para(ps)
      li = 0
    }
    if (page.end >= len) page.atEnd = true
    return page
  }

  function pageBefore(start) {
    if (start <= 0) return 0
    let collected = []
    let cursor = start
    while (collected.length < geo.rows && cursor > 0) {
      const ps = src.lastNl(cursor - 1) + 1
      const p = para(ps)
      const starts = []
      p.lines.forEach((l) => {
        if (l[0] < cursor) starts.push(l[0])
      })
      collected = starts.concat(collected)
      if (isChapter(ps) || ps <= 0) break
      cursor = ps
    }
    if (!collected.length) return 0
    return collected.length > geo.rows ? collected[collected.length - geo.rows] : collected[0]
  }

  return { pageAt, pageBefore, isChapter }
}

// Назва розділу для зсуву (останній розділ, що почався до нього).
export function chapterAt(ch, o) {
  let lo = 0
  let hi = ch.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ch[mid][0] <= o) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}
