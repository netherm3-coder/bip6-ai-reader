// Повний текст відповіді. Якщо його ще немає на годиннику — бере з телефона.

import * as hmUI from '@zos/ui'
import { back, replace } from '@zos/router'
import { getDeviceInfo } from '@zos/device'
import { setPageBrightTime } from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { loadIndex, readText, writeText, markSeen } from '../utils/cache'
import { formatStamp } from '../utils/time'
import { COLOR, SOURCE_COLOR, STATUS_BAR_H, MAX_SHOWN } from '../utils/constants'
import { statusBar, parseParams, textHeight, splitChunks, setProps } from '../utils/ui'
import { errorMessage, bleCode } from '../utils/messages'
import { SOURCE_NAMES } from '../shared/config'

const PAD_X = 22
const TITLE_SIZE = 30
const BODY_SIZE = 26
const CHUNK = 500

Page(
  BasePage({
    state: {},

    onInit(params) {
      const p = parseParams(params)
      this.id = String(p.id || '')
      this.destroyed = false
      this.idx = loadIndex()
      this.item = this.idx.items.find((i) => i.id === this.id) || null
    },

    build() {
      const { width: W } = getDeviceInfo()
      this.W = W
      statusBar(true)
      try {
        setPageBrightTime({ brightTime: 30000 })
      } catch (e) {}

      const textW = W - PAD_X * 2
      let y = STATUS_BAR_H + 6

      if (!this.item) {
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: 30,
          y: y + 40,
          w: W - 60,
          h: 80,
          text: 'Відповідь не знайдено',
          text_size: 26,
          color: COLOR.TEXT_DIM,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
          text_style: hmUI.text_style.WRAP
        })
        this.backButton(y + 150, W)
        return
      }

      const item = this.item
      hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: PAD_X,
        y: y + 9,
        w: 12,
        h: 12,
        radius: 6,
        color: SOURCE_COLOR[item.src] || COLOR.CLAUDE
      })
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: PAD_X + 20,
        y,
        w: textW - 20,
        h: 30,
        text: (SOURCE_NAMES[item.src] || 'Claude') + ' · ' + formatStamp(item.ts),
        text_size: 20,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      y += 34

      const title = item.title || 'Без назви'
      const titleH = textHeight(title, TITLE_SIZE, textW) + 6
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: PAD_X,
        y,
        w: textW,
        h: titleH,
        text: title,
        text_size: TITLE_SIZE,
        color: COLOR.TEXT,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP
      })
      y += titleH + 8
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x: PAD_X, y, w: textW, h: 2, radius: 1, color: COLOR.LINE })
      y += 14

      const text = readText(item.id)
      if (text === null) {
        this.loadingY = y
        this.loadingWidget = hmUI.createWidget(hmUI.widget.TEXT, {
          x: PAD_X,
          y,
          w: textW,
          h: 120,
          text: 'Завантаження з телефона…',
          text_size: 24,
          color: COLOR.TEXT_DIM,
          align_h: hmUI.align.LEFT,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP
        })
        this.load()
        return
      }

      markSeen(this.idx, item.id)
      // Заголовок узято з першого рядка — не повторюємо його в тексті.
      let body = text
      const firstNl = body.indexOf('\n')
      const firstLine = (firstNl < 0 ? body : body.slice(0, firstNl)).trim()
      if (title && firstLine === title) body = firstNl < 0 ? '' : body.slice(firstNl + 1).replace(/^\s*\n/, '')
      let cut = false
      if (body.length > MAX_SHOWN) {
        body = body.slice(0, MAX_SHOWN).replace(/\s+\S*$/, '')
        cut = true
      }
      const chunks = splitChunks(body, CHUNK)
      if (!chunks.length && !title) chunks.push('(порожньо)')
      chunks.forEach((chunk) => {
        const t = chunk === '' ? ' ' : chunk
        const h = textHeight(t, BODY_SIZE, textW) + 4
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: PAD_X,
          y,
          w: textW,
          h,
          text: t,
          text_size: BODY_SIZE,
          color: COLOR.TEXT_SOFT,
          align_h: hmUI.align.LEFT,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP
        })
        y += h
      })
      if (cut) {
        y += 10
        const note = '… Показано ' + MAX_SHOWN + ' з ' + text.length + ' символів. Повністю — на телефоні.'
        const h = textHeight(note, 20, textW) + 4
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: PAD_X,
          y,
          w: textW,
          h,
          text: note,
          text_size: 20,
          color: COLOR.TEXT_DIM,
          align_h: hmUI.align.LEFT,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP
        })
        y += h
      }
      y += 24
      y = this.backButton(y, W)
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + 40, w: W, h: 2, radius: 0, color: COLOR.BG })
    },

    backButton(y, W) {
      hmUI.createWidget(hmUI.widget.BUTTON, {
        x: 60,
        y,
        w: W - 120,
        h: 60,
        radius: 30,
        normal_color: COLOR.NEUTRAL,
        press_color: COLOR.NEUTRAL_PRESS,
        text: 'До списку',
        text_size: 24,
        color: COLOR.TEXT,
        click_func: () => back()
      })
      return y + 60
    },

    showLoadError(message) {
      setProps(this.loadingWidget, {
        x: PAD_X,
        y: this.loadingY,
        w: this.W - PAD_X * 2,
        h: 120,
        text: message + '\nВідкрий знову, коли телефон буде поруч.',
        color: COLOR.WARN
      })
      this.backButton(this.loadingY + 140, this.W)
    },

    load() {
      const id = this.id
      this.request({ method: 'get', params: { id } }, { timeout: 30000 })
        .then((res) => {
          if (!res || res.error || typeof res.text !== 'string') {
            if (!this.destroyed) this.showLoadError(errorMessage((res && res.error) || 'bad_data'))
            return
          }
          writeText(id, res.text)
          if (!this.destroyed) replace({ url: 'page/view', params: JSON.stringify({ id }) })
        })
        .catch((e) => {
          if (!this.destroyed) this.showLoadError(errorMessage(bleCode(e)))
        })
    },

    onDestroy() {
      this.destroyed = true
    }
  })
)
