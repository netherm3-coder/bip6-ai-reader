// Вкладка «Книги»: вибрати файл → перетворити на текст (тут, у браузері) →
// надіслати в приватний bip6-ai-inbox. Годинник забирає книги сам.

import { convertBook, errorText, ACCEPT } from './convert/index.js'

const $ = (id) => document.getElementById(id)

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'class') node.className = attrs[k]
    else if (k === 'text') node.textContent = attrs[k]
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k])
    else node.setAttribute(k, attrs[k])
  })
  ;(children || []).forEach((c) => c && node.appendChild(c))
  return node
}

export function fmtChars(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + ' млн символів'
  if (n >= 1000) return Math.round(n / 1000) + ' тис. символів'
  return n + ' символів'
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ'
  return Math.max(1, Math.round(bytes / 1024)) + ' КБ'
}

// Приблизно стільки символів на сторінці годинника шрифтом 28.
const PAGE_CHARS = 230

export function initBooks(ctx) {
  const st = { book: null, busy: false, books: [], loaded: false }

  function show(kind, head, body) {
    const box = $('bookResult')
    box.className = 'result ' + kind
    $('bookResultHead').textContent = head
    $('bookResultBody').textContent = body || ''
  }
  function hide() {
    $('bookResult').classList.add('hidden')
  }

  function render() {
    const box = $('booksList')
    box.textContent = ''
    $('booksTitle').textContent = 'Книги для годинника' + (st.books.length ? ' · ' + st.books.length : '')
    if (!st.books.length) {
      box.appendChild(el('div', { class: 'empty', text: ctx.hasToken() ? 'Поки порожньо.' : 'Спершу налаштуй токен (⚙).' }))
      return
    }
    st.books.forEach((b) => {
      const sub = [b.author, fmtChars(b.chars || 0), b.ts ? ctx.fmtTime(b.ts) : ''].filter(Boolean).join(' · ')
      box.appendChild(
        el('div', { class: 'row' }, [
          el('span', { class: 'src-dot c-book' }),
          el('div', { class: 'r-main' }, [el('div', { class: 'r-t', text: b.title || 'Без назви' }), el('div', { class: 'r-s', text: sub })]),
          el('button', { class: 'del', type: 'button', 'aria-label': 'Видалити', onclick: () => remove(b) }, [ctx.svgX()])
        ])
      )
    })
  }

  async function load() {
    if (!ctx.hasToken()) {
      st.books = []
      render()
      return
    }
    try {
      st.books = await ctx.client().readBooks()
      st.loaded = true
      render()
    } catch (e) {
      $('booksList').textContent = ''
      $('booksList').appendChild(el('div', { class: 'empty', text: ctx.errText(e) }))
    }
  }

  async function remove(b) {
    if (st.busy) return
    if (!window.confirm('Видалити «' + (b.title || 'Без назви') + '» зі скриньки? На годиннику вона лишиться, поки не видалиш і там.')) return
    st.busy = true
    try {
      st.books = await ctx.client().removeBook(b.id)
      render()
    } catch (e) {
      show('err', 'Не вдалося видалити', ctx.errText(e))
    } finally {
      st.busy = false
    }
  }

  function preview(book, file) {
    st.book = book
    $('bookTitle').value = book.title
    $('bookAuthor').value = book.author
    const pages = Math.max(1, Math.round(book.text.length / PAGE_CHARS))
    const parts = [fmtChars(book.text.length), '≈ ' + pages + ' стор. на годиннику']
    parts.push(book.ch.length ? book.ch.length + ' розд.' : 'без розділів')
    $('bookStats').textContent = parts.join(' · ') + ' · ' + file.name
    const sample = book.text.slice(0, 320).replace(/\n/g, ' ¶ ')
    $('bookSample').textContent = sample + (book.text.length > 320 ? '…' : '')
    $('bookPreview').classList.remove('hidden')
  }

  function setBusy(on, label) {
    st.busy = on
    $('bookSend').disabled = on
    $('bookPick').classList.toggle('disabled', on)
    $('bookSend').textContent = on ? label || 'Надсилаю…' : 'Надіслати'
  }

  async function onFile(e) {
    const input = e.target
    const file = input.files && input.files[0]
    input.value = ''
    if (!file || st.busy) return
    $('bookPreview').classList.add('hidden')
    st.book = null
    if (file.size > 60 * 1024 * 1024) {
      show('err', 'Файл завеликий', 'Понад 60 МБ. Спробуй EPUB чи FB2 цієї книги — вони значно менші.')
      return
    }
    show('busy', 'Читаю «' + file.name + '»…', '')
    st.busy = true
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const book = await convertBook(file.name, bytes, {
        onProgress: (i, n) => show('busy', 'Читаю PDF…', 'Сторінка ' + i + ' з ' + n)
      })
      hide()
      preview(book, file)
    } catch (err) {
      show('err', 'Не вдалося прочитати книгу', errorText(err))
    } finally {
      st.busy = false
    }
  }

  async function send() {
    const book = st.book
    if (!book || st.busy) return
    if (!ctx.hasToken()) {
      ctx.openSettings('Встав токен — і книгу можна буде надіслати.')
      return
    }
    const title = $('bookTitle').value.replace(/\s+/g, ' ').trim().slice(0, 120) || book.title
    const author = $('bookAuthor').value.replace(/\s+/g, ' ').trim().slice(0, 80)
    const size = new TextEncoder().encode(book.text).length
    setBusy(true, 'Надсилаю…')
    show('busy', 'Надсилаю «' + title + '»…', fmtSize(size) + ' тексту — це може зайняти хвилину.')
    try {
      const check = await ctx.ensureConnection()
      if (!check.ok) {
        show('err', 'Не надіслано', ctx.checkText(check))
        return
      }
      const res = await ctx.client().addBook(Object.assign({}, book, { title, author }))
      st.books = res.books
      render()
      $('bookPreview').classList.add('hidden')
      st.book = null
      show('ok', '✓ «' + title + '» у скриньці', 'Відкрий AI Читалку на годиннику поруч із телефоном — книга скачається сама. Коли в «Книгах» на годиннику з’явиться «Усе скачано», телефон більше не потрібен.')
    } catch (e) {
      show('err', 'Не надіслано', ctx.errText(e))
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    st.book = null
    $('bookPreview').classList.add('hidden')
    hide()
  }

  $('bookFile').setAttribute('accept', ACCEPT)
  $('bookFile').addEventListener('change', onFile)
  $('bookSend').addEventListener('click', send)
  $('bookCancel').addEventListener('click', cancel)

  return {
    shown() {
      if (!st.loaded) load()
    },
    reload: load
  }
}
