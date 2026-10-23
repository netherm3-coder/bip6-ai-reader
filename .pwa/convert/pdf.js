// PDF із текстом → абзаци. Рядки збираються з фрагментів pdf.js, колонтитули й
// номери сторінок прибираються, абзаци відновлюються за відступами й проміжками.
// Скани (картинки без тексту) не підходять — для них потрібне розпізнавання.

import { assemble, cleanInline, joinLines, BookError } from './text.js'

// pdf.js 4.10 (Apache-2.0), збірка legacy; розширення .js — щоб GitHub Pages
// віддавав файли як JavaScript (модулі з іншим типом браузер не завантажить).
async function loadPdfjs() {
  const base = new URL('../vendor/', import.meta.url)
  const pdfjs = await import(new URL('pdf.min.js', base).href)
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', base).href
  return pdfjs
}

function median(values) {
  if (!values.length) return 0
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function percentile(values, p) {
  if (!values.length) return 0
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

// Фрагменти тексту сторінки → рядки { text, x, y, size, right } згори донизу.
// Фрагменти одного рядка можуть іти в потоці не по порядку (напр., розділові
// знаки іншим шрифтом наприкінці), тож групуємо за висотою й сортуємо за x.
export function linesFromItems(items) {
  const rows = []
  items.forEach((it) => {
    if (typeof it.str !== 'string' || !it.str.length) return
    const t = it.transform || [1, 0, 0, 1, 0, 0]
    const size = Math.abs(it.height) || Math.hypot(t[2], t[3]) || 10
    const frag = { str: it.str, x: t[4], y: t[5], w: it.width || 0, size }
    let row = null
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 60; i--) {
      const r = rows[i]
      if (Math.abs(r.y - frag.y) <= Math.max(r.size, size) * 0.4) {
        row = r
        break
      }
    }
    if (!row) {
      row = { y: frag.y, size, frags: [] }
      rows.push(row)
    }
    row.frags.push(frag)
    row.size = Math.max(row.size, size)
  })
  rows.sort((a, b) => b.y - a.y)
  const lines = []
  rows.forEach((r) => {
    r.frags.sort((a, b) => a.x - b.x)
    // Знак, що лежить усередині ширшого фрагмента (шрифт без цього знака малює його
    // окремо), вставляємо в той фрагмент приблизно за пропорцією ширини.
    const base = []
    r.frags.forEach((f) => {
      const host = f.str.trim() && f.str.length <= 3 ? base.find((b) => b.str.length > 3 && f.x > b.x + 0.5 && f.x < b.x + b.w - 0.5) : null
      if (!host) {
        base.push(Object.assign({}, f))
        return
      }
      let i = Math.round(((f.x - host.x) / host.w) * host.str.length)
      i = Math.max(0, Math.min(host.str.length, i))
      const glyph = f.str.trim()
      const opening = /^[«„“(\[]/.test(glyph)
      // До найближчої межі слова: закривальні знаки — до попереднього слова.
      for (let d = 0; d <= 2; d++) {
        if (host.str[i - 1 - d] === ' ') {
          i = i - 1 - d
          break
        }
        if (host.str[i + d] === ' ') {
          i = i + d
          break
        }
      }
      if (host.str[i] === ' ' && !opening) host.str = host.str.slice(0, i) + glyph + host.str.slice(i)
      else if (host.str[i] === ' ' && opening) host.str = host.str.slice(0, i + 1) + glyph + host.str.slice(i + 1)
      else host.str = host.str.slice(0, i) + glyph + host.str.slice(i)
    })
    let text = ''
    let right = -Infinity
    base.forEach((f) => {
      if (text && f.x - right > r.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(f.str)) text += ' '
      text += f.str
      right = Math.max(right, f.x + f.w)
    })
    if (text.trim()) lines.push({ text: text.replace(/ {2,}/g, ' '), x: base[0].x, y: r.y, size: r.size, right })
  })
  return lines
}

const PAGE_NUM_RE = /^[-–—\s]*(стор\.?|с\.|page|p\.)?\s*\d{1,4}\s*(з|із|of|\/)?\s*\d{0,4}[-–—\s]*$/i

function norm(t) {
  return t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Основний кегль, лівий і правий край тексту, крок рядків.
export function pageStats(pages) {
  const all = []
  pages.forEach((lines) => lines.forEach((l) => all.push(l)))
  const sizes = []
  all.forEach((l) => {
    for (let i = 0; i < Math.min(40, l.text.length); i += 10) sizes.push(Math.round(l.size * 10) / 10)
  })
  const body = median(sizes) || 10
  const bodyLines = all.filter((l) => Math.abs(l.size - body) < body * 0.15)
  const gaps = []
  pages.forEach((lines) => {
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y
      if (g > 0 && Math.abs(lines[i].size - body) < body * 0.15 && Math.abs(lines[i - 1].size - body) < body * 0.15) gaps.push(g)
    }
  })
  return {
    body,
    left: median(bodyLines.map((l) => Math.round(l.x))),
    right: percentile(bodyLines.map((l) => l.right), 0.9),
    lineGap: median(gaps) || body * 1.2
  }
}

// Колонтитули й номери сторінок: крайні рядки сторінки, дрібніші за текст або
// відсунуті від нього, що повторюються на багатьох сторінках.
export function stripRunning(pages, stats) {
  const st = stats || pageStats(pages)
  const count = {}
  pages.forEach((lines) => {
    const seen = {}
    lines.slice(0, 2).concat(lines.slice(-2)).forEach((l) => {
      const k = norm(l.text)
      if (k && !seen[k]) {
        seen[k] = 1
        count[k] = (count[k] || 0) + 1
      }
    })
  })
  const n = pages.length
  const running = (l, gap) => {
    const small = l.size < st.body * 0.92
    const separated = gap === null || gap > st.lineGap * 1.4
    const c = count[norm(l.text)] || 0
    if (PAGE_NUM_RE.test(l.text.trim()) && (small || separated)) return true
    if (n >= 4 && c >= Math.max(3, n * 0.4) && small) return true
    return n >= 4 && c >= Math.max(3, n * 0.6) && separated
  }
  return pages.map((lines) => {
    let a = 0
    let b = lines.length
    for (let k = 0; k < 2 && a < b; k++) {
      const gap = a + 1 < b ? lines[a].y - lines[a + 1].y : null
      if (running(lines[a], gap)) a++
      else break
    }
    for (let k = 0; k < 2 && a < b; k++) {
      const gap = b - 2 >= a ? lines[b - 2].y - lines[b - 1].y : null
      if (running(lines[b - 1], gap)) b--
      else break
    }
    return lines.slice(a, b)
  })
}

// Рядки всіх сторінок → блоки (абзаци й заголовки) з мітками сторінок.
export function blocksFromPages(pages, stats) {
  const { body, left, right, lineGap } = stats || pageStats(pages)

  const blocks = []
  let cur = []
  let prev = null
  let ids = []
  // Мітка сторінки дістається першому блоку, що почався на ній (для змісту PDF).
  let pagePending = []
  let curPos = null
  const push = () => {
    if (cur.length) blocks.push({ k: 'p', s: joinLines(cur), ids: ids.concat('b:' + blocks.length), pos: curPos })
    cur = []
    ids = []
  }
  pages.forEach((lines, pi) => {
    pagePending.push('page:' + pi)
    lines.forEach((l, li) => {
      const t = l.text.trim()
      const heading = l.size >= body * 1.25 && t.length <= 120
      if (heading) {
        push()
        const last = blocks[blocks.length - 1]
        // Заголовок у два рядки — один блок.
        if (last && last.k === 'h' && prev && prev.heading && li > 0 && prev.y - l.y < l.size * 1.8) last.s += ' ' + t
        else {
          blocks.push({ k: 'h', s: t, lvl: l.size >= body * 1.5 ? 1 : 2, ids: pagePending.concat('b:' + blocks.length), pos: { p: pi, y: l.y } })
          pagePending = []
        }
        prev = { y: l.y, heading: true, room: Infinity }
        return
      }
      let start = !cur.length
      if (!start && prev) {
        if (li > 0 && prev.y - l.y > lineGap * 1.6) start = true
        if (l.x > left + body * 0.8) start = true
        // Попередній рядок закінчився рано, хоча перше слово цього рядка там вмістилося б.
        const word = t.split(/\s+/)[0] || ''
        if (prev.room > (word.length + 1) * l.size * 0.55) start = true
      }
      if (start) {
        push()
        ids = pagePending
        pagePending = []
        curPos = { p: pi, y: l.y }
      }
      cur.push(t)
      prev = { y: l.y, heading: false, room: right - l.right }
    })
  })
  push()
  return blocks
}

async function outlineEntries(pdf) {
  const out = []
  let outline = null
  try {
    outline = await pdf.getOutline()
  } catch (e) {
    return out
  }
  const visit = async (items, depth) => {
    for (const it of items || []) {
      try {
        let dest = it.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
          const page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])
          const kind = dest[1] && dest[1].name
          const top = kind === 'XYZ' && typeof dest[3] === 'number' ? dest[3] : kind === 'FitH' && typeof dest[2] === 'number' ? dest[2] : null
          out.push({ title: it.title, page, top })
        }
      } catch (e) {}
      if (depth < 2) await visit(it.items, depth + 1)
    }
  }
  await visit(outline, 0)
  return out
}

// Закладка (сторінка, висота) → перший блок, що починається на ній не вище за закладку.
function blockForMark(blocks, mark) {
  for (let i = 0; i < blocks.length; i++) {
    const p = blocks[i].pos
    if (!p) continue
    if (p.p > mark.page) return i
    if (p.p === mark.page && (mark.top === null || p.y <= mark.top + 2)) return i
  }
  return -1
}

export async function convertPdf(bytes, opts) {
  const o = opts || {}
  const pdfjs = o.pdfjs || (await loadPdfjs())
  let pdf
  try {
    pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new BookError('pdf_password')
    throw new BookError('bad_pdf', e && e.message)
  }
  let title = ''
  let author = ''
  try {
    const meta = await pdf.getMetadata()
    title = cleanInline((meta && meta.info && meta.info.Title) || '')
    author = cleanInline((meta && meta.info && meta.info.Author) || '')
  } catch (e) {}
  if (/microsoft|\.docx?$|^untitled/i.test(title)) title = ''

  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    pages.push(linesFromItems(tc.items))
    try {
      page.cleanup()
    } catch (e) {}
    if (o.onProgress) o.onProgress(i, pdf.numPages)
  }
  const chars = pages.reduce((n, lines) => n + lines.reduce((m, l) => m + l.text.trim().length, 0), 0)
  if (chars < 200 || chars < pdf.numPages * 30) throw new BookError('pdf_scan')

  const stats = pageStats(pages)
  const blocks = blocksFromPages(stripRunning(pages, stats), stats)
  const marks = await outlineEntries(pdf)
  try {
    await pdf.destroy()
  } catch (e) {}
  const book = assemble(blocks, { headingChapters: true, maxLevel: 1 })
  const ch = []
  const seen = {}
  marks.forEach((e) => {
    const bi = blockForMark(blocks, e)
    const off = bi >= 0 ? book.anchors['b:' + bi] : undefined
    const t = cleanInline(e.title)
    if (off === undefined || !t || seen[off]) return
    seen[off] = 1
    ch.push([off, t.slice(0, 80)])
  })
  ch.sort((a, b) => a[0] - b[0])
  return { title, author, text: book.text, ch: ch.length >= 2 ? ch : book.ch, h: book.h }
}
