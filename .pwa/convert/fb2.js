// FB2 → блоки: назви розділів (section/title) стають розділами, примітки — в кінці.

import { parseXml, all, first, kids, name, attr, text } from './xml.js'
import { assemble, cleanInline, decodeText, BookError } from './text.js'

const NOTE_RE = /^[[(]?(\d{1,3}|[*†‡]{1,3})[\])]?$/

// Текст абзацу: посилання на примітки → [1], решта — як є.
function inline(el) {
  let out = ''
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3 || c.nodeType === 4) out += c.nodeValue
    else if (c.nodeType === 1) {
      const n = name(c)
      if (n === 'image') continue
      if (n === 'a' && (attr(c, 'type') === 'note' || NOTE_RE.test(text(c)))) {
        const t = text(c)
        const m = t.match(NOTE_RE)
        out += '[' + (m ? m[1] : t) + ']'
      } else out += inline(c)
    }
  }
  return out
}

function titleText(el) {
  return kids(el)
    .map((k) => cleanInline(inline(k)))
    .filter(Boolean)
    .join('. ')
}

function walkSection(sec, depth, out) {
  kids(sec).forEach((el) => {
    const n = name(el)
    if (n === 'title') {
      const t = titleText(el)
      if (t) out.push({ k: 'h', s: t, lvl: Math.min(6, depth), chap: depth <= 3 ? t : '' })
    } else if (n === 'section') walkSection(el, depth + 1, out)
    else if (n === 'p' || n === 'subtitle' || n === 'text-author' || n === 'v') out.push({ k: 'p', s: inline(el) })
    else if (n === 'epigraph' || n === 'cite' || n === 'annotation') walkSection(el, depth, out)
    else if (n === 'poem' || n === 'stanza') walkSection(el, depth, out)
    else if (n === 'table') {
      all(el, 'tr').forEach((tr) => {
        out.push({ k: 'p', s: kids(tr).map((td) => cleanInline(inline(td))).filter(Boolean).join(' | ') })
      })
    }
  })
}

function notes(body, out) {
  const secs = kids(body).filter((k) => name(k) === 'section')
  if (!secs.length) return
  out.push({ k: 'h', s: 'Примітки', lvl: 1, chap: 'Примітки' })
  secs.forEach((sec) => {
    const label = kids(sec).find((k) => name(k) === 'title')
    const num = label ? titleText(label) : ''
    const paras = kids(sec)
      .filter((k) => name(k) !== 'title')
      .map((k) => cleanInline(k.nodeType === 1 ? inline(k) : ''))
      .filter(Boolean)
    if (!paras.length) return
    out.push({ k: 'p', s: (num ? num + '. ' : '') + paras[0] })
    paras.slice(1).forEach((p) => out.push({ k: 'p', s: p }))
  })
}

export function convertFb2(bytes) {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200))
  const m = head.match(/encoding=["']([A-Za-z0-9_-]+)["']/)
  let src = decodeText(bytes, m ? m[1].toLowerCase() : '')
  // Вбудовані картинки (base64) лише гальмують розбір.
  src = src.replace(/<binary[\s\S]*?<\/binary>/g, '').replace(/^﻿/, '')
  const doc = parseXml(src)
  if (!doc) throw new BookError('bad_fb2')

  const info = first(doc, 'title-info')
  const title = cleanInline(text(first(info, 'book-title')))
  const a = first(info, 'author')
  let author = ''
  if (a) {
    author = ['first-name', 'middle-name', 'last-name']
      .map((k) => text(first(a, k)))
      .filter(Boolean)
      .join(' ')
    if (!author) author = text(first(a, 'nickname'))
  }

  const bodies = all(doc, 'body')
  const main = bodies.find((b) => !b.getAttribute('name')) || bodies[0]
  if (!main) throw new BookError('empty')
  const out = []
  walkSection(main, 0, out)
  bodies
    .filter((b) => b !== main && /notes|comments/.test(b.getAttribute('name') || ''))
    .forEach((b) => notes(b, out))
  const book = assemble(out, {})
  if (!book.text) throw new BookError('empty')
  return { title, author: cleanInline(author), text: book.text, ch: book.ch, h: book.h }
}
