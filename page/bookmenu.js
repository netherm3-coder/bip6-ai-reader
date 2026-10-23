// Меню книги: зміст, розмір шрифту, перехід на ±10 %, жест руки, видалення.

import * as hmUI from '@zos/ui'
import { back, push } from '@zos/router'
import { getDeviceInfo } from '@zos/device'
import {
  loadLib, findBook, readMeta, loadPos, getPos, setPos, loadCfg, saveCfg, FONT_SIZES, percent, available,
  complete, deleteBook
} from '../utils/books'
import { relist } from '../utils/booksync'
import { COLOR, STATUS_BAR_H } from '../utils/constants'
import { statusBar, parseParams, setProps, textHeight, globalData, markStarted } from '../utils/ui'
import { holdScreen, refreshScreen, releaseScreen, wakeRelaunch } from '../utils/screen'

const BTN_H = 58
const GAP = 12

Page({
  onInit(params) {
    const p = parseParams(params)
    markStarted()
    this.id = String(p.id || '')
    this.destroyed = false
    this.leaving = false
    this.armed = false
  },

  build() {
    const { width: W } = getDeviceInfo()
    this.W = W
    statusBar(true)
    holdScreen()
    wakeRelaunch(false)
    if (this.closeIfAsked()) return
    this.book = findBook(loadLib(), this.id)
    this.cfg = loadCfg()
    const b = this.book
    let y = STATUS_BAR_H + 4
    if (!b) {
      this.text('Книгу не знайдено', y, 60, 26, COLOR.TEXT_DIM)
      return
    }
    const titleH = Math.min(72, textHeight(b.title, 26, W - 48) + 4)
    this.text(b.title, y, titleH, 26, COLOR.TEXT, hmUI.text_style.WRAP)
    y += titleH
    if (b.author) {
      this.text(b.author, y, 30, 20, COLOR.TEXT_DIM)
      y += 30
    }
    this.subY = y
    this.subW = this.text('', y, 30, 20, COLOR.TEXT_DIM)
    y += 30 + GAP
    this.renderSub()

    if (readMeta(b.id).ch.length) {
      this.button('Зміст', y, () => this.go('page/toc'))
      y += BTN_H + GAP
    }

    // Шрифт: [A−]  Шрифт 28  [A+]
    this.fontY = y
    this.small('A−', 24, y, () => this.font(-1))
    this.small('A+', W - 24 - 92, y, () => this.font(1))
    this.fontW = this.center('', y)
    this.renderFont()
    y += BTN_H + GAP

    // Перехід: [−10%]  37%  [+10%]
    this.jumpY = y
    this.small('−10%', 24, y, () => this.jump(-10))
    this.small('+10%', W - 24 - 92, y, () => this.jump(10))
    this.jumpW = this.center('', y)
    this.renderJump()
    y += BTN_H + GAP

    this.wristY = y
    this.wristBtn = this.button('', y, () => this.toggleWrist())
    this.renderWrist()
    y += BTN_H + 6
    this.text('Без цього екран гасне сам через 5 хв без дотиків.', y, 52, 18, COLOR.TEXT_DIM, hmUI.text_style.WRAP)
    y += 52 + GAP

    this.delY = y
    this.delBtn = this.button('Видалити з годинника', y, () => this.remove(), COLOR.DANGER_PRESS, COLOR.DANGER)
    y += BTN_H
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + 40, w: W, h: 2, radius: 0, color: COLOR.BG })
  },

  text(text, y, h, size, color, style) {
    return hmUI.createWidget(hmUI.widget.TEXT, {
      x: 24,
      y,
      w: this.W - 48,
      h,
      text,
      text_size: size,
      color,
      align_h: hmUI.align.LEFT,
      align_v: hmUI.align.CENTER_V,
      text_style: style || hmUI.text_style.ELLIPSIS
    })
  },

  center(text, y) {
    return hmUI.createWidget(hmUI.widget.TEXT, {
      x: 24 + 92,
      y,
      w: this.W - 48 - 184,
      h: BTN_H,
      text,
      text_size: 24,
      color: COLOR.TEXT,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE
    })
  },

  button(text, y, fn, normal, color) {
    return hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24,
      y,
      w: this.W - 48,
      h: BTN_H,
      radius: BTN_H / 2,
      normal_color: normal || COLOR.NEUTRAL,
      press_color: COLOR.NEUTRAL_PRESS,
      text,
      text_size: 24,
      color: color || COLOR.TEXT,
      click_func: fn
    })
  },

  small(text, x, y, fn) {
    return hmUI.createWidget(hmUI.widget.BUTTON, {
      x,
      y,
      w: 92,
      h: BTN_H,
      radius: BTN_H / 2,
      normal_color: COLOR.NEUTRAL,
      press_color: COLOR.NEUTRAL_PRESS,
      text,
      text_size: 24,
      color: COLOR.TEXT,
      click_func: fn
    })
  },

  renderSub() {
    const b = this.book
    const p = percent(b, getPos(loadPos(), b.id))
    const state = complete(b) ? 'уся на годиннику' : 'скачано ' + Math.floor((available(b) / Math.max(1, b.chars)) * 100) + '%'
    setProps(this.subW, { x: 24, y: this.subY, w: this.W - 48, h: 30, text: 'Прочитано ' + p + '% · ' + state })
  },

  renderFont() {
    setProps(this.fontW, { x: 24 + 92, y: this.fontY, w: this.W - 48 - 184, h: BTN_H, text: 'Шрифт ' + FONT_SIZES[this.cfg.size] })
  },

  renderJump() {
    const p = percent(this.book, getPos(loadPos(), this.book.id))
    setProps(this.jumpW, { x: 24 + 92, y: this.jumpY, w: this.W - 48 - 184, h: BTN_H, text: p + '%' })
  },

  renderWrist() {
    setProps(this.wristBtn, {
      x: 24,
      y: this.wristY,
      w: this.W - 48,
      h: BTN_H,
      text: 'Гасне, коли опускаю руку: ' + (this.cfg.wrist ? 'так' : 'ні')
    })
  },

  font(d) {
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, this.cfg.size + d))
    if (next === this.cfg.size) return
    this.cfg.size = next
    saveCfg(this.cfg)
    this.renderFont()
  },

  jump(d) {
    const b = this.book
    const cur = percent(b, getPos(loadPos(), b.id))
    const target = Math.max(0, Math.min(99, cur + d))
    let o = Math.floor((b.chars * target) / 100)
    const avail = available(b)
    if (o >= avail) o = Math.max(0, avail - 1)
    setPos(b.id, o)
    this.renderJump()
    this.renderSub()
  },

  toggleWrist() {
    this.cfg.wrist = this.cfg.wrist ? 0 : 1
    saveCfg(this.cfg)
    this.renderWrist()
  },

  go(url) {
    if (this.leaving) return
    this.leaving = true
    setTimeout(() => {
      this.leaving = false
    }, 1200)
    push({ url, params: JSON.stringify({ id: this.id }) })
  },

  remove() {
    if (!this.armed) {
      this.armed = true
      setProps(this.delBtn, { x: 24, y: this.delY, w: this.W - 48, h: BTN_H, text: 'Ще раз — видалити' })
      this.armTimer = setTimeout(() => {
        this.armed = false
        if (!this.destroyed) setProps(this.delBtn, { x: 24, y: this.delY, w: this.W - 48, h: BTN_H, text: 'Видалити з годинника' })
      }, 3000)
      return
    }
    try {
      clearTimeout(this.armTimer)
    } catch (e) {}
    deleteBook(loadLib(), this.id)
    relist()
    this.leaving = true
    // Читалка під меню теж закриється — до списку.
    globalData().closeReader = true
    back()
  },

  // Зі змісту вибрали розділ — повертаємось одразу до книги.
  closeIfAsked() {
    const g = globalData()
    if (!g.closeMenu) return false
    g.closeMenu = false
    this.leaving = true
    setTimeout(() => back(), 0)
    return true
  },

  onResume() {
    refreshScreen()
    wakeRelaunch(false)
    if (this.destroyed || this.closeIfAsked() || !this.book) return
    this.renderSub()
    this.renderJump()
  },

  onDestroy() {
    this.destroyed = true
    try {
      clearTimeout(this.armTimer)
    } catch (e) {}
    releaseScreen()
  }
})
