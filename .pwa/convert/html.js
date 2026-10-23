// XHTML/HTML (розділи EPUB, .html) → блоки тексту: абзаци, заголовки, мітки id.

import { name, attr, text, first } from './xml.js'

const HEAD = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
const BLOCK = new Set([
  'p', 'div', 'li', 'blockquote', 'pre', 'dt', 'dd', 'tr', 'figcaption', 'section', 'article', 'header',
  'footer', 'aside', 'table', 'tbody', 'thead', 'tfoot', 'ul', 'ol', 'dl', 'figure', 'main', 'body',
  'center', 'address', 'caption', 'hgroup', 'details', 'summary', 'nav', 'hr'
])
const SKIP = new Set([
  'script', 'style', 'head', 'title', 'svg', 'math', 'img', 'image', 'object', 'video', 'audio', 'iframe',
  'noscript', 'template', 'button', 'input', 'select', 'textarea', 'map', 'rt', 'rp'
])
const NOTE_RE = /^[[(]?(\d{1,3}|[*†‡]{1,3})[\])]?$/

function flush(st) {
  const s = st.cur.replace(/\s+/g, ' ').trim()
  if (s) {
    st.out.push({ k: st.kind, s: st.prefix + s, lvl: st.lvl, ids: st.ids })
    st.ids = []
    st.prefix = ''
  }
  st.cur = ''
}

function mark(el, st) {
  const id = el.getAttribute && (el.getAttribute('id') || (name(el) === 'a' ? el.getAttribute('name') : ''))
  if (id) st.ids.push(st.key + '#' + id)
}

function walk(node, st) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3 || c.nodeType === 4) {
      st.cur += c.nodeValue
      continue
    }
    if (c.nodeType !== 1) continue
    const n = name(c)
    if (SKIP.has(n)) continue
    if (n === 'br') {
      flush(st)
      continue
    }
    if (HEAD[n]) {
      flush(st)
      mark(c, st)
      const prev = { kind: st.kind, lvl: st.lvl }
      st.kind = 'h'
      st.lvl = HEAD[n]
      walk(c, st)
      flush(st)
      st.kind = prev.kind
      st.lvl = prev.lvl
      continue
    }
    if (BLOCK.has(n)) {
      flush(st)
      mark(c, st)
      if (n === 'li') st.prefix = '• '
      walk(c, st)
      flush(st)
      continue
    }
    mark(c, st)
    if (n === 'td' || n === 'th') {
      if (st.cur.trim()) st.cur += ' | '
      walk(c, st)
      continue
    }
    const type = attr(c, 'type')
    const t = text(c)
    if ((n === 'a' && /noteref/.test(type)) || (n === 'sup' && NOTE_RE.test(t))) {
      const m = t.match(NOTE_RE)
      st.cur += '[' + (m ? m[1] : t) + ']'
      continue
    }
    walk(c, st)
  }
}

// key — шлях файлу в книзі (для міток змісту «файл#id»). Повертає блоки в out.
export function htmlBlocks(doc, key, out) {
  const body = doc.body || first(doc, 'body') || doc.documentElement
  const st = { cur: '', ids: [key], out, key, kind: 'p', lvl: 0, prefix: '' }
  if (body) walk(body, st)
  flush(st)
  // Порожній файл: мітки переходять до наступного блоку.
  if (st.ids.length) out.push({ k: 'p', s: '', ids: st.ids })
  return out
}
