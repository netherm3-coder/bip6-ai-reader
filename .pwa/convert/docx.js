// DOCX → абзаци; заголовки за стилями (Heading N / Заголовок N) або рівнем структури.

import { parseXml, all, first, kids, name, attr, text } from './xml.js'
import { assemble, cleanInline, BookError } from './text.js'

function headingLevels(stylesXml) {
  const levels = {}
  const doc = stylesXml ? parseXml(stylesXml) : null
  if (!doc) return levels
  all(doc, 'style').forEach((st) => {
    const id = attr(st, 'styleId')
    const nm = first(st, 'name')
    const label = nm ? attr(nm, 'val') : ''
    const m = /(?:heading|заголовок)\s*(\d)/i.exec(label) || /^heading(\d)$/i.exec(id)
    if (m) levels[id] = Number(m[1])
    else if (/^title$/i.test(label) || /^(назва|title)$/i.test(id)) levels[id] = 1
    const outline = first(st, 'outlineLvl')
    if (outline && levels[id] === undefined) levels[id] = Number(attr(outline, 'val')) + 1
  })
  return levels
}

function runText(p) {
  let out = ''
  const visit = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      const n = name(c)
      if (n === 't') out += c.textContent
      else if (n === 'tab') out += ' '
      else if (n === 'br' || n === 'cr') out += '\n'
      else if (n === 'nobreakhyphen') out += '-'
      else if (n === 'del' || n === 'instrtext' || n === 'delinstrtext' || n === 'ppr' || n === 'rpr') continue
      else visit(c)
    }
  }
  visit(p)
  return out
}

function level(p, levels) {
  const ppr = kids(p).find((k) => name(k) === 'ppr')
  if (!ppr) return 0
  const style = kids(ppr).find((k) => name(k) === 'pstyle')
  const id = style ? attr(style, 'val') : ''
  if (id && levels[id]) return levels[id]
  const outline = kids(ppr).find((k) => name(k) === 'outlinelvl')
  if (outline) {
    const v = Number(attr(outline, 'val'))
    if (v >= 0 && v < 6) return v + 1
  }
  return 0
}

export function convertDocx(files) {
  const xml = files['word/document.xml']
  if (!xml) throw new BookError('bad_docx')
  const dec = (b) => new TextDecoder('utf-8').decode(b)
  const doc = parseXml(dec(xml))
  if (!doc) throw new BookError('bad_docx')
  const levels = headingLevels(files['word/styles.xml'] ? dec(files['word/styles.xml']) : '')
  const body = first(doc, 'body')
  const out = []

  const visit = (node) => {
    kids(node).forEach((el) => {
      const n = name(el)
      if (n === 'p') {
        const lvl = level(el, levels)
        const parts = runText(el).split('\n')
        parts.forEach((s) => out.push(lvl ? { k: 'h', s, lvl } : { k: 'p', s }))
      } else if (n === 'tbl') {
        all(el, 'tr').forEach((tr) => {
          const cells = kids(tr)
            .filter((c) => name(c) === 'tc')
            .map((c) => cleanInline(all(c, 'p').map(runText).join(' ')))
            .filter(Boolean)
          out.push({ k: 'p', s: cells.join(' | ') })
        })
      } else if (n === 'sdt') {
        const content = kids(el).find((k) => name(k) === 'sdtcontent')
        if (content) visit(content)
      } else if (n !== 'sectpr') visit(el)
    })
  }
  if (body) visit(body)

  // Автор у властивостях DOCX — зазвичай той, хто редагував файл, тож не беремо.
  let title = ''
  if (files['docProps/core.xml']) {
    const core = parseXml(dec(files['docProps/core.xml']))
    if (core) title = cleanInline(text(first(core, 'title')))
    if (/microsoft|^документ|^document|\.docx?$/i.test(title)) title = ''
  }
  const book = assemble(out, { headingChapters: true, maxLevel: 2 })
  if (!book.text) throw new BookError('empty')
  return { title, author: '', text: book.text, ch: book.ch, h: book.h }
}
