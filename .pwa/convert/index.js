// Книга з телефона → простий текст для годинника: { title, author, text, ch, h, fmt }.
// ch — розділи [зсув, назва], h — зсуви абзаців-заголовків.

import { unzipSync } from '../vendor/unzip.js'
import { convertEpub } from './epub.js'
import { convertFb2 } from './fb2.js'
import { convertTxt } from './txt.js'
import { convertDocx } from './docx.js'
import { convertPdf } from './pdf.js'
import { htmlBlocks } from './html.js'
import { parseMarkup, first, text } from './xml.js'
import { assemble, cleanInline, nameFromFile, decodeText, BookError } from './text.js'

export { BookError }

export const ACCEPT = '.epub,.fb2,.zip,.txt,.docx,.pdf,.html,.htm'

export const ERRORS = {
  too_big: 'Книга завелика: понад 4 млн символів.',
  empty: 'У файлі не знайшлося тексту.',
  bad_epub: 'Не вдалося прочитати EPUB — файл пошкоджений?',
  bad_fb2: 'Не вдалося прочитати FB2 — файл пошкоджений?',
  bad_docx: 'Не вдалося прочитати DOCX.',
  bad_pdf: 'Не вдалося відкрити PDF.',
  pdf_password: 'PDF захищений паролем.',
  pdf_scan: 'У цьому PDF немає тексту — схоже, це скан. Такий не підійде.',
  drm: 'EPUB захищений від копіювання (DRM) — його не прочитати.',
  doc_old: 'Старий формат .doc не підтримується. Збережи файл як DOCX.',
  zip_unknown: 'У цьому архіві немає книги FB2, EPUB чи DOCX.',
  unsupported: 'Такий формат не підтримується. Підходять: EPUB, FB2, FB2.ZIP, TXT, DOCX, PDF.'
}

function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

function zipNames(bytes) {
  const names = []
  unzipSync(bytes, {
    filter(f) {
      names.push(f.name)
      return false
    }
  })
  return names
}

function unzip(bytes, keep) {
  return unzipSync(bytes, { filter: (f) => keep(f.name) })
}

export function detect(name, bytes) {
  const b = bytes
  const e = ext(name)
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const names = zipNames(b)
    if (names.indexOf('META-INF/container.xml') >= 0 || names.some((n) => /\.opf$/i.test(n))) return 'epub'
    if (names.indexOf('word/document.xml') >= 0) return 'docx'
    if (names.some((n) => /\.fb2$/i.test(n))) return 'fb2zip'
    return 'zip_unknown'
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'doc_old'
  const head = new TextDecoder('latin1').decode(b.subarray(0, 2000))
  if (/<FictionBook/i.test(head) || e === 'fb2') return 'fb2'
  if (e === 'html' || e === 'htm' || e === 'xhtml' || /^\s*(<!doctype html|<html)/i.test(head)) return 'html'
  if (['mobi', 'azw', 'azw3', 'djvu', 'djv', 'rtf', 'doc', 'odt', 'cbz', 'cbr'].indexOf(e) >= 0) return 'unsupported'
  const sample = b.subarray(0, 4096)
  let zeros = 0
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) zeros++
  const utf16 = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)
  if (zeros > sample.length * 0.01 && !utf16) return 'unsupported'
  return 'txt'
}

function convertHtml(bytes) {
  const doc = parseMarkup(decodeText(bytes))
  const blocks = htmlBlocks(doc, 'page', [])
  const book = assemble(blocks, { headingChapters: true, maxLevel: 2 })
  return { title: cleanInline(text(first(doc, 'title'))), author: '', text: book.text, ch: book.ch, h: book.h }
}

export async function convertBook(name, bytes, opts) {
  const fmt = detect(name, bytes)
  let res = null
  if (fmt === 'epub') {
    const files = unzip(bytes, (n) => /\.(x?html?|xml|opf|ncx)$/i.test(n) || n === 'mimetype')
    if (files['META-INF/encryption.xml'] && /EncryptedData/.test(new TextDecoder().decode(files['META-INF/encryption.xml']))) {
      const enc = new TextDecoder().decode(files['META-INF/encryption.xml'])
      // Шифрування лише шрифтів (обфускація) читанню не заважає.
      if (/<(\w+:)?CipherReference[^>]*URI="[^"]*\.(x?html?|xml)"/i.test(enc)) throw new BookError('drm')
    }
    res = convertEpub(files, name)
  } else if (fmt === 'docx') {
    res = convertDocx(unzip(bytes, (n) => n === 'word/document.xml' || n === 'word/styles.xml' || n === 'docProps/core.xml'))
  } else if (fmt === 'fb2zip') {
    const files = unzip(bytes, (n) => /\.fb2$/i.test(n))
    const key = Object.keys(files)[0]
    res = convertFb2(files[key])
    if (!res.title) res.title = nameFromFile(key)
  } else if (fmt === 'fb2') res = convertFb2(bytes)
  else if (fmt === 'pdf') res = await convertPdf(bytes, opts)
  else if (fmt === 'html') res = convertHtml(bytes)
  else if (fmt === 'txt') res = convertTxt(bytes)
  else throw new BookError(fmt)

  if (!res || !res.text) throw new BookError('empty')
  return {
    title: (res.title || nameFromFile(name)).slice(0, 120),
    author: (res.author || '').slice(0, 80),
    text: res.text,
    ch: res.ch || [],
    h: res.h || [],
    fmt: fmt === 'fb2zip' ? 'fb2' : fmt
  }
}

export function errorText(e) {
  const code = e && e.code
  return ERRORS[code] || 'Не вдалося прочитати файл' + (e && e.message ? ': ' + e.message : '.')
}
