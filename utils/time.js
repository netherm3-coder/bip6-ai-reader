// Форматування дат. Зсув часового поясу береться з сенсора часу годинника,
// тож не залежить від того, як рушій JS обробляє часові пояси.

import { Time } from '@zos/sensor'

const DAY = 86400000
let offsetMs = null

function localOffset() {
  if (offsetMs !== null) return offsetMs
  offsetMs = 0
  try {
    const t = new Time()
    const local = Date.UTC(t.getFullYear(), t.getMonth() - 1, t.getDate(), t.getHours(), t.getMinutes(), 0)
    const quarter = 15 * 60 * 1000
    offsetMs = Math.round((local - Date.now()) / quarter) * quarter
  } catch (e) {
    try {
      offsetMs = -new Date().getTimezoneOffset() * 60000
    } catch (e2) {
      offsetMs = 0
    }
  }
  return offsetMs
}

function pad(n) {
  return (n < 10 ? '0' : '') + n
}

export function formatStamp(ts) {
  if (!ts) return ''
  const off = localOffset()
  const d = new Date(ts + off)
  const nowLocal = Date.now() + off
  const diffDays = Math.floor(nowLocal / DAY) - Math.floor((ts + off) / DAY)
  const hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
  if (diffDays === 0) return 'сьогодні ' + hm
  if (diffDays === 1) return 'вчора ' + hm
  const date = pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1)
  const sameYear = new Date(nowLocal).getUTCFullYear() === d.getUTCFullYear()
  return sameYear ? date + ' ' + hm : date + '.' + d.getUTCFullYear()
}
