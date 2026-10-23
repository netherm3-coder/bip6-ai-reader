// Список відповідей: спершу збережені на годиннику, потім оновлення з телефона.
// Угорі — «Книги» і «Продовжити» (остання книга). Якщо телефона немає поруч,
// а книга читалася, програма одразу відкривається на ній.

import * as hmUI from '@zos/ui'
import { push } from '@zos/router'
import { getScrollTop } from '@zos/page'
import { getDeviceInfo } from '@zos/device'
import { BasePage } from '@zeppos/zml/base-page'
import { loadIndex, syncItems, hasText, writeText } from '../utils/cache'
import { formatStamp } from '../utils/time'
import { COLOR, SOURCE_COLOR, STATUS_BAR_H, PREFETCH } from '../utils/constants'
import { statusBar, setProps, removeWidget, globalData, tappable, markStarted } from '../utils/ui'
import { holdScreen, refreshScreen, releaseScreen, wakeRelaunch } from '../utils/screen'
import { lastReadable, loadPos, getPos, percent, complete, available } from '../utils/books'
import { startSync, stopSync, syncInfo, phoneConnected } from '../utils/booksync'
import { errorMessage, bleCode } from '../utils/messages'
import { SOURCE_NAMES } from '../shared/config'

const ROW_H = 92
const ROW_GAP = 10

function scrollTop() {
  try {
    return getScrollTop() || 0
  } catch (e) {
    return 0
  }
}

Page(
  BasePage({
    state: {},

    onInit() {
      this.destroyed = false
      this.loading = false
      this.navigating = false
      this.rowWidgets = []
      this.bookWidgets = []
      this.press = null
      this.idx = loadIndex()
      markStarted()
    },

    build() {
      const { width: W } = getDeviceInfo()
      this.W = W
      statusBar(true)
      holdScreen()

      wakeRelaunch(false)

      let y = STATUS_BAR_H + 6
      const half = Math.floor((W - 48 - 10) / 2)
      hmUI.createWidget(hmUI.widget.BUTTON, {
        x: 24,
        y,
        w: half,
        h: 58,
        radius: 29,
        normal_color: COLOR.NEUTRAL,
        press_color: COLOR.NEUTRAL_PRESS,
        text: 'Оновити',
        text_size: 26,
        color: COLOR.TEXT,
        click_func: () => this.refresh()
      })
      this.booksBtnX = 24 + half + 10
      this.booksBtnY = y
      this.booksBtnW = half
      this.booksBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
        x: this.booksBtnX,
        y,
        w: half,
        h: 58,
        radius: 29,
        normal_color: COLOR.NEUTRAL,
        press_color: COLOR.NEUTRAL_PRESS,
        text: 'Книги',
        text_size: 26,
        color: COLOR.TEXT,
        click_func: () => this.go('page/books')
      })
      y += 58 + 8
      this.statusY = y
      this.statusWidget = hmUI.createWidget(hmUI.widget.TEXT, {
        x: 24,
        y,
        w: W - 48,
        h: 56,
        text: this.idx.syncedAt ? 'Оновлено ' + formatStamp(this.idx.syncedAt) : '',
        text_size: 20,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP
      })
      this.bookTop = y + 60
      this.renderBook()
      this.renderList()

      // Перший запуск без телефона, а книга читалася — одразу до неї.
      const g = globalData()
      const book = lastReadable()
      if (!g.autoOpened) {
        g.autoOpened = true
        if (book && !phoneConnected()) {
          this.navigating = true
          setTimeout(() => {
            this.navigating = false
            if (!this.destroyed) push({ url: 'page/read', params: JSON.stringify({ id: book.id }) })
          }, 10)
          return
        }
      }
      this.refresh()
    },

    // Картка «Продовжити»: остання книга і скільки прочитано.
    renderBook() {
      this.bookWidgets.forEach(removeWidget)
      this.bookWidgets = []
      const W = this.W
      const b = lastReadable()
      this.listTop = this.bookTop
      if (!b) return
      const x = 16
      const w = W - 32
      const y = this.bookTop
      const h = ROW_H
      const p = percent(b, getPos(loadPos(), b.id))
      const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h, radius: 20, color: COLOR.CARD })
      const bar = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + 10, y: y + 18, w: 6, h: h - 36, radius: 3, color: COLOR.BOOK })
      const title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 28,
        y: y + 10,
        w: w - 44,
        h: 40,
        text: b.title,
        text_size: 26,
        color: COLOR.TEXT,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      const sub = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 28,
        y: y + 52,
        w: w - 44,
        h: 30,
        text: 'Продовжити · ' + p + '%' + (complete(b) ? '' : ' · скачано ' + Math.floor((available(b) / Math.max(1, b.chars)) * 100) + '%'),
        text_size: 20,
        color: COLOR.BOOK,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      this.bookWidgets = [bg, bar, title, sub]
      tappable(
        this.bookWidgets,
        () => this.go('page/read', { id: b.id }),
        (on) => setProps(bg, { x, y, w, h, radius: 20, color: on ? COLOR.CARD_PRESS : COLOR.CARD })
      )
      this.listTop = y + h + ROW_GAP + 6
    },

    go(url, params) {
      if (this.navigating) return
      this.navigating = true
      setTimeout(() => {
        this.navigating = false
      }, 1500)
      push(params ? { url, params: JSON.stringify(params) } : { url })
    },

    // Підпис кнопки «Книги»: скільки скачано нової книги.
    onBookSync(st) {
      if (this.destroyed) return
      const text = st.phase === 'loading' && st.parts ? 'Книги · ' + Math.floor((st.have / st.parts) * 100) + '%' : 'Книги'
      if (text === this.booksText) return
      this.booksText = text
      setProps(this.booksBtn, { x: this.booksBtnX, y: this.booksBtnY, w: this.booksBtnW, h: 58, text, text_size: text === 'Книги' ? 26 : 22 })
    },

    startBooks() {
      if (this.destroyed) return
      const me = this._bsync
      if (me && me.alive && syncInfo().owner === me) return
      startSync(this, (st) => this.onBookSync(st))
    },

    setStatus(text, color) {
      setProps(this.statusWidget, {
        x: 24,
        y: this.statusY,
        w: this.W - 48,
        h: 56,
        text,
        color: color || COLOR.TEXT_DIM
      })
    },

    renderList() {
      this.rowWidgets.forEach(removeWidget)
      this.rowWidgets = []
      const W = this.W
      const items = this.idx.items
      let y = this.listTop

      if (!items.length) {
        this.rowWidgets.push(
          hmUI.createWidget(hmUI.widget.TEXT, {
            x: 30,
            y: y + 10,
            w: W - 60,
            h: 200,
            text: 'Поки порожньо.\nСкопіюй відповідь Claude чи Gemini на телефоні й встав її на сторінці «На годинник».',
            text_size: 22,
            color: COLOR.TEXT_DIM,
            align_h: hmUI.align.CENTER_H,
            align_v: hmUI.align.TOP,
            text_style: hmUI.text_style.WRAP
          })
        )
        return
      }

      items.forEach((item) => {
        this.row(item, y, W)
        y += ROW_H + ROW_GAP
      })
      this.rowWidgets.push(hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + 40, w: W, h: 2, radius: 0, color: COLOR.BG }))
    },

    row(item, y, W) {
      const x = 16
      const w = W - 32
      const unseen = !this.idx.seen[item.id]
      const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h: ROW_H, radius: 20, color: COLOR.CARD })
      const bar = hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: x + 10,
        y: y + 18,
        w: 6,
        h: ROW_H - 36,
        radius: 3,
        color: SOURCE_COLOR[item.src] || COLOR.CLAUDE
      })
      const titleW = w - 44 - (unseen ? 26 : 0)
      const title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 28,
        y: y + 10,
        w: titleW,
        h: 40,
        text: item.title || 'Без назви',
        text_size: 26,
        color: unseen ? COLOR.TEXT : COLOR.TEXT_SOFT,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      const sub = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 28,
        y: y + 52,
        w: w - 44,
        h: 30,
        text: (SOURCE_NAMES[item.src] || 'Claude') + ' · ' + formatStamp(item.ts),
        text_size: 20,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      const widgets = [bg, bar, title, sub]
      if (unseen) {
        widgets.push(
          hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + w - 30, y: y + 24, w: 12, h: 12, radius: 6, color: COLOR.ACCENT })
        )
      }

      const paint = (color) => setProps(bg, { x, y, w, h: ROW_H, radius: 20, color })
      const down = () => {
        this.press = { id: item.id, top: scrollTop(), t: Date.now() }
        paint(COLOR.CARD_PRESS)
        setTimeout(() => {
          if (!this.destroyed) paint(COLOR.CARD)
        }, 350)
      }
      const up = () => {
        const p = this.press
        this.press = null
        if (!p || p.id !== item.id) return
        if (Math.abs(scrollTop() - p.top) > 6) return
        if (Date.now() - p.t > 1500) return
        this.open(item.id)
      }
      widgets.forEach((wd) => {
        try {
          wd.addEventListener(hmUI.event.CLICK_DOWN, down)
          wd.addEventListener(hmUI.event.CLICK_UP, up)
        } catch (e) {}
      })
      this.rowWidgets.push.apply(this.rowWidgets, widgets)
    },

    open(id) {
      if (this.navigating) return
      this.navigating = true
      setTimeout(() => {
        this.navigating = false
      }, 1500)
      push({ url: 'page/view', params: JSON.stringify({ id }) })
    },

    refresh() {
      if (this.loading) return
      if (!phoneConnected()) {
        const saved = this.idx.items.length ? ' Показано збережені.' : ''
        this.setStatus('Телефон не підключений.' + saved, COLOR.WARN)
        this.startBooks()
        return
      }
      this.loading = true
      this.setStatus('Оновлення…')
      this.request({ method: 'list' }, { timeout: 25000 })
        .then((res) => {
          this.loading = false
          if (this.destroyed) return
          if (!res || res.error) {
            this.setStatus(errorMessage((res && res.error) || 'bad_data'), COLOR.WARN)
            this.startBooks()
            return
          }
          const changed = syncItems(this.idx, res.items, Date.now())
          if (changed) this.renderList()
          this.setStatus('Оновлено ' + formatStamp(this.idx.syncedAt))
          this.prefetch()
        })
        .catch((e) => {
          this.loading = false
          if (this.destroyed) return
          const saved = this.idx.items.length ? ' Показано збережені.' : ''
          this.setStatus(errorMessage(bleCode(e)) + saved, COLOR.WARN)
          this.startBooks()
        })
    },

    // Підвантажує кілька найновіших текстів, щоб їх можна було читати без телефона.
    prefetch() {
      const queue = this.idx.items.filter((it) => !hasText(it.id)).slice(0, PREFETCH)
      const next = () => {
        if (this.destroyed) return
        if (!queue.length) {
          this.startBooks()
          return
        }
        const item = queue.shift()
        this.request({ method: 'get', params: { id: item.id } }, { timeout: 30000 })
          .then((res) => {
            if (res && !res.error && typeof res.text === 'string') writeText(item.id, res.text)
            next()
          })
          .catch(() => this.startBooks())
      }
      next()
    },

    onResume() {
      refreshScreen()
      wakeRelaunch(false)
      if (this.destroyed) return
      // Повернулися з книги: оновити «Продовжити» і зсунути список, якщо картка з'явилась.
      const before = this.listTop
      this.renderBook()
      if (this.listTop !== before) this.renderList()
      if (!this.loading) this.startBooks()
    },

    onDestroy() {
      this.destroyed = true
      stopSync(this)
      releaseScreen()
    }
  })
)
