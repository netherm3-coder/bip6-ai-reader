// Бібліотека: книги на годиннику (скільки прочитано), що качається з телефона,
// і книги, видалені з годинника, але ще є на телефоні.

import * as hmUI from '@zos/ui'
import { push } from '@zos/router'
import { getDeviceInfo, getDiskInfo } from '@zos/device'
import { BasePage } from '@zeppos/zml/base-page'
import { loadLib, loadPos, getPos, percent, available, complete, readable, restoreBook } from '../utils/books'
import { startSync, stopSync, syncInfo, relist } from '../utils/booksync'
import { COLOR, STATUS_BAR_H } from '../utils/constants'
import { statusBar, setProps, removeWidget, tappable, markStarted } from '../utils/ui'
import { holdScreen, refreshScreen, releaseScreen, wakeRelaunch } from '../utils/screen'
import { errorMessage } from '../utils/messages'

const CARD_H = 104
const GAP = 10

function pct(a, b) {
  return b > 0 ? Math.floor((a / b) * 100) : 0
}

function mb(bytes) {
  if (!(bytes > 0)) return ''
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',') + ' ГБ'
  return Math.round(bytes / (1024 * 1024)) + ' МБ'
}

Page(
  BasePage({
    state: {},

    onInit() {
      this.destroyed = false
      markStarted()
      this.navigating = false
      this.widgets = []
      this.cards = {}
      this.note = ''
    },

    build() {
      const { width: W } = getDeviceInfo()
      this.W = W
      statusBar(true)
      holdScreen()
      wakeRelaunch(false)
      const y = STATUS_BAR_H + 2
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: 24,
        y,
        w: W - 48,
        h: 40,
        text: 'Книги',
        text_size: 30,
        color: COLOR.TEXT,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.NONE
      })
      this.statusY = y + 42
      this.statusW = hmUI.createWidget(hmUI.widget.TEXT, {
        x: 24,
        y: this.statusY,
        w: W - 48,
        h: 54,
        text: '',
        text_size: 20,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP
      })
      this.listTop = this.statusY + 60
      this.renderList()
      this.renderStatus(syncInfo())
      startSync(this, (st, changed) => {
        if (this.destroyed) return
        if (changed) this.renderList()
        this.renderStatus(st)
      })
    },

    status(text, color) {
      setProps(this.statusW, { x: 24, y: this.statusY, w: this.W - 48, h: 54, text, color: color || COLOR.TEXT_DIM })
    },

    renderStatus(st) {
      if (this.note) {
        this.status(this.note, COLOR.WARN)
        return
      }
      const lib = this.lib || loadLib()
      let text = ''
      let color = COLOR.TEXT_DIM
      if (st.phase === 'offline') text = 'Телефон не підключений. Читати можна те, що вже на годиннику.'
      else if (st.phase === 'checking') text = 'Перевіряю нові книги на телефоні…'
      else if (st.phase === 'loading') text = 'Качаю «' + st.title + '» · ' + pct(st.have, st.parts) + '%'
      else if (st.phase === 'nospace') {
        text = 'Мало місця на годиннику для «' + st.title + '».'
        color = COLOR.WARN
      } else if (st.phase === 'error') {
        text = errorMessage(st.error)
        color = COLOR.WARN
      } else if (lib.books.some((b) => !b.hidden)) text = 'Усе скачано — можна читати без телефона.'
      this.status(text, color)
      // Прогрес картки, що качається, — без перебудови списку.
      if (st.phase === 'loading' && this.cards[st.id]) this.paintCard(this.cards[st.id], null)
    },

    renderList() {
      this.widgets.forEach(removeWidget)
      this.widgets = []
      this.cards = {}
      const W = this.W
      this.lib = loadLib()
      const pos = loadPos()
      const shown = this.lib.books.filter((b) => !b.hidden)
      const hidden = this.lib.books.filter((b) => b.hidden)
      let y = this.listTop
      const add = (w) => {
        this.widgets.push(w)
        return w
      }
      const label = (text, size, color, h) => {
        add(
          hmUI.createWidget(hmUI.widget.TEXT, {
            x: 24,
            y,
            w: W - 48,
            h,
            text,
            text_size: size,
            color,
            align_h: hmUI.align.LEFT,
            align_v: hmUI.align.TOP,
            text_style: hmUI.text_style.WRAP
          })
        )
        y += h
      }

      if (!shown.length) {
        label('Книг ще немає.\nНа телефоні: сторінка «На годинник» → «Книги» → вибери файл. Потім відкрий цю програму поруч із телефоном.', 22, COLOR.TEXT_DIM, 170)
      }
      shown.forEach((b) => {
        this.card(b, y, getPos(pos, b.id), false)
        y += CARD_H + GAP
      })
      if (hidden.length) {
        y += 8
        label('Видалені з годинника', 20, COLOR.TEXT_DIM, 32)
        hidden.forEach((b) => {
          this.card(b, y, 0, true)
          y += CARD_H + GAP
        })
      }
      y += 6
      let free = ''
      try {
        free = mb(getDiskInfo().free)
      } catch (e) {}
      if (free) label('Вільно на годиннику: ' + free, 20, COLOR.TEXT_DIM, 30)
      add(hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + 40, w: W, h: 2, radius: 0, color: COLOR.BG }))
    },

    card(b, y, offset, hidden) {
      const W = this.W
      const x = 16
      const w = W - 32
      const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h: CARD_H, radius: 20, color: COLOR.CARD })
      const title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 18,
        y: y + 8,
        w: w - 36,
        h: 38,
        text: b.title,
        text_size: 26,
        color: hidden ? COLOR.TEXT_DIM : COLOR.TEXT,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      const sub = hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 18,
        y: y + 46,
        w: w - 36,
        h: 30,
        text: '',
        text_size: 20,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      const track = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + 18, y: y + 82, w: w - 36, h: 6, radius: 3, color: COLOR.LINE })
      const bar = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + 18, y: y + 82, w: 6, h: 6, radius: 3, color: COLOR.BOOK })
      const c = { b, x, y, w, offset, hidden, bg, sub, bar }
      this.cards[b.id] = c
      this.widgets.push(bg, title, sub, track, bar)
      this.paintCard(c, null)
      tappable(
        [bg, title, sub, track, bar],
        () => this.open(c),
        (on) => setProps(bg, { x, y, w, h: CARD_H, radius: 20, color: on ? COLOR.CARD_PRESS : COLOR.CARD })
      )
    },

    paintCard(c, fresh) {
      let b = fresh || c.b
      const st = syncInfo()
      if (st.phase === 'loading' && st.id === b.id && st.have > b.have) b = Object.assign({}, b, { have: st.have })
      c.b = b
      const who = b.author ? b.author + ' · ' : ''
      let text = ''
      let ratio = 0
      let color = COLOR.BOOK
      if (c.hidden) text = 'торкнись, щоб скачати знову'
      else if (complete(b)) {
        const p = percent(b, c.offset)
        text = who + (p > 0 ? 'прочитано ' + p + '%' : 'не почато')
        ratio = p / 100
      } else {
        const got = pct(available(b), b.chars)
        const active = st.phase === 'loading' && st.id === b.id
        text = who + (b.have ? 'скачано ' + got + '%' : active ? 'починаю качати' : 'чекає на телефон')
        ratio = got / 100
        color = COLOR.ACCENT
      }
      setProps(c.sub, { x: c.x + 18, y: c.y + 46, w: c.w - 36, h: 30, text })
      const full = c.w - 36
      // 0 % — смужки не видно (колір доріжки).
      setProps(c.bar, { x: c.x + 18, y: c.y + 82, w: Math.max(6, Math.round(full * Math.min(1, ratio))), h: 6, radius: 3, color: ratio > 0 ? color : COLOR.LINE })
    },

    open(c) {
      if (this.navigating) return
      const b = c.b
      if (c.hidden) {
        const lib = loadLib()
        restoreBook(lib, b.id)
        relist()
        this.note = ''
        this.renderList()
        startSync(this, (st, changed) => {
          if (this.destroyed) return
          if (changed) this.renderList()
          this.renderStatus(st)
        })
        return
      }
      if (!readable(b)) {
        this.note = 'Книга ще не скачана. Тримай телефон поруч і програму відкритою.'
        this.renderStatus(syncInfo())
        setTimeout(() => {
          if (this.destroyed) return
          this.note = ''
          this.renderStatus(syncInfo())
        }, 4000)
        return
      }
      this.navigating = true
      setTimeout(() => {
        this.navigating = false
      }, 1200)
      push({ url: 'page/read', params: JSON.stringify({ id: b.id }) })
    },

    onResume() {
      refreshScreen()
      wakeRelaunch(false)
      if (this.destroyed) return
      this.renderList()
      startSync(this, (st, changed) => {
        if (this.destroyed) return
        if (changed) this.renderList()
        this.renderStatus(st)
      })
    },

    onDestroy() {
      this.destroyed = true
      stopSync(this)
      releaseScreen()
    }
  })
)
