// Робота з приватним репозиторієм-«поштовою скринькою» через GitHub REST API.
// index.json — список відповідей (найновіші зверху), m/<id>.txt — тексти.
// books/index.json — список книг, books/<id>.txt — текст, books/<id>.json — розділи;
// книга додається й видаляється одним комітом (Git Data API).

export const MAX_ITEMS = 50
const API = 'https://api.github.com/repos/'

export class GhError extends Error {
  constructor(code, status, message) {
    super(message || code)
    this.code = code
    this.status = status || 0
  }
}

export function encodeUtf8Base64(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function decodeUtf8Base64(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function validRepo(repo) {
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo || ''))
}

export function newId(now) {
  const t = (now || Date.now()).toString(36)
  let r = ''
  for (let i = 0; i < 4; i++) r += Math.floor(Math.random() * 36).toString(36)
  return t + r
}

function codeFor(status, message) {
  const m = String(message || '').toLowerCase()
  if (status === 401) return 'unauthorized'
  if (status === 403 && m.includes('rate limit')) return 'rate_limited'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422) return 'unprocessable'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server'
  return 'http_' + status
}

export function createClient({ token, repo, fetchImpl }) {
  const doFetch = fetchImpl || ((url, opts) => fetch(url, opts))
  const base = API + repo

  async function api(method, path, body) {
    let res
    try {
      res = await doFetch(base + path, {
        method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
          body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      })
    } catch (e) {
      throw new GhError('network', 0, String((e && e.message) || e))
    }
    let data = null
    const raw = await res.text()
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch (e) {
        data = { message: raw }
      }
    }
    if (!res.ok) throw new GhError(codeFor(res.status, data && data.message), res.status, data && data.message)
    return data
  }

  async function readIndex() {
    try {
      const data = await api('GET', '/contents/index.json')
      let parsed = null
      try {
        parsed = JSON.parse(decodeUtf8Base64(data.content))
      } catch (e) {
        parsed = null
      }
      const items = parsed && Array.isArray(parsed.items) ? parsed.items.filter((i) => i && i.id) : []
      return { items, sha: data.sha }
    } catch (e) {
      if (e.code === 'not_found') return { items: [], sha: null }
      throw e
    }
  }

  async function writeIndex(items, sha, message) {
    const body = {
      message,
      content: encodeUtf8Base64(JSON.stringify({ v: 1, items }) + '\n')
    }
    if (sha) body.sha = sha
    return api('PUT', '/contents/index.json', body)
  }

  // Читає index, застосовує зміну й записує; при конфлікті повторює.
  async function updateIndex(mutate, message) {
    let lastErr = null
    for (let attempt = 0; attempt < 4; attempt++) {
      const { items, sha } = await readIndex()
      const next = mutate(items.slice())
      try {
        await writeIndex(next, sha, message)
        return next
      } catch (e) {
        lastErr = e
        if (e.code !== 'conflict' && e.code !== 'unprocessable') throw e
      }
    }
    throw lastErr || new GhError('conflict', 409)
  }

  async function deleteFile(path, sha) {
    let fileSha = sha
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!fileSha) {
          const meta = await api('GET', '/contents/' + path)
          fileSha = meta.sha
        }
        await api('DELETE', '/contents/' + path, { message: 'delete ' + path, sha: fileSha })
        return true
      } catch (e) {
        if (e.code === 'not_found') return true
        if (e.code === 'conflict' || e.code === 'unprocessable') {
          fileSha = null
          continue
        }
        throw e
      }
    }
    return false
  }

  // ---------- книги ----------

  let branch = null
  async function defaultBranch() {
    if (branch) return branch
    const info = await api('GET', '')
    branch = info.default_branch || 'main'
    return branch
  }

  async function headSha(br) {
    try {
      const ref = await api('GET', '/git/ref/heads/' + encodeURIComponent(br))
      return ref && ref.object ? ref.object.sha : null
    } catch (e) {
      if (e.status === 409 || e.code === 'not_found') return null // порожній репозиторій
      throw e
    }
  }

  async function booksAt(ref) {
    try {
      const data = await api('GET', '/contents/books/index.json' + (ref ? '?ref=' + ref : ''))
      const parsed = JSON.parse(decodeUtf8Base64(data.content))
      return parsed && Array.isArray(parsed.books) ? parsed.books.filter((b) => b && b.id) : []
    } catch (e) {
      if (e.code === 'not_found') return []
      throw e
    }
  }

  async function blob(text) {
    const res = await api('POST', '/git/blobs', { content: encodeUtf8Base64(text), encoding: 'base64' })
    return res.sha
  }

  // Один коміт: змінити файли (content: рядок) і видалити (content: null).
  // listFn(books) → новий список книг, який записується в books/index.json.
  async function commitBooks(files, listFn, message) {
    const br = await defaultBranch()
    const blobs = {}
    for (const f of files) if (f.content !== null) blobs[f.path] = await blob(f.content)
    let lastErr = null
    for (let attempt = 0; attempt < 4; attempt++) {
      let head = await headSha(br)
      if (!head) {
        // Порожній репозиторій: перший коміт — через Contents API.
        await api('PUT', '/contents/books/index.json', {
          message: 'books: init',
          content: encodeUtf8Base64(JSON.stringify({ v: 1, books: [] }) + '\n')
        })
        head = await headSha(br)
      }
      const commit = await api('GET', '/git/commits/' + head)
      const books = listFn(await booksAt(head))
      const indexSha = await blob(JSON.stringify({ v: 1, books }) + '\n')
      const tree = files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.content === null ? null : blobs[f.path] }))
      tree.push({ path: 'books/index.json', mode: '100644', type: 'blob', sha: indexSha })
      const t = await api('POST', '/git/trees', { base_tree: commit.tree.sha, tree })
      const c = await api('POST', '/git/commits', { message, tree: t.sha, parents: [head] })
      try {
        await api('PATCH', '/git/refs/heads/' + encodeURIComponent(br), { sha: c.sha, force: false })
        return books
      } catch (e) {
        lastErr = e
        if (e.code !== 'unprocessable' && e.code !== 'conflict') throw e
      }
    }
    throw lastErr || new GhError('conflict', 409)
  }

  return {
    async checkRepo() {
      const info = await api('GET', '')
      branch = info.default_branch || branch
      return { private: !!info.private, name: info.full_name || repo }
    },

    readBooks() {
      return booksAt(null)
    },

    // book: { title, author, text, ch, h, fmt }
    async addBook(book, now) {
      const ts = now || Date.now()
      const id = newId(ts)
      const entry = {
        id,
        title: book.title,
        author: book.author || '',
        chars: book.text.length,
        size: new TextEncoder().encode(book.text).length,
        ts,
        fmt: book.fmt || ''
      }
      const meta = { v: 1, id, title: entry.title, author: entry.author, chars: entry.chars, ch: book.ch || [], h: book.h || [] }
      const books = await commitBooks(
        [
          { path: 'books/' + id + '.txt', content: book.text },
          { path: 'books/' + id + '.json', content: JSON.stringify(meta) }
        ],
        (list) => [entry].concat(list.filter((b) => b.id !== id)),
        'book: ' + entry.title.slice(0, 60)
      )
      return { entry, books }
    },

    async removeBook(id) {
      const list = await booksAt(null)
      const target = list.find((b) => b.id === id)
      if (!target) return list
      return commitBooks(
        [
          { path: 'books/' + id + '.txt', content: null },
          { path: 'books/' + id + '.json', content: null }
        ],
        (books) => books.filter((b) => b.id !== id),
        'book: delete ' + id
      )
    },

    readIndex,

    async add({ text, src, title, now }) {
      const ts = now || Date.now()
      const id = newId(ts)
      const put = await api('PUT', '/contents/m/' + id + '.txt', {
        message: 'add ' + id,
        content: encodeUtf8Base64(text)
      })
      const entry = { id, src, ts, title, len: text.length, sha: put && put.content ? put.content.sha : '' }
      let removed = []
      const items = await updateIndex((list) => {
        const next = [entry].concat(list.filter((i) => i.id !== id))
        removed = next.slice(MAX_ITEMS)
        return next.slice(0, MAX_ITEMS)
      }, 'index: add ' + id)
      for (const old of removed) {
        try {
          await deleteFile('m/' + old.id + '.txt', old.sha)
        } catch (e) {}
      }
      return { entry, items }
    },

    async remove(id) {
      let target = null
      const items = await updateIndex((list) => {
        target = list.find((i) => i.id === id) || target
        return list.filter((i) => i.id !== id)
      }, 'index: delete ' + id)
      await deleteFile('m/' + id + '.txt', target && target.sha)
      return items
    },

    async setSource(id, src) {
      return updateIndex(
        (list) => list.map((i) => (i.id === id ? Object.assign({}, i, { src }) : i)),
        'index: ' + id + ' → ' + src
      )
    }
  }
}
