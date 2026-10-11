// Перетворення відповіді Claude / Gemini (markdown) на чистий текст для годинника.

export const MAX_TEXT = 20000

const SYMBOLS = [
  [/[✅✔☑]/g, '+'],
  [/[❌✖✗✘❎]/g, '×'],
  [/[⚠]/g, '!'],
  [/[❗❕]/g, '!'],
  [/[❓❔]/g, '?'],
  [/[⭐★☆]/g, '*'],
  [/[➡]/g, '→'],
  [/[⬅]/g, '←']
]

const LATEX = [
  [/\\times/g, '×'],
  [/\\cdot/g, '·'],
  [/\\div/g, '÷'],
  [/\\pm/g, '±'],
  [/\\leq?/g, '≤'],
  [/\\geq?/g, '≥'],
  [/\\neq/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\infty/g, '∞'],
  [/\\to\b/g, '→'],
  [/\\rightarrow/g, '→'],
  [/\\Rightarrow/g, '⇒'],
  [/\\degree|\^\{?\\circ\}?/g, '°'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\delta/g, 'δ'],
  [/\\Delta/g, 'Δ'],
  [/\\pi/g, 'π'],
  [/\\lambda/g, 'λ'],
  [/\\mu/g, 'μ'],
  [/\\sigma/g, 'σ'],
  [/\\omega/g, 'ω'],
  [/\\Omega/g, 'Ω'],
  [/\\varphi|\\phi/g, 'φ'],
  [/\\theta/g, 'θ'],
  [/\\sum/g, 'Σ'],
  [/\\quad|\\qquad|\\,|\\;|\\!/g, ' '],
  [/\\left|\\right/g, '']
]

function latexToText(s) {
  let t = s
  for (let i = 0; i < 4; i++) {
    const before = t
    t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    t = t.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    t = t.replace(/\\(?:text|mathrm|mathbf|textbf|operatorname)\{([^{}]*)\}/g, '$1')
    if (t === before) break
  }
  LATEX.forEach(([re, to]) => {
    t = t.replace(re, to)
  })
  t = t.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '_$1')
  return t.replace(/[{}]/g, '').replace(/ {2,}/g, ' ').trim()
}

function stripEmoji(s) {
  // Емодзі перед розділовим знаком забираємо разом із пробілом перед ним: «зв'язку 📡:» → «зв'язку:».
  let t = s.replace(/[ \t]*(?:[\uD800-\uDBFF][\uDC00-\uDFFF][️‍]*)+(?=[,.:;!?)\]])/g, '')
  t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
  t = t.replace(/[︎️​-‍⁠﻿⃣]/g, '')
  SYMBOLS.forEach(([re, to]) => {
    t = t.replace(re, to)
  })
  return t
}

function inline(s) {
  let t = s
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, label, url) => (label === url ? url : label))
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/`([^`\n]+)`/g, '$1')
  t = t.replace(/\*\*([^\n]+?)\*\*/g, '$1')
  t = t.replace(/__([^\n_]+?)__/g, '$1')
  t = t.replace(/~~([^\n]+?)~~/g, '$1')
  t = t.replace(/(^|[\s(«"'])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=$|[\s).,!?:;»"'])/g, '$1$2')
  t = t.replace(/(^|[\s(«"'])_(?!\s)([^_\n]+?)(?<!\s)_(?=$|[\s).,!?:;»"'])/g, '$1$2')
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
  // Подвійні пробіли, що лишилися після вилучених емодзі.
  t = t.replace(/(\S) {2,}(?=\S)/g, '$1 ')
  return t
}

function tableRow(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells
    .map((c) => inline(c.trim()))
    .filter((c) => c !== '')
    .join(' · ')
}

export function cleanText(input) {
  let text = String(input || '').replace(/\r\n?/g, '\n')
  text = stripEmoji(text)

  // Формули: блоки $$…$$, \[…\], \(…\) та очевидні $…$.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => latexToText(f))
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, f) => latexToText(f))
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, f) => latexToText(f))
  text = text.replace(/\$([^$\n]{1,200}?)\$/g, (m, f) => (/[\\^_=]/.test(f) ? latexToText(f) : m))

  const out = []
  let inCode = false
  text.split('\n').forEach((raw) => {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode
      return
    }
    if (inCode) {
      out.push(line)
      return
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('')
      return
    }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)) return
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out.push(tableRow(line))
      return
    }
    let m = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/)
    if (m) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(inline(m[1]))
      return
    }
    m = line.match(/^(\s*)>\s?(.*)$/)
    if (m) {
      out.push('» ' + inline(m[2]))
      return
    }
    m = line.match(/^(\s*)[-*+•]\s+(\[[ xX]\]\s+)?(.*)$/)
    if (m) {
      const level = Math.min(3, Math.floor(m[1].replace(/\t/g, '    ').length / 2))
      const box = m[2] ? (/x/i.test(m[2]) ? '[x] ' : '[ ] ') : ''
      out.push('  '.repeat(level) + '• ' + box + inline(m[3]))
      return
    }
    m = line.match(/^(\s*)(\d{1,3}[.)])\s+(.*)$/)
    if (m) {
      const level = Math.min(3, Math.floor(m[1].replace(/\t/g, '    ').length / 2))
      out.push('  '.repeat(level) + m[2] + ' ' + inline(m[3]))
      return
    }
    out.push(inline(line.trim()))
  })

  let result = out
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (result.length > MAX_TEXT) result = result.slice(0, MAX_TEXT).replace(/\s+\S*$/, '') + '\n\n… (текст обрізано)'
  return result
}

export function makeTitle(text) {
  const lines = String(text || '').split('\n')
  let line = ''
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[\s•»*\-–—#\d.)\[\]x]+/i, '').trim()
    if (l.length >= 2) {
      line = l
      break
    }
  }
  if (!line) return 'Без назви'
  line = line.replace(/\s+/g, ' ')
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const sp = cut.lastIndexOf(' ')
  return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[,.;:\-–—]+$/, '') + '…'
}

export function looksLikeOnlyLink(text) {
  const t = String(text || '').trim()
  return /^https?:\/\/\S+$/.test(t)
}

export function detectSource(text) {
  const t = String(text || '')
  if (/gemini\.google\.com|g\.co\/gemini/i.test(t)) return 'gemini'
  if (/claude\.ai\//i.test(t)) return 'claude'
  return ''
}
