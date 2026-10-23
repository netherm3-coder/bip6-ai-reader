// Зміст книги сторінками по PER розділів; торкнись розділу — перейти до нього.

import * as hmUI from '@zos/ui'
import { back, replace } from '@zos/router'
import { getDeviceInfo } from '@zos/device'
import { loadLib, findBook, readMeta, loadPos, getPos, setPos, percent, available } from '../utils/books'
import { chapterAt } from '../utils/layout'
import { COLOR, STATUS_BAR_H } from '../utils/constants'
import { statusBar, parseParams, setProps, tappable, globalData, markStarted } from '../utils/ui'
import { holdScreen, refreshScreen, releaseScreen, wakeRelaunch } from '../utils/screen'

const PER = 20
const ROW_H = 66
const GAP = 8
const BTN_H = 54

Page({
  onInit(params) {
    const p = parseParams(params)
    markStarted()
    this.id = String(p.id || '')
    this.page = p.page === undefined ? null : Math.max(0, Math.floor(Number(p.page) || 0))
    this.leaving = false
  },

  build() {
    const { width: W } = getDeviceInfo()
    this.W = W
    statusBar(true)
    holdScreen()
    wakeRelaunch(false)
    const b = findBook(loadLib(), this.id)
    let y = STATUS_BAR_H + 2
    if (!b) return
    this.book = b
    const ch = readMeta(b.id).ch
    const cur = chapterAt(ch, getPos(loadPos(), b.id))
    const pages = Math.max(1, Math.ceil(ch.length / PER))
    const page = this.page === null ? Math.floor(Math.max(0, cur) / PER) : Math.min(this.page, pages - 1)
    const from = page * PER
    const to = Math.min(ch.length, from + PER)
    const avail = available(b)

    this.titleW = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 24,
      y,
      w: W - 48,
      h: 40,
      text: 'Зміст' + (pages > 1 ? ' · ' + (from + 1) + '–' + to + ' з ' + ch.length : ''),
      text_size: 26,
      color: COLOR.TEXT,
      align_h: hmUI.align.LEFT,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE
    })
    y += 44
    if (page > 0) {
      this.navButton('Попередні', y, page - 1)
      y += BTN_H + GAP
    }
    for (let i = from; i < to; i++) {
      this.row(ch[i], i === cur, ch[i][0] < avail, y)
      y += ROW_H + GAP
    }
    if (page < pages - 1) {
      this.navButton('Наступні', y, page + 1)
      y += BTN_H + GAP
    }
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + 40, w: W, h: 2, radius: 0, color: COLOR.BG })
  },

  navButton(text, y, page) {
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 60,
      y,
      w: this.W - 120,
      h: BTN_H,
      radius: BTN_H / 2,
      normal_color: COLOR.NEUTRAL,
      press_color: COLOR.NEUTRAL_PRESS,
      text,
      text_size: 22,
      color: COLOR.TEXT,
      click_func: () => {
        if (this.leaving) return
        this.leaving = true
        replace({ url: 'page/toc', params: JSON.stringify({ id: this.id, page }) })
      }
    })
  },

  row(c, current, ready, y) {
    const W = this.W
    const x = 16
    const w = W - 32
    const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h: ROW_H, radius: 18, color: COLOR.CARD })
    const widgets = [bg]
    if (current) widgets.push(hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + 10, y: y + 14, w: 6, h: ROW_H - 28, radius: 3, color: COLOR.BOOK }))
    widgets.push(
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + 26,
        y,
        w: w - 26 - 72,
        h: ROW_H,
        text: c[1],
        text_size: 22,
        color: ready ? (current ? COLOR.TEXT : COLOR.TEXT_SOFT) : COLOR.TEXT_DIM,
        align_h: hmUI.align.LEFT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
    )
    widgets.push(
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: x + w - 70,
        y,
        w: 58,
        h: ROW_H,
        text: percent(this.book, c[0]) + '%',
        text_size: 18,
        color: COLOR.TEXT_DIM,
        align_h: hmUI.align.RIGHT,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.NONE
      })
    )
    tappable(
      widgets,
      () => this.open(c, ready),
      (on) => setProps(bg, { x, y, w, h: ROW_H, radius: 18, color: on ? COLOR.CARD_PRESS : COLOR.CARD })
    )
  },

  open(c, ready) {
    if (this.leaving) return
    if (!ready) {
      setProps(this.titleW, { x: 24, y: STATUS_BAR_H + 2, w: this.W - 48, h: 40, text: 'Цей розділ ще не скачано', color: COLOR.WARN })
      return
    }
    this.leaving = true
    setPos(this.id, c[0])
    // Меню під змістом теж закриється — одразу до книги.
    globalData().closeMenu = true
    back()
  },

  onResume() {
    refreshScreen()
    wakeRelaunch(false)
  },

  onDestroy() {
    releaseScreen()
  }
})
