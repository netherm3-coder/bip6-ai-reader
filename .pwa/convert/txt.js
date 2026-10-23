// TXT → абзаци. Вгадує, як у файлі позначено абзаци: порожнім рядком, відступом
// чи кожен рядок — абзац; рядки, розірвані по ширині, склеює.

import { assemble, decodeText, joinLines } from './text.js'

const ORD = '(перш|друг|трет|четверт|п.ят|шост|сьом|восьм|дев.ят|десят|одинадцят|дванадцят|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\\S*'
const HEADING_RE = new RegExp(
  '^((розділ|глава|частина|книга|chapter|part)\\s+([0-9]{1,3}|[IVXLC]{1,7}|' + ORD + ')[.:]?(\\s+.{0,60})?' +
    '|(пролог|епілог|передмова|післямова|вступ|prologue|epilogue|introduction)[.:]?(\\s+.{0,60})?)$',
  'i'
)
const ROMAN_RE = /^[IVXLC]{1,7}\.?$/
const NUM_RE = /^\d{1,3}\.?$/

function isHeading(line) {
  const t = line.trim()
  if (!t || t.length > 80) return false
  if (HEADING_RE.test(t)) return true
  if (ROMAN_RE.test(t) || NUM_RE.test(t)) return true
  const letters = t.replace(/[^A-Za-zА-Яа-яЁёЇїІіЄєҐґ]/g, '')
  return letters.length >= 4 && t.length <= 60 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

function percentile(values, p) {
  if (!values.length) return 0
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

export function paragraphsFromLines(lines) {
  const nonBlank = lines.filter((l) => l.trim())
  if (!nonBlank.length) return []
  const blank = lines.length - nonBlank.length
  const INDENT = /^(\s{2,}|\t)\S/
  const indented = nonBlank.filter((l) => INDENT.test(l)).length
  const lens = nonBlank.map((l) => l.trim().length)
  const l90 = percentile(lens, 0.9)
  const full = lens.filter((n) => n >= l90 * 0.75).length
  // Чи бувають підряд кілька непорожніх рядків (тобто абзац розірвано по ширині)?
  let runs = 0
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() && lines[i - 1].trim()) runs++

  const blankSep = blank >= nonBlank.length * 0.15 && runs >= nonBlank.length * 0.2
  const indentSig = indented >= 2 && indented >= nonBlank.length * 0.05 && indented <= nonBlank.length * 0.9
  const wrapped = l90 >= 45 && l90 <= 130 && full >= nonBlank.length * 0.5
  if (!blankSep && !indentSig && !wrapped) return nonBlank.map((l) => l.trim()) // кожен рядок — абзац

  const paras = []
  let cur = []
  let prevShort = false
  const push = () => {
    if (cur.length) paras.push(joinLines(cur))
    cur = []
  }
  lines.forEach((l) => {
    const t = l.trim()
    if (!t) {
      push()
      prevShort = false
      return
    }
    if (isHeading(t) && (!cur.length || prevShort || !blankSep)) {
      push()
      paras.push(t)
      prevShort = true
      return
    }
    if ((indentSig && INDENT.test(l)) || (!blankSep && wrapped && prevShort)) push()
    cur.push(t)
    prevShort = t.length < l90 * 0.75
  })
  push()
  return paras
}

export function convertTxt(bytes) {
  const src = decodeText(bytes).replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  const paras = paragraphsFromLines(lines)
  const blocks = paras.map((p) => (isHeading(p) ? { k: 'h', s: p, lvl: 1 } : { k: 'p', s: p }))
  const book = assemble(blocks, { headingChapters: true, maxLevel: 1 })
  // Назву бере з імені файлу (її можна виправити перед надсиланням).
  return { title: '', author: '', text: book.text, ch: book.ch, h: book.h }
}
