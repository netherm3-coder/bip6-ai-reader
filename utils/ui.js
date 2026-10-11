import * as hmUI from '@zos/ui'

export function statusBar(visible) {
  try {
    if (typeof hmUI.setStatusBarVisible === 'function') hmUI.setStatusBarVisible(visible)
  } catch (e) {}
}

export function parseParams(params) {
  if (!params) return {}
  if (typeof params === 'object') return params
  try {
    return JSON.parse(params) || {}
  } catch (e) {
    return {}
  }
}

export function setProps(widget, props) {
  if (!widget) return
  try {
    widget.setProperty(hmUI.prop.MORE, props)
  } catch (e) {}
}

export function removeWidget(widget) {
  if (!widget) return
  try {
    hmUI.deleteWidget(widget)
  } catch (e) {
    try {
      widget.setProperty(hmUI.prop.VISIBLE, false)
    } catch (e2) {}
  }
}

// Оцінка, якщо getTextLayout недоступний: середня ширина символу ~0.55 кегля.
function estimate(text, size, width) {
  const perRow = Math.max(1, Math.floor(width / (size * 0.55)))
  let rows = 0
  String(text).split('\n').forEach((line) => {
    rows += Math.max(1, Math.ceil(line.length / perRow))
  })
  return { rows, height: Math.ceil(rows * size * 1.3) }
}

export function measure(text, size, width) {
  try {
    const r = hmUI.getTextLayout(text, { text_size: size, text_width: width, wrapped: 1 })
    if (r && r.height > 0) return { rows: r.rows || 0, height: r.height }
  } catch (e) {}
  return estimate(text, size, width)
}

export function textHeight(text, size, width) {
  return measure(text || ' ', size, width).height
}

// Довгий текст ділиться на шматки до maxLen символів (цілими рядками, де можна),
// щоб жоден віджет TEXT не був надто високим, а віджетів не було забагато.
export function splitChunks(text, maxLen) {
  const lines = []
  let blank = 0
  String(text)
    .split('\n')
    .forEach((line) => {
      if (line.trim() === '') {
        blank += 1
        if (blank <= 1) lines.push('')
        return
      }
      blank = 0
      let rest = line
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(' ', maxLen)
        if (cut < maxLen * 0.6) cut = maxLen
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut).replace(/^ /, '')
      }
      lines.push(rest)
    })
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()

  // Порожній рядок між абзацами зберігається: на межі шматків він стає
  // першим (порожнім) рядком наступного шматка.
  const chunks = []
  let cur = ''
  let pendingBlank = false
  lines.forEach((line) => {
    if (line === '') {
      pendingBlank = cur !== ''
      return
    }
    const piece = (pendingBlank ? '\n' : '') + line
    if (cur && cur.length + 1 + piece.length > maxLen) {
      chunks.push(cur)
      cur = piece
    } else {
      cur = cur ? cur + '\n' + piece : piece
    }
    pendingBlank = false
  })
  if (cur) chunks.push(cur)
  return chunks
}
