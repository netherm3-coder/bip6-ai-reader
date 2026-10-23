// Читання відповідей і книг із приватного репозиторію GitHub у сервісі Zepp на телефоні.
// Залежності передаються ззовні, щоб модуль можна було перевірити без Zepp.
// Книги: books/index.json — список, books/<id>.json — розділи, books/<id>.txt — текст.

const API = 'https://api.github.com/repos/'
const TIMEOUT_MS = 15000
const BOOK_TIMEOUT_MS = 90000
const ID_RE = /^[a-z0-9]{6,24}$/
// Скільки символів книги в одній частині, що йде на годинник.
export const PART = 8000

export function validRepo(repo) {
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo || ''))
}

export function codeForStatus(status, message) {
  const m = String(message || '').toLowerCase()
  if (status === 401) return 'unauthorized'
  if (status === 403 && m.indexOf('rate limit') >= 0) return 'rate_limited'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server'
  return 'http_' + status
}

function fail(code, detail) {
  const e = new Error(code)
  e.code = code
  if (detail) e.detail = detail
  return e
}

function bodyText(body) {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  try {
    return JSON.stringify(body)
  } catch (e) {
    return String(body)
  }
}

function bodyJson(body) {
  if (body && typeof body === 'object') return body
  try {
    return JSON.parse(String(body || ''))
  } catch (e) {
    return null
  }
}

function withTimeout(promise, ms, setTimer) {
  return new Promise((resolve, reject) => {
    let done = false
    setTimer(() => {
      if (done) return
      done = true
      reject(fail('timeout'))
    }, ms)
    promise.then(
      (v) => {
        if (done) return
        done = true
        resolve(v)
      },
      (e) => {
        if (done) return
        done = true
        reject(e)
      }
    )
  })
}

export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(String(raw.id || ''))) return null
  return {
    id: String(raw.id),
    src: raw.src === 'gemini' ? 'gemini' : 'claude',
    ts: Number(raw.ts) || 0,
    title: String(raw.title || '').slice(0, 120),
    len: Number(raw.len) || 0
  }
}

export function cleanBook(raw) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(String(raw.id || ''))) return null
  const chars = Math.floor(Number(raw.chars) || 0)
  if (chars <= 0) return null
  return {
    id: String(raw.id),
    title: String(raw.title || '').slice(0, 120),
    author: String(raw.author || '').slice(0, 80),
    chars,
    ts: Number(raw.ts) || 0
  }
}

function cleanOffsets(list, len, withTitle) {
  const out = []
  ;(Array.isArray(list) ? list : []).forEach((item) => {
    const o = Math.floor(Number(withTitle ? item && item[0] : item))
    if (!(o >= 0) || o >= len) return
    out.push(withTitle ? [o, String((item && item[1]) || '').slice(0, 80)] : o)
  })
  return out.slice(0, withTitle ? 1500 : 4000)
}

export function createReader(deps) {
  const doFetch = deps.fetch
  const setTimer = deps.setTimeout || setTimeout
  const getToken = () => String(deps.getToken() || '').trim()
  const getRepo = () => String(deps.getRepo() || '').trim()
  const now = deps.now || (() => Date.now())

  function request(path, raw, timeoutMs) {
    const token = getToken()
    const repo = getRepo()
    if (!token) return Promise.reject(fail('no_token'))
    if (!validRepo(repo)) return Promise.reject(fail('bad_repo'))
    const sep = path.indexOf('?') >= 0 ? '&' : '?'
    const url = API + repo + path + (raw ? sep + 't=' + now() : '')
    const call = Promise.resolve()
      .then(() =>
        doFetch({
          url,
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + token,
            Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'bip6-ai-reader'
          }
        })
      )
      .catch((e) => {
        const status = e && (e.status || e.statusCode)
        if (status) throw fail(codeForStatus(status, bodyText(e.body)))
        throw fail('network', e && e.message)
      })
      .then((res) => {
        const status = Number(res && (res.status || res.statusCode)) || 0
        if (status && (status < 200 || status >= 300)) {
          const j = bodyJson(res.body)
          throw fail(codeForStatus(status, j && j.message ? j.message : bodyText(res.body)))
        }
        return res ? res.body : ''
      })
    return withTimeout(call, timeoutMs || TIMEOUT_MS, setTimer)
  }

  // Текст книги тримаємо в пам'яті, поки годинник забирає його частинами.
  const texts = []
  function bookText(id) {
    for (let i = 0; i < texts.length; i++) if (texts[i].id === id) return Promise.resolve(texts[i].text)
    return request('/contents/books/' + id + '.txt', true, BOOK_TIMEOUT_MS).then((body) => {
      const text = bodyText(body)
      texts.unshift({ id, text })
      if (texts.length > 2) texts.pop()
      return text
    })
  }

  return {
    list() {
      return request('/contents/index.json', true).then((body) => {
        const data = bodyJson(body)
        if (!data || !Array.isArray(data.items)) throw fail('bad_data')
        const items = []
        data.items.forEach((raw) => {
          const item = cleanItem(raw)
          if (item) items.push(item)
        })
        items.sort((a, b) => b.ts - a.ts)
        return { items: items.slice(0, 60), at: now() }
      })
    },

    get(id) {
      if (!ID_RE.test(String(id || ''))) return Promise.reject(fail('bad_id'))
      return request('/contents/m/' + id + '.txt', true).then((body) => ({ id, text: bodyText(body) }))
    },

    books() {
      return request('/contents/books/index.json', true)
        .then((body) => {
          const data = bodyJson(body)
          if (!data || !Array.isArray(data.books)) throw fail('bad_data')
          const books = []
          data.books.forEach((raw) => {
            const b = cleanBook(raw)
            if (b) books.push(b)
          })
          return { books: books.slice(0, 200), p: PART, at: now() }
        })
        .catch((e) => {
          if (e && e.code === 'not_found') return { books: [], p: PART, at: now() }
          throw e
        })
    },

    bookMeta(id) {
      if (!ID_RE.test(String(id || ''))) return Promise.reject(fail('bad_id'))
      return Promise.all([request('/contents/books/' + id + '.json', true), bookText(id)]).then((r) => {
        const meta = bodyJson(r[0]) || {}
        const len = r[1].length
        return { id, chars: len, ch: cleanOffsets(meta.ch, len, true), h: cleanOffsets(meta.h, len, false) }
      })
    },

    bookPart(id, i, p) {
      if (!ID_RE.test(String(id || ''))) return Promise.reject(fail('bad_id'))
      const size = Math.max(1000, Math.min(20000, Math.floor(Number(p) || PART)))
      const n = Math.floor(Number(i))
      return bookText(id).then((text) => {
        const start = n * size
        if (!(n >= 0) || start >= text.length) throw fail('bad_id')
        return { id, i: n, text: text.slice(start, start + size) }
      })
    },

    check() {
      return request('', false).then((body) => {
        const info = bodyJson(body) || {}
        return { private: !!info.private, name: String(info.full_name || getRepo()) }
      })
    }
  }
}

export function statusText(result, error, nowTs) {
  const d = new Date(nowTs || Date.now())
  const hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
  if (error) {
    const map = {
      no_token: 'Встав токен GitHub вище.',
      bad_repo: 'Назва репозиторію має вигляд «власник/назва».',
      unauthorized: 'Токен недійсний або прострочений.',
      forbidden: 'Токен не має доступу до репозиторію.',
      not_found: 'Репозиторій не знайдено, або токен не має до нього доступу.',
      rate_limited: 'GitHub тимчасово обмежив запити.',
      network: 'Немає інтернету.',
      timeout: 'GitHub не відповів вчасно.',
      server: 'Помилка на боці GitHub.'
    }
    return '✗ ' + (map[error] || 'Помилка: ' + error) + ' (' + hm + ')'
  }
  if (result && !result.private) return '⚠ Підключено, але репозиторій публічний — зроби його приватним. (' + hm + ')'
  return '✓ Підключено до ' + (result ? result.name : '') + ' (' + hm + ')'
}
