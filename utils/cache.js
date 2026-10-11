// Збережені на годиннику відповіді: список у index.json і тексти в t_<id>.txt.
// Так прочитане лишається доступним, коли телефона немає поруч.

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from '@zos/fs'

const INDEX = 'index.json'
const TMP = 'index.tmp'
const ID_RE = /^[a-z0-9]{6,24}$/

function emptyIndex() {
  return { v: 1, items: [], seen: {}, syncedAt: 0 }
}

function readJson(path) {
  try {
    if (!statSync({ path })) return null
    const raw = readFileSync({ path, options: { encoding: 'utf8' } })
    if (typeof raw !== 'string' || !raw.length) return null
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.items)) return data
  } catch (e) {
    console.log('cache: read failed ' + path + ' ' + e)
  }
  return null
}

function normItem(raw) {
  if (!raw || !ID_RE.test(String(raw.id || ''))) return null
  return {
    id: String(raw.id),
    src: raw.src === 'gemini' ? 'gemini' : 'claude',
    ts: Number(raw.ts) || 0,
    title: String(raw.title || ''),
    len: Number(raw.len) || 0
  }
}

export function loadIndex() {
  const raw = readJson(INDEX) || readJson(TMP)
  if (!raw) return emptyIndex()
  const idx = emptyIndex()
  raw.items.forEach((r) => {
    const item = normItem(r)
    if (item) idx.items.push(item)
  })
  idx.seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {}
  idx.syncedAt = Number(raw.syncedAt) || 0
  return idx
}

export function saveIndex(idx) {
  const data = JSON.stringify(idx)
  try {
    writeFileSync({ path: TMP, data, options: { encoding: 'utf8' } })
    if (renameSync({ oldPath: TMP, newPath: INDEX }) === 0) return true
    rmSync({ path: INDEX })
    if (renameSync({ oldPath: TMP, newPath: INDEX }) === 0) return true
  } catch (e) {
    console.log('cache: atomic save failed ' + e)
  }
  try {
    writeFileSync({ path: INDEX, data, options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    console.log('cache: save failed ' + e)
    return false
  }
}

function textPath(id) {
  return 't_' + id + '.txt'
}

export function hasText(id) {
  if (!ID_RE.test(String(id || ''))) return false
  try {
    return !!statSync({ path: textPath(id) })
  } catch (e) {
    return false
  }
}

export function readText(id) {
  if (!hasText(id)) return null
  try {
    const raw = readFileSync({ path: textPath(id), options: { encoding: 'utf8' } })
    return typeof raw === 'string' ? raw : null
  } catch (e) {
    return null
  }
}

export function writeText(id, text) {
  if (!ID_RE.test(String(id || ''))) return false
  try {
    writeFileSync({ path: textPath(id), data: String(text || ''), options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    console.log('cache: text save failed ' + e)
    return false
  }
}

function removeText(id) {
  try {
    rmSync({ path: textPath(id) })
  } catch (e) {}
}

// Замінює список новим із телефона; тексти зниклих відповідей видаляє.
export function syncItems(idx, items, at) {
  const next = []
  const keep = {}
  ;(items || []).forEach((r) => {
    const item = normItem(r)
    if (item && !keep[item.id]) {
      keep[item.id] = true
      next.push(item)
    }
  })
  next.sort((a, b) => b.ts - a.ts)
  idx.items.forEach((old) => {
    if (!keep[old.id]) removeText(old.id)
  })
  const seen = {}
  Object.keys(idx.seen || {}).forEach((id) => {
    if (keep[id]) seen[id] = 1
  })
  const changed =
    next.length !== idx.items.length ||
    next.some((it, i) => {
      const o = idx.items[i]
      return !o || o.id !== it.id || o.title !== it.title || o.src !== it.src
    })
  idx.items = next
  idx.seen = seen
  idx.syncedAt = at || Date.now()
  saveIndex(idx)
  return changed
}

export function markSeen(idx, id) {
  if (!idx.seen) idx.seen = {}
  if (idx.seen[id]) return
  idx.seen[id] = 1
  saveIndex(idx)
}
