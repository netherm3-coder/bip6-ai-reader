// Завантаження книг із телефона, поки програма відкрита (на будь-якій сторінці).
// Стан спільний для сторінок (globalData); крутить завантаження лише одна —
// та, що відкрилася останньою. Усе скачане одразу пишеться у файли, тож
// перерване завантаження продовжується з того самого місця.

import { connectStatus } from '@zos/ble'
import { getDiskInfo } from '@zos/device'
import { loadLib, saveLib, mergeRemote, findBook, writePart, writeMeta, loadCfg, DEFAULT_PART } from './books'
import { bleCode } from './messages'

const LIST_EVERY = 10 * 60 * 1000
const RETRY_MS = 4000
const OFFLINE_MS = 30000
const RESERVE = 1024 * 1024

function shared() {
  let g = null
  try {
    const app = getApp()
    g = (app && app._options && app._options.globalData) || null
  } catch (e) {
    g = null
  }
  if (!g) g = shared.fallback || (shared.fallback = {})
  if (!g.bsync) g.bsync = { owner: null, phase: 'idle', id: '', title: '', have: 0, parts: 0, error: '', listedAt: 0, fails: 0, rev: 0 }
  return g.bsync
}

export function syncInfo() {
  return shared()
}

export function phoneConnected() {
  try {
    return connectStatus() !== false
  } catch (e) {
    return true
  }
}

// Після змін у списку з іншої сторінки (видалення, повернення книги).
export function relist() {
  shared().listedAt = 0
}

// opts.listEvery — як часто перевіряти список книг на телефоні (бібліотека — щохвилини).
export function startSync(page, onChange, opts) {
  const st = shared()
  stopSync(page)
  const me = { page, onChange, alive: true, timer: null, listEvery: (opts && opts.listEvery) || LIST_EVERY }
  st.owner = me
  page._bsync = me
  schedule(me, 30)
  return me
}

export function stopSync(page) {
  const me = page && page._bsync
  if (!me) return
  me.alive = false
  if (me.timer) clearTimeout(me.timer)
  me.timer = null
  const st = shared()
  if (st.owner === me) st.owner = null
  page._bsync = null
}

function alive(me) {
  return me.alive && shared().owner === me
}

function schedule(me, ms) {
  if (me.timer) clearTimeout(me.timer)
  me.timer = setTimeout(() => {
    me.timer = null
    step(me)
  }, ms)
}

function emit(me, libChanged) {
  const st = shared()
  if (libChanged) st.rev = (st.rev || 0) + 1
  try {
    if (me.onChange) me.onChange(st, !!libChanged)
  } catch (e) {
    console.log('booksync: onChange ' + e)
  }
}

function setPhase(me, phase, extra, libChanged) {
  const st = shared()
  st.phase = phase
  if (extra) Object.keys(extra).forEach((k) => (st[k] = extra[k]))
  emit(me, libChanged)
}

function request(me, data, timeout) {
  return me.page.request(data, { timeout })
}

function fail(me, code) {
  if (!alive(me)) return
  const st = shared()
  st.fails = (st.fails || 0) + 1
  if (code && code !== 'ble' && code !== 'phone_timeout') {
    setPhase(me, 'error', { error: code })
    schedule(me, 60000)
    return
  }
  if (st.fails >= 3) {
    setPhase(me, 'offline')
    schedule(me, OFFLINE_MS)
    return
  }
  schedule(me, RETRY_MS)
}

// Що качати: книгу, яку читаєш (якщо недокачана), інакше найновішу.
function nextBook(lib) {
  const todo = lib.books.filter((b) => !b.hidden && !b.gone && (b.have < b.parts || !b.meta))
  if (!todo.length) return null
  const last = loadCfg().last
  return todo.find((b) => b.id === last && b.have > 0) || todo[0]
}

function enoughSpace(b) {
  try {
    const info = getDiskInfo()
    if (!info || !(info.free > 0)) return true
    return info.free > (b.parts - b.have) * b.p * 2.2 + RESERVE
  } catch (e) {
    return true
  }
}

function step(me) {
  if (!alive(me)) return
  const st = shared()
  if (!phoneConnected()) {
    setPhase(me, 'offline')
    schedule(me, OFFLINE_MS)
    return
  }
  if (!st.listedAt || Date.now() - st.listedAt > me.listEvery) {
    setPhase(me, 'checking')
    request(me, { method: 'books' }, 25000)
      .then((res) => {
        if (!alive(me)) return
        if (!res || res.error || !Array.isArray(res.books)) {
          fail(me, (res && res.error) || 'bad_data')
          return
        }
        const lib = loadLib()
        const changed = mergeRemote(lib, res.books, Number(res.p) || DEFAULT_PART)
        if (changed) saveLib(lib)
        st.listedAt = Date.now()
        st.fails = 0
        st.error = ''
        emit(me, changed)
        schedule(me, 0)
      })
      .catch((e) => fail(me, bleCode(e)))
    return
  }

  const lib = loadLib()
  const b = nextBook(lib)
  if (!b) {
    setPhase(me, 'idle', { id: '', title: '' })
    schedule(me, me.listEvery)
    return
  }
  if (!enoughSpace(b)) {
    setPhase(me, 'nospace', { id: b.id, title: b.title })
    schedule(me, 60000)
    return
  }
  setPhase(me, 'loading', { id: b.id, title: b.title, have: b.have, parts: b.parts })

  if (!b.meta) {
    request(me, { method: 'bmeta', params: { id: b.id } }, 60000)
      .then((res) => {
        if (!alive(me)) return
        if (!res || res.error) {
          fail(me, (res && res.error) || 'book_data')
          return
        }
        const fresh = loadLib()
        const fb = findBook(fresh, b.id)
        if (!fb || fb.hidden) {
          schedule(me, 0)
          return
        }
        writeMeta(b.id, { ch: res.ch || [], h: res.h || [] })
        const chars = Math.floor(Number(res.chars) || 0)
        if (chars > 0 && chars !== fb.chars) {
          fb.chars = chars
          fb.parts = Math.max(1, Math.ceil(chars / fb.p))
          fb.have = Math.min(fb.have, fb.parts)
        }
        fb.meta = true
        saveLib(fresh)
        st.fails = 0
        emit(me, true)
        schedule(me, 0)
      })
      .catch((e) => fail(me, bleCode(e)))
    return
  }

  const i = b.have
  request(me, { method: 'bpart', params: { id: b.id, i, p: b.p } }, 90000)
    .then((res) => {
      if (!alive(me)) return
      if (!res || res.error || typeof res.text !== 'string') {
        fail(me, (res && res.error) || 'book_data')
        return
      }
      const fresh = loadLib()
      const fb = findBook(fresh, b.id)
      if (!fb || fb.hidden || fb.have !== i) {
        schedule(me, 0)
        return
      }
      const expected = i < fb.parts - 1 ? fb.p : fb.chars - i * fb.p
      if (res.text.length !== expected) {
        // Текст на телефоні змінився — почати книгу наново.
        fb.have = 0
        fb.meta = false
        saveLib(fresh)
        fail(me, 'book_data')
        return
      }
      if (!writePart(b.id, i, res.text)) {
        setPhase(me, 'nospace', { id: b.id, title: b.title })
        schedule(me, 60000)
        return
      }
      fb.have = i + 1
      saveLib(fresh)
      st.fails = 0
      setPhase(me, 'loading', { id: fb.id, title: fb.title, have: fb.have, parts: fb.parts }, true)
      schedule(me, 0)
    })
    .catch((e) => fail(me, bleCode(e)))
}
