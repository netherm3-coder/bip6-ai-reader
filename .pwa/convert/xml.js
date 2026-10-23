// Розбір XML/XHTML/HTML браузерним DOMParser (у тестах — підставленим).

function parser() {
  const P = globalThis.DOMParser
  if (!P) throw new Error('DOMParser недоступний')
  return new P()
}

function broken(doc) {
  if (!doc || !doc.documentElement) return true
  return doc.getElementsByTagName('parsererror').length > 0 || doc.documentElement.localName === 'parsererror'
}

export function parseXml(str) {
  const doc = parser().parseFromString(str, 'application/xml')
  return broken(doc) ? null : doc
}

// XHTML із книги: суворо як XML, а якщо він кривий (&nbsp;, незакриті теги) — як HTML.
export function parseMarkup(str) {
  const clean = String(str).replace(/^﻿/, '')
  const xml = parser().parseFromString(clean, 'application/xhtml+xml')
  if (!broken(xml)) return xml
  return parser().parseFromString(clean, 'text/html')
}

export function all(root, local) {
  if (!root) return []
  let list = null
  try {
    list = root.getElementsByTagNameNS('*', local)
  } catch (e) {
    list = null
  }
  if (!list || !list.length) list = root.getElementsByTagName(local)
  return Array.prototype.slice.call(list)
}

export function first(root, local) {
  return all(root, local)[0] || null
}

export function kids(node) {
  const out = []
  if (!node) return out
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c)
  return out
}

export function name(el) {
  return String(el.localName || el.nodeName || '')
    .replace(/^.*:/, '')
    .toLowerCase()
}

export function text(el) {
  return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''
}

// Атрибут без огляду на префікс простору імен (l:href, xlink:href, epub:type).
export function attr(el, local) {
  if (!el || !el.attributes) return ''
  const direct = el.getAttribute(local)
  if (direct !== null && direct !== undefined) return direct
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]
    const n = String(a.localName || a.name || '').replace(/^.*:/, '')
    if (n === local) return a.value
  }
  return ''
}
