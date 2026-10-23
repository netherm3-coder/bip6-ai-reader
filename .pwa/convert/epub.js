// EPUB 2/3 → блоки тексту в порядку читання + розділи зі змісту (nav або NCX).

import { parseXml, parseMarkup, all, first, kids, name, attr, text } from './xml.js'
import { htmlBlocks } from './html.js'
import { assemble, chaptersFromToc, cleanInline, decodeText, BookError } from './text.js'

function dirOf(path) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

// Шлях відносно файлу → нормалізований шлях у zip (без ../ і %20).
export function resolvePath(base, href) {
  let h = String(href || '')
  const hash = h.indexOf('#')
  const frag = hash >= 0 ? h.slice(hash + 1) : ''
  h = hash >= 0 ? h.slice(0, hash) : h
  try {
    h = decodeURIComponent(h)
  } catch (e) {}
  const parts = (h ? dirOf(base) + h : base).split('/')
  const out = []
  parts.forEach((p) => {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  })
  return out.join('/') + (frag ? '#' + frag : '')
}

function str(files, path) {
  const bytes = files[path]
  return bytes ? decodeText(bytes) : null
}

function findFile(files, path) {
  if (files[path]) return path
  const low = path.toLowerCase()
  return Object.keys(files).find((k) => k.toLowerCase() === low) || null
}

function navEntries(doc, base) {
  const navs = all(doc, 'nav')
  const nav = navs.find((n) => /toc/.test(attr(n, 'type'))) || navs[0]
  if (!nav) return []
  const out = []
  const walkOl = (ol) => {
    kids(ol)
      .filter((li) => name(li) === 'li')
      .forEach((li) => {
        const label = kids(li).find((k) => name(k) === 'a' || name(k) === 'span')
        if (label && name(label) === 'a' && label.getAttribute('href')) {
          out.push({ title: text(label), key: resolvePath(base, label.getAttribute('href')) })
        }
        kids(li)
          .filter((k) => name(k) === 'ol' || name(k) === 'ul')
          .forEach(walkOl)
      })
  }
  kids(nav)
    .filter((k) => name(k) === 'ol' || name(k) === 'ul')
    .forEach(walkOl)
  return out
}

function ncxEntries(doc, base) {
  const out = []
  const walkPoints = (parent) => {
    kids(parent)
      .filter((k) => name(k) === 'navpoint')
      .forEach((np) => {
        const label = first(np, 'text')
        const content = kids(np).find((k) => name(k) === 'content')
        if (label && content && content.getAttribute('src')) {
          out.push({ title: text(label), key: resolvePath(base, content.getAttribute('src')) })
        }
        walkPoints(np)
      })
  }
  const map = first(doc, 'navMap')
  if (map) walkPoints(map)
  return out
}

export function convertEpub(files, fileName) {
  const container = str(files, 'META-INF/container.xml')
  const cdoc = container ? parseXml(container) : null
  const rootfile = cdoc ? first(cdoc, 'rootfile') : null
  const opfPath = rootfile ? findFile(files, rootfile.getAttribute('full-path') || '') : Object.keys(files).find((k) => /\.opf$/i.test(k))
  if (!opfPath) throw new BookError('bad_epub')
  const opf = parseXml(str(files, opfPath) || '')
  if (!opf) throw new BookError('bad_epub')

  const meta = first(opf, 'metadata')
  const title = cleanInline(text(first(meta, 'title')))
  const author = cleanInline(text(first(meta, 'creator')))

  const manifest = {}
  all(opf, 'item').forEach((it) => {
    manifest[it.getAttribute('id')] = {
      href: resolvePath(opfPath, it.getAttribute('href') || ''),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || ''
    }
  })
  const spineEl = first(opf, 'spine')
  const spine = all(opf, 'itemref')
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest[r.getAttribute('idref')])
    .filter((it) => it && /html|xml/.test(it.type))

  const blocks = []
  spine.forEach((it) => {
    const path = findFile(files, it.href)
    if (!path) return
    const doc = parseMarkup(str(files, path))
    htmlBlocks(doc, it.href, blocks)
  })
  if (!blocks.some((b) => b.s && b.s.trim())) throw new BookError('empty')

  // Зміст: EPUB3 nav, інакше NCX.
  let toc = []
  const navItem = Object.keys(manifest)
    .map((k) => manifest[k])
    .find((it) => /(^|\s)nav(\s|$)/.test(it.props))
  if (navItem && findFile(files, navItem.href)) {
    toc = navEntries(parseMarkup(str(files, findFile(files, navItem.href))), navItem.href)
  }
  if (toc.length < 2) {
    const ncxId = spineEl && spineEl.getAttribute('toc')
    const ncx = (ncxId && manifest[ncxId]) || Object.keys(manifest).map((k) => manifest[k]).find((it) => /ncx/.test(it.type))
    if (ncx && findFile(files, ncx.href)) {
      const doc = parseXml(str(files, findFile(files, ncx.href)))
      if (doc) {
        const n = ncxEntries(doc, ncx.href)
        if (n.length > toc.length) toc = n
      }
    }
  }

  const book = assemble(blocks, { headingChapters: true, maxLevel: 2 })
  const fromToc = chaptersFromToc(toc, book.anchors)
  return {
    title: title || '',
    author,
    text: book.text,
    ch: fromToc.length >= 2 ? fromToc : book.ch,
    h: book.h
  }
}
