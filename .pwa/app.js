import { cleanText, makeTitle, looksLikeOnlyLink, detectSource } from './clean.js'
import { createClient, validRepo } from './github.js'
import { initBooks } from './books-ui.js'

const DEFAULT_REPO = 'netherm3-coder/bip6-ai-inbox'
const SHARE_CACHE = 'na-hodynnyk-share' // те саме ім'я, що в sw.js
const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?' +
  new URLSearchParams({
    name: 'bip6-ai',
    description: 'Відповіді AI на годинник: доступ лише до bip6-ai-inbox',
    expires_in: 'none',
    contents: 'write'
  }).toString()
const SRC_NAMES = { claude: 'Claude', gemini: 'Gemini' }
const ERR = {
  unauthorized: 'Токен недійсний або прострочений — встав новий у налаштуваннях.',
  forbidden: 'Токен без права запису. Потрібен доступ Contents: Read and write до bip6-ai-inbox.',
  not_found: 'Репозиторій не знайдено, або токен не має до нього доступу.',
  rate_limited: 'GitHub тимчасово обмежив запити. Спробуй за кілька хвилин.',
  network: 'Немає інтернету або GitHub недоступний.',
  server: 'Помилка на боці GitHub. Спробуй ще раз.',
  conflict: 'Не вдалося записати — спробуй ще раз.',
  public: 'Репозиторій публічний: відповіді побачить будь-хто. Зроби його приватним — і спробуй знову.',
  bad_repo: 'Назва репозиторію має вигляд «власник/назва».'
}

// ---------- сховище браузера ----------

const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : v
    } catch (e) {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch (e) {}
  }
}

const session = {
  get(key) {
    try {
      return sessionStorage.getItem(key)
    } catch (e) {
      return null
    }
  },
  set(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, value)
    } catch (e) {}
  }
}

// ---------- стан ----------

const state = {
  token: local.get('token', ''),
  repo: local.get('repo', DEFAULT_REPO),
  src: local.get('src', 'claude') === 'gemini' ? 'gemini' : 'claude',
  items: [],
  check: null, // { ok, code, name }
  busy: false,
  last: null, // останнє надіслане: { text, at, id, title }
  reading: false, // чекаємо на буфер (можливо, на запит дозволу)
  boxPrev: '', // вміст поля до останньої зміни
  tab: 'answers'
}
let books = null

const $ = (id) => document.getElementById(id)

function client() {
  return createClient({ token: state.token, repo: state.repo })
}

function errText(e) {
  const code = (e && e.code) || 'network'
  return ERR[code] || 'Помилка: ' + ((e && e.message) || code)
}

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const hm = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= day0) return 'сьогодні ' + hm
  if (ts >= day0 - 86400000) return 'вчора ' + hm
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) + ' ' + hm
}

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

// ---------- статус підключення ----------

function setStatus(kind, text) {
  $('statusDot').className = 'dot ' + (kind || '')
  $('statusText').textContent = text
}

async function checkConnection() {
  if (!state.token) {
    state.check = { ok: false, code: 'no_token' }
    setStatus('warn', 'Не налаштовано — натисни ⚙')
    return state.check
  }
  if (!validRepo(state.repo)) {
    state.check = { ok: false, code: 'bad_repo' }
    setStatus('bad', 'Неправильна назва репозиторію')
    return state.check
  }
  setStatus('', 'Перевірка…')
  try {
    const info = await client().checkRepo()
    if (!info.private) {
      state.check = { ok: false, code: 'public', name: info.name }
      setStatus('bad', 'Репозиторій публічний — зроби приватним')
    } else {
      state.check = { ok: true, code: 'ok', name: info.name }
      setStatus('ok', 'Підключено · ' + info.name.split('/')[1] + ' (приватний)')
    }
  } catch (e) {
    state.check = { ok: false, code: e.code || 'network' }
    setStatus(e.code === 'network' ? 'warn' : 'bad', e.code === 'network' ? 'Немає інтернету' : errText(e))
  }
  return state.check
}

// ---------- список ----------

function renderList() {
  const box = $('list')
  box.textContent = ''
  $('listTitle').textContent = 'На годиннику' + (state.items.length ? ' · ' + state.items.length : '')
  if (!state.items.length) {
    box.appendChild(el('div', { class: 'empty', text: state.token ? 'Поки порожньо.' : 'Спершу налаштуй токен (⚙).' }))
    return
  }
  state.items.forEach((item) => {
    const src = SRC_NAMES[item.src] ? item.src : 'claude'
    box.appendChild(
      el('div', { class: 'row' }, [
        el('span', { class: 'src-dot c-' + src }),
        el('div', { class: 'r-main' }, [
          el('div', { class: 'r-t', text: item.title || 'Без назви' }),
          el('div', { class: 'r-s', text: SRC_NAMES[src] + ' · ' + fmtTime(item.ts) })
        ]),
        el(
          'button',
          {
            class: 'del',
            type: 'button',
            'aria-label': 'Видалити',
            onclick: () => removeItem(item)
          },
          [svgX()]
        )
      ])
    )
  })
}

function svgX() {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.2')
  svg.setAttribute('stroke-linecap', 'round')
  const p = document.createElementNS(ns, 'path')
  p.setAttribute('d', 'M6 6l12 12M18 6L6 18')
  svg.appendChild(p)
  return svg
}

async function loadList() {
  if (!state.token || !validRepo(state.repo)) {
    state.items = []
    renderList()
    return
  }
  try {
    const { items } = await client().readIndex()
    state.items = items
    renderList()
  } catch (e) {
    $('list').textContent = ''
    $('list').appendChild(el('div', { class: 'empty', text: errText(e) }))
  }
}

async function removeItem(item) {
  if (state.busy) return
  if (!window.confirm('Видалити «' + (item.title || 'Без назви') + '» з годинника?')) return
  state.busy = true
  try {
    state.items = await client().remove(item.id)
    renderList()
    forgetLast(item.id)
    if (state.lastEntry && state.lastEntry.id === item.id) hideResult()
  } catch (e) {
    showResult('err', 'Не вдалося видалити', errText(e))
  } finally {
    state.busy = false
  }
}

// ---------- результат ----------

function hideResult() {
  $('result').classList.add('hidden')
}

function showResult(kind, head, title, actions) {
  const box = $('result')
  box.className = 'result ' + kind
  $('resultHead').textContent = head
  $('resultTitle').textContent = title || ''
  const act = $('resultActions')
  act.textContent = ''
  ;(actions || []).forEach((a) =>
    act.appendChild(el('button', { class: 'chip' + (a.danger ? ' danger' : ''), type: 'button', text: a.label, onclick: a.onClick }))
  )
  box.classList.remove('hidden')
}

function showSent(entry) {
  state.lastEntry = entry
  const other = entry.src === 'gemini' ? 'claude' : 'gemini'
  showResult('ok', '✓ На годиннику · ' + SRC_NAMES[entry.src], '«' + entry.title + '»', [
    { label: 'Це ' + SRC_NAMES[other], onClick: () => retag(entry, other) },
    { label: 'Скасувати', danger: true, onClick: () => undo(entry) }
  ])
}

async function retag(entry, src) {
  if (state.busy) return
  state.busy = true
  try {
    state.items = await client().setSource(entry.id, src)
    renderList()
    showSent(Object.assign({}, entry, { src }))
  } catch (e) {
    showResult('err', 'Не вдалося змінити', errText(e))
  } finally {
    state.busy = false
  }
}

async function undo(entry) {
  if (state.busy) return
  state.busy = true
  try {
    state.items = await client().remove(entry.id)
    renderList()
    forgetLast(entry.id)
    showResult('ok', 'Скасовано', '«' + entry.title + '» прибрано з годинника')
  } catch (e) {
    showResult('err', 'Не вдалося скасувати', errText(e))
  } finally {
    state.busy = false
  }
}

// ---------- надсилання ----------

function setBusy(on) {
  state.busy = on
  $('paste').disabled = on
  $('boxSend').disabled = on
  $('pasteLabel').textContent = on ? 'Надсилаю…' : 'Вставити й надіслати'
  $('pasteZone').classList.toggle('busy', on)
}

// Видалене з годинника можна надіслати знову одразу.
function forgetLast(id) {
  if (state.last && state.last.id === id) state.last = null
}

async function send(raw, hint) {
  if (state.busy) return false
  const source = String(raw || '')
  if (!state.token) {
    session.set('pending', JSON.stringify({ raw: source, hint: hint || '' }))
    openSettings('Встав токен — і текст одразу піде на годинник.')
    return false
  }
  if (looksLikeOnlyLink(source)) {
    showResult('err', 'Це посилання, а не текст', 'Скопіюй саму відповідь кнопкою «Копіювати» і спробуй ще раз.')
    return false
  }
  const text = cleanText(source)
  if (!text) {
    showResult('err', 'Порожньо', 'Немає тексту для надсилання.')
    return false
  }
  const now = Date.now()
  // Той самий текст щойно пішов (подвійний дотик, у буфері ще стара відповідь) — не дублюємо.
  if (state.last && state.last.text === text && now - state.last.at < 90000) {
    showResult('ok', '✓ Уже на годиннику', '«' + state.last.title + '» надіслано щойно. Скопіюй нову відповідь.')
    return true
  }

  setBusy(true)
  showResult('busy', 'Надсилаю на годинник…', '')
  try {
    if (!state.check || !state.check.ok) {
      const res = await checkConnection()
      if (!res.ok) {
        const msg = res.code === 'public' ? ERR.public : errText(res)
        showResult('err', 'Не надіслано', msg, res.code === 'public' ? [{ label: 'Відкрити налаштування репозиторію', onClick: openRepoSettings }] : [])
        return false
      }
    }
    const src = hint || detectSource(source) || state.src
    const { entry, items } = await client().add({ text, src, title: makeTitle(text) })
    state.items = items
    state.last = { text, at: now, id: entry.id, title: entry.title }
    renderList()
    showSent(entry)
    session.set('pending', null)
    return true
  } catch (e) {
    if (e.code === 'unauthorized' || e.code === 'not_found') state.check = null
    showResult('err', 'Не надіслано', errText(e))
    return false
  } finally {
    setBusy(false)
  }
}

// ---------- кнопка «Вставити й надіслати» ----------
// Один дотик: читає буфер і одразу надсилає, без підтверджень. Читати буфер
// браузер дає лише з дозволу: Chrome питає його один раз і далі пам'ятає.
// Без дозволу лишається поле нижче (утримати → «Вставити»).

const CLIP_HELP = {
  denied: {
    head: 'Браузер заблокував буфер для цієї сторінки',
    body:
      'Увімкни: значок ліворуч від адреси → «Дозволи» → «Буфер обміну» → «Дозволити».\n' +
      'Якщо там такого немає: Chrome ⋮ → Налаштування → Налаштування сайтів → Буфер обміну → дозволь запити й прибери цей сайт із заблокованих.\n' +
      'Потім натисни кнопку ще раз.'
  },
  inapp: {
    head: 'Тут буфер недоступний',
    body: 'Сторінку відкрито всередині іншої програми. Відкрий її в Chrome: ⋮ → «Відкрити в Chrome». Там браузер один раз спитає дозвіл.'
  },
  noprompt: {
    head: 'Браузер не спитав дозволу на буфер',
    body:
      'Якщо сторінку відкрито з іншої програми (Claude, Telegram…), відкрий її в самому Chrome: ⋮ → «Відкрити в Chrome».\n' +
      'Якщо вже в Chrome: ⋮ → Налаштування → Налаштування сайтів → Буфер обміну → дозволь запити й прибери цей сайт із заблокованих.'
  }
}
const CLIP_FALLBACK = 'Поки що: утримуй пунктирне поле → «Вставити».'

function canReadClipboard() {
  return !!(navigator.clipboard && navigator.clipboard.readText)
}

// Вбудований браузер іншої програми (WebView): там буфер не читається взагалі.
function inAppBrowser() {
  return /; wv\)|FBAN|FBAV|Instagram|Telegram/i.test(navigator.userAgent || '')
}

async function clipPermission() {
  try {
    return await navigator.permissions.query({ name: 'clipboard-read' })
  } catch (e) {
    return null
  }
}

async function showClipHelp() {
  let kind = 'noprompt'
  if (!canReadClipboard() || inAppBrowser()) kind = 'inapp'
  else {
    const perm = await clipPermission()
    if (perm && perm.state === 'denied') kind = 'denied'
  }
  showResult('err', CLIP_HELP[kind].head, CLIP_HELP[kind].body + '\n' + CLIP_FALLBACK)
  $('clipNote').classList.add('hidden') // кроки вже в повідомленні
}

async function pasteAndSend() {
  if (state.busy || state.reading) return
  if (!canReadClipboard()) {
    showClipHelp()
    return
  }
  let text = ''
  state.reading = true
  try {
    text = await navigator.clipboard.readText() // перший раз Chrome питає дозвіл
  } catch (e) {
    showClipHelp()
    return
  } finally {
    state.reading = false
  }
  if (!hasText(text)) {
    showResult('err', 'Буфер порожній', 'Спершу натисни «Копіювати» під відповіддю в Claude чи Gemini.')
    return
  }
  await send(text)
}

// Попередження одразу, якщо кнопка точно не спрацює.
async function watchClipPermission() {
  const note = $('clipNote')
  const show = (text) => {
    note.textContent = text
    note.classList.toggle('hidden', !text)
  }
  if (!canReadClipboard() || inAppBrowser()) {
    show('⚠ Тут буфер недоступний, кнопка не спрацює. Відкрий сторінку в Chrome: ⋮ → «Відкрити в Chrome».')
    return
  }
  const perm = await clipPermission()
  if (!perm) return
  const render = () =>
    show(perm.state === 'denied' ? '⚠ Браузер заблокував буфер, кнопка не спрацює. Натисни її — покажу, як увімкнути.' : '')
  render()
  try {
    perm.addEventListener('change', render)
  } catch (e) {}
}

// ---------- поле для вставки ----------
// Запасний шлях без дозволу на буфер: утримати поле → «Вставити» (або
// торкнутися скопійованого тексту над клавіатурою). Вставлене йде одразу.

const PASTE_MIN = 25 // стільки символів за один раз — це вставка, а не набір

function hasText(s) {
  return /\S/.test(s || '')
}

function updateBox() {
  state.boxPrev = $('pasteBox').value
  $('boxActions').classList.toggle('hidden', !hasText(state.boxPrev))
}

// Системне меню «Вставити»: беремо текст із події й замінюємо ним поле,
// щоб він не дописався до старого.
function onBoxPaste(e) {
  const data = e.clipboardData
  const text = data ? data.getData('text/plain') || data.getData('text') : ''
  if (!hasText(text)) return // нехай браузер вставить сам, далі спрацює input
  e.preventDefault()
  $('pasteBox').value = text
  submitBox()
}

// Вставка, яку не видно як paste: підказка клавіатури, перетягування.
function onBoxInput(e) {
  const prev = state.boxPrev || ''
  const value = $('pasteBox').value
  updateBox()
  const type = e.inputType || ''
  const jump = !hasText(prev) && value.length - prev.length >= PASTE_MIN && /\s/.test(value.trim())
  if (type === 'insertFromPaste' || type === 'insertFromDrop' || jump) submitBox()
}

async function submitBox() {
  const box = $('pasteBox')
  const text = box.value
  if (state.busy || !hasText(text)) {
    updateBox()
    return
  }
  box.blur() // ховає клавіатуру, щоб було видно результат
  const ok = await send(text)
  if (ok && box.value === text) box.value = ''
  updateBox()
}

function clearBox() {
  $('pasteBox').value = ''
  updateBox()
}

function openRepoSettings() {
  window.open('https://github.com/' + state.repo + '/settings', '_blank', 'noopener')
}

// ---------- налаштування ----------

function openSettings(message) {
  $('settings').classList.remove('hidden')
  $('token').value = state.token
  $('repo').value = state.repo
  const msg = $('settingsMsg')
  msg.className = 'msg' + (message ? ' warn' : '')
  msg.textContent = message || ''
  if (!state.token) setTimeout(() => $('token').focus(), 50)
}

function closeSettings() {
  $('settings').classList.add('hidden')
}

async function saveSettings() {
  const token = $('token').value.trim()
  const repo = $('repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '')
  const msg = $('settingsMsg')
  if (!token) {
    msg.className = 'msg bad'
    msg.textContent = 'Встав токен GitHub.'
    return
  }
  if (!validRepo(repo)) {
    msg.className = 'msg bad'
    msg.textContent = ERR.bad_repo
    return
  }
  state.token = token
  state.repo = repo
  local.set('token', token)
  local.set('repo', repo)
  msg.className = 'msg'
  msg.textContent = 'Перевіряю…'
  const res = await checkConnection()
  if (res.ok) {
    msg.className = 'msg ok'
    msg.textContent = '✓ Підключено. Репозиторій приватний.'
    await loadList()
    if (books) books.reload()
    const pending = session.get('pending')
    if (pending) {
      try {
        const p = JSON.parse(pending)
        const sent = await send(p.raw, p.hint)
        if (sent && $('pasteBox').value === p.raw) clearBox()
      } catch (e) {}
    }
    setTimeout(closeSettings, 900)
  } else {
    msg.className = 'msg bad'
    msg.textContent = res.code === 'public' ? ERR.public : errText(res)
  }
}

// ---------- джерело ----------

function renderSource() {
  document.querySelectorAll('#srcSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.src === state.src))
  })
}

// ---------- «Поділитися» ----------

function shareFrom(title, text, url) {
  let raw = text
  if (url && raw.indexOf(url) < 0 && !text) raw = url
  if (!raw && title) raw = title
  const hint = /gemini/i.test(title) ? 'gemini' : /claude/i.test(title) ? 'claude' : ''
  return raw ? { raw, hint } : null
}

// Старий спосіб «Поділитися» — параметри в адресі (поки телефон не оновив установлену сторінку).
function readShare() {
  const p = new URLSearchParams(location.search)
  if (!p.has('text') && !p.has('url') && !p.has('title')) return null
  try {
    history.replaceState(null, '', location.pathname)
  } catch (e) {}
  return shareFrom(p.get('title') || '', p.get('text') || '', p.get('url') || '')
}

// Новий спосіб: sw.js поклав поділений текст у кеш і відкрив сторінку з ?shared=text.
async function takeSharedText() {
  try {
    const cache = await caches.open(SHARE_CACHE)
    const key = new URL('__shared-text', location.href).href
    const res = await cache.match(key)
    if (!res) return null
    await cache.delete(key)
    const d = await res.json()
    return shareFrom(String(d.title || ''), String(d.text || ''), String(d.url || ''))
  } catch (e) {
    return null
  }
}

// ---------- вкладки ----------

function setTab(tab) {
  state.tab = tab === 'books' ? 'books' : 'answers'
  local.set('tab', state.tab)
  $('tabAnswers').setAttribute('aria-pressed', String(state.tab === 'answers'))
  $('tabBooks').setAttribute('aria-pressed', String(state.tab === 'books'))
  $('main').classList.toggle('hidden', state.tab !== 'answers')
  $('booksTab').classList.toggle('hidden', state.tab !== 'books')
  if (state.tab === 'books' && books) books.shown()
}

// ---------- старт ----------

async function init() {
  books = initBooks({
    shareCache: SHARE_CACHE,
    client,
    hasToken: () => !!state.token,
    fmtTime,
    svgX,
    errText,
    openSettings,
    ensureConnection: async () => (state.check && state.check.ok ? state.check : checkConnection()),
    checkText: (res) => (res.code === 'public' ? ERR.public : errText(res))
  })
  $('tabAnswers').addEventListener('click', () => setTab('answers'))
  $('tabBooks').addEventListener('click', () => setTab('books'))
  $('tokenLink').href = TOKEN_URL
  $('openSettings').addEventListener('click', () => {
    if ($('settings').classList.contains('hidden')) openSettings()
    else closeSettings()
  })
  $('status').addEventListener('click', () => {
    if (state.check && state.check.code === 'public') openRepoSettings()
    else openSettings()
  })
  $('toggleToken').addEventListener('click', () => {
    const input = $('token')
    input.type = input.type === 'password' ? 'text' : 'password'
  })
  $('saveSettings').addEventListener('click', saveSettings)
  $('paste').addEventListener('click', pasteAndSend)
  watchClipPermission()
  const box = $('pasteBox')
  box.addEventListener('paste', onBoxPaste)
  box.addEventListener('input', onBoxInput)
  $('boxSend').addEventListener('click', submitBox)
  $('boxClear').addEventListener('click', clearBox)
  updateBox()
  document.querySelectorAll('#srcSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.src = b.dataset.src === 'gemini' ? 'gemini' : 'claude'
      local.set('src', state.src)
      renderSource()
    })
  )
  renderSource()

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  // «Поділитися» з іншої програми: ?shared=book — файл книги, ?shared=text — відповідь AI.
  const kind = new URLSearchParams(location.search).get('shared')
  let shared = readShare()
  if (kind) {
    try {
      history.replaceState(null, '', location.pathname)
    } catch (e) {}
    if (kind === 'text') shared = await takeSharedText()
  }
  const bookShare = kind === 'book' || kind === 'failed'
  setTab(bookShare ? 'books' : shared ? 'answers' : local.get('tab', 'answers'))
  if (kind === 'book') books.openShared()
  else if (kind === 'failed') books.sharedFailed()
  if (!state.token) {
    if (shared) session.set('pending', JSON.stringify(shared))
    setStatus('warn', 'Не налаштовано — натисни ⚙')
    renderList()
    openSettings(shared ? 'Встав токен — і текст одразу піде на годинник.' : 'Спершу встав токен GitHub.')
    return
  }
  checkConnection().then(() => {
    loadList()
    if (shared) send(shared.raw, shared.hint)
  })
}

init().catch((e) => console.error(e))
