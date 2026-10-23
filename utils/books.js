// Книги на годиннику:
//   books.json        — список книг і скільки частин тексту вже скачано;
//   bk_<id>.json      — розділи й заголовки;
//   bk_<id>_<n>.txt   — n-та частина тексту (p символів);
//   bpos.json         — де зупинився в кожній книзі;
//   bcfg.json         — шрифт, жест руки, остання книга.
// Усе читається з пам'яті годинника, телефон для цього не потрібен.

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from '@zos/fs'

const LIB = 'books.json'
const POS = 'bpos.json'
const CFG = 'bcfg.json'
const ID_RE = /^[a-z0-9]{6,24}$/
export const DEFAULT_PART = 8000

function readJson(path) {
  try {
    if (!statSync({ path })) return null
    const raw = readFileSync({ path, options: { encoding: 'utf8' } })
    if (typeof raw !== 'string' || !raw.length) return null
    return JSON.parse(raw)
  } catch (e) {
    console.log('books: read failed ' + path + ' ' + e)
    return null
  }
}

function writeJson(path, data) {
  const text = JSON.stringify(data)
  const tmp = path + '.tmp'
  try {
    writeFileSync({ path: tmp, data: text, options: { encoding: 'utf8' } })
    if (renameSync({ oldPath: tmp, newPath: path }) === 0) return true
    rmSync({ path })
    if (renameSync({ oldPath: tmp, newPath: path }) === 0) return true
  } catch (e) {
    console.log('books: atomic save failed ' + path + ' ' + e)
  }
  try {
    writeFileSync({ path, data: text, options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    console.log('books: save failed ' + path + ' ' + e)
    return false
  }
}

function readAny(path) {
  return readJson(path) || readJson(path + '.tmp')
}

export function validId(id) {
  return ID_RE.test(String(id || ''))
}

export function normBook(raw) {
  if (!raw || !validId(raw.id)) return null
  const chars = Math.max(0, Math.floor(Number(raw.chars) || 0))
  const p = Math.max(500, Math.floor(Number(raw.p) || DEFAULT_PART))
  const parts = Math.max(1, Math.ceil(chars / p))
  return {
    id: String(raw.id),
    title: String(raw.title || '').slice(0, 120) || 'Без назви',
    author: String(raw.author || '').slice(0, 80),
    chars,
    p,
    parts,
    have: Math.max(0, Math.min(parts, Math.floor(Number(raw.have) || 0))),
    meta: !!raw.meta,
    hidden: !!raw.hidden,
    gone: !!raw.gone,
    ts: Number(raw.ts) || 0
  }
}

export function loadLib() {
  const raw = readAny(LIB)
  const lib = { v: 1, books: [] }
  if (raw && Array.isArray(raw.books)) {
    const seen = {}
    raw.books.forEach((r) => {
      const b = normBook(r)
      if (b && !seen[b.id]) {
        seen[b.id] = 1
        lib.books.push(b)
      }
    })
  }
  return lib
}

export function saveLib(lib) {
  return writeJson(LIB, { v: 1, books: lib.books })
}

export function findBook(lib, id) {
  return lib.books.find((b) => b.id === id) || null
}

// Скільки символів книги вже на годиннику.
export function available(b) {
  return b ? Math.min(b.chars, b.have * b.p) : 0
}

export function complete(b) {
  return !!b && b.meta && b.have >= b.parts
}

export function readable(b) {
  return !!b && !b.hidden && b.have > 0
}

export function partPath(id, i) {
  return 'bk_' + id + '_' + i + '.txt'
}

function metaPath(id) {
  return 'bk_' + id + '.json'
}

export function readPart(id, i) {
  if (!validId(id)) return null
  try {
    const path = partPath(id, i)
    if (!statSync({ path })) return null
    const raw = readFileSync({ path, options: { encoding: 'utf8' } })
    return typeof raw === 'string' ? raw : null
  } catch (e) {
    return null
  }
}

export function writePart(id, i, text) {
  if (!validId(id)) return false
  try {
    writeFileSync({ path: partPath(id, i), data: String(text), options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    console.log('books: part save failed ' + e)
    return false
  }
}

export function readMeta(id) {
  const raw = validId(id) ? readJson(metaPath(id)) : null
  const ch = []
  if (raw && Array.isArray(raw.ch)) {
    raw.ch.forEach((c) => {
      if (Array.isArray(c) && c.length >= 2 && Number(c[0]) >= 0) ch.push([Math.floor(Number(c[0])), String(c[1] || '').slice(0, 80)])
    })
    ch.sort((a, b) => a[0] - b[0])
  }
  const h = raw && Array.isArray(raw.h) ? raw.h.map((o) => Math.floor(Number(o))).filter((o) => o >= 0) : []
  return { ch, h }
}

export function writeMeta(id, meta) {
  if (!validId(id)) return false
  return writeJson(metaPath(id), { ch: meta.ch || [], h: meta.h || [] })
}

// Видаляє текст книги з годинника. Якщо книга ще є на телефоні — ховає її,
// щоб не скачувалася знову сама.
export function deleteBook(lib, id) {
  const b = findBook(lib, id)
  if (!b) return false
  for (let i = 0; i < b.parts; i++) {
    try {
      rmSync({ path: partPath(id, i) })
    } catch (e) {}
  }
  try {
    rmSync({ path: metaPath(id) })
  } catch (e) {}
  if (b.gone) lib.books = lib.books.filter((x) => x.id !== id)
  else {
    b.hidden = true
    b.have = 0
    b.meta = false
  }
  saveLib(lib)
  const pos = loadPos()
  if (pos[id]) {
    delete pos[id]
    savePos(pos)
  }
  const cfg = loadCfg()
  if (cfg.last === id) {
    cfg.last = ''
    saveCfg(cfg)
  }
  return true
}

// Повернути приховану книгу: скачається знову.
export function restoreBook(lib, id) {
  const b = findBook(lib, id)
  if (!b || !b.hidden) return false
  b.hidden = false
  b.have = 0
  b.meta = false
  saveLib(lib)
  return true
}

// Список із телефона → список на годиннику. Повертає true, якщо щось змінилося.
export function mergeRemote(lib, remote, p) {
  let changed = false
  const seen = {}
  ;(remote || []).forEach((r) => {
    if (!r || !validId(r.id) || seen[r.id]) return
    seen[r.id] = 1
    const b = findBook(lib, r.id)
    if (b) {
      const title = String(r.title || '').slice(0, 120) || b.title
      const author = String(r.author || '').slice(0, 80)
      if (b.title !== title || b.author !== author || b.gone) {
        b.title = title
        b.author = author
        b.gone = false
        changed = true
      }
      return
    }
    const nb = normBook({ id: r.id, title: r.title, author: r.author, chars: r.chars, p: p || DEFAULT_PART, ts: r.ts })
    if (nb && nb.chars > 0) {
      lib.books.push(nb)
      changed = true
    }
  })
  lib.books.forEach((b) => {
    if (!seen[b.id] && !b.gone) {
      b.gone = true
      changed = true
    }
  })
  const before = lib.books.length
  // Зникла з телефона й нічого не скачано (або видалена з годинника) — прибрати.
  lib.books = lib.books.filter((b) => !(b.gone && (b.have === 0 || b.hidden)))
  if (lib.books.length !== before) changed = true
  lib.books.sort((a, b) => b.ts - a.ts)
  return changed
}

export function loadPos() {
  const raw = readAny(POS)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

export function savePos(pos) {
  return writeJson(POS, pos)
}

export function getPos(pos, id) {
  const p = pos[id]
  return p && Number(p.o) >= 0 ? Math.floor(Number(p.o)) : 0
}

export function setPos(id, offset) {
  const pos = loadPos()
  pos[id] = { o: Math.max(0, Math.floor(offset)), t: Date.now() }
  savePos(pos)
  return pos
}

export const FONT_SIZES = [24, 28, 32]

// section — де був востаннє: 'books' (книги) чи 'ai' (відповіді). Без телефона
// програма відкривається одразу на книзі, лише якщо востаннє читав книгу.
export function loadCfg() {
  const raw = readAny(CFG) || {}
  const size = Math.floor(Number(raw.size))
  return {
    size: size >= 0 && size < FONT_SIZES.length ? size : 1,
    wrist: raw.wrist ? 1 : 0,
    last: validId(raw.last) ? String(raw.last) : '',
    section: raw.section === 'books' ? 'books' : 'ai'
  }
}

export function saveCfg(cfg) {
  return writeJson(CFG, { size: cfg.size, wrist: cfg.wrist ? 1 : 0, last: cfg.last || '', section: cfg.section === 'books' ? 'books' : 'ai' })
}

export function setSection(section) {
  const cfg = loadCfg()
  const s = section === 'books' ? 'books' : 'ai'
  if (cfg.section === s) return
  cfg.section = s
  saveCfg(cfg)
}

export function percent(b, offset) {
  if (!b || !b.chars) return 0
  return Math.max(0, Math.min(100, Math.floor((offset / b.chars) * 100)))
}

// Остання книга, яку можна читати (для «Продовжити» і запуску без телефона).
export function lastReadable() {
  const cfg = loadCfg()
  if (!cfg.last) return null
  const b = findBook(loadLib(), cfg.last)
  return readable(b) ? b : null
}

// Ширини символів шрифту годинника для кегля (щоб не міряти щоразу).
export function loadWidths(size) {
  const raw = readJson('bw' + size + '.json')
  return raw && raw.w && typeof raw.w === 'object' ? raw : null
}

export function saveWidths(size, data) {
  return writeJson('bw' + size + '.json', data)
}
