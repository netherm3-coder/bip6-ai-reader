// Читання книги сторінками. Торкнись праворуч — далі, ліворуч — назад; свайп угору чи
// вниз — те саме; торкнись назви розділу вгорі чи рядка внизу — меню.
// Місце запам'ятовується на кожній сторінці. Працює без телефона.

import * as hmUI from '@zos/ui'
import { back, push, replace } from '@zos/router'
import { getDeviceInfo } from '@zos/device'
import { onGesture, offGesture, GESTURE_UP, GESTURE_DOWN, GESTURE_RIGHT } from '@zos/interaction'
import { setScrollLock } from '@zos/page'
import { Time } from '@zos/sensor'
import { BasePage } from '@zeppos/zml/base-page'
import {
  loadLib, findBook, readPart, readMeta, loadPos, getPos, setPos, loadCfg, saveCfg, FONT_SIZES,
  percent, available, complete, readable, loadWidths, saveWidths
} from '../utils/books'
import { createMeasure, createSource, createPager, chapterAt } from '../utils/layout'
import { startSync, stopSync } from '../utils/booksync'
import { holdScreen, refreshScreen, releaseScreen, setScreenMode, wakeRelaunch } from '../utils/screen'
import { COLOR, READER_SCREEN_MS } from '../utils/constants'
import { statusBar, parseParams, setProps, globalData, markStarted } from '../utils/ui'

const X = 22
const TEXT_W = 346
const TEXT_TOP = 52
const TEXT_BOTTOM = 412
const MAX_ROWS = 12
const MENU_TOP = 50
const MENU_BOTTOM = 410

function pad(n) {
  return (n < 10 ? '0' : '') + n
}

function clock() {
  try {
    const t = new Time()
    return pad(t.getHours()) + ':' + pad(t.getMinutes())
  } catch (e) {
    return ''
  }
}

Page(
  BasePage({
    state: {},

    onInit(params) {
      const p = parseParams(params)
      this.id = String(p.id || loadCfg().last || '')
      this.history = []
      this.destroyed = false
      this.navigating = false
      this.screen = null
      this.down = null
      this.page = null
      // Відкрито напряму після пробудження екрана — під нами немає інших сторінок.
      this.isRoot = markStarted()
      if (this.isRoot) globalData().autoOpened = true
    },

    build() {
      const { width: W } = getDeviceInfo()
      this.W = W
      statusBar(false)
      try {
        setScrollLock({ lock: true })
      } catch (e) {}
      this.cfg = loadCfg()
      holdScreen({ ms: READER_SCREEN_MS, wristOff: !!this.cfg.wrist })
      wakeRelaunch(true)

      const text = (props) =>
        hmUI.createWidget(
          hmUI.widget.TEXT,
          Object.assign({ text: '', color: COLOR.BOOK_TEXT, align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.NONE }, props)
        )
      this.topW = text({ x: 64, y: 12, w: W - 128, h: 34, text_size: 20, color: COLOR.TEXT_DIM, align_h: hmUI.align.CENTER_H, text_style: hmUI.text_style.ELLIPSIS })
      this.lineWs = []
      for (let i = 0; i < MAX_ROWS; i++) this.lineWs.push(text({ x: X, y: TEXT_TOP + i * 30, w: TEXT_W, h: 30, text_size: 28 }))
      this.msgW = text({ x: 36, y: 120, w: W - 72, h: 220, text_size: 26, color: COLOR.TEXT_SOFT, align_h: hmUI.align.CENTER_H, text_style: hmUI.text_style.WRAP })
      this.bottomW = text({ x: 70, y: 414, w: W - 140, h: 30, text_size: 20, color: COLOR.TEXT_DIM, align_h: hmUI.align.CENTER_H })

      // Прозорий шар на весь екран ловить дотики.
      const overlay = hmUI.createWidget(hmUI.widget.TEXT, { x: 0, y: 0, w: W, h: 450, text: ' ', text_size: 10, color: COLOR.BG })
      try {
        overlay.addEventListener(hmUI.event.CLICK_DOWN, (info) => {
          this.down = { x: info && info.x, y: info && info.y, t: Date.now() }
        })
        overlay.addEventListener(hmUI.event.CLICK_UP, (info) => this.onTap(info))
      } catch (e) {}
      try {
        onGesture({
          callback: (ev) => {
            if (ev === GESTURE_UP) {
              this.next()
              return true
            }
            if (ev === GESTURE_DOWN) {
              this.prev()
              return true
            }
            if (ev === GESTURE_RIGHT && this.isRoot) {
              this.leave()
              return true
            }
            return false
          }
        })
      } catch (e) {}

      if (this.closeIfAsked()) return
      this.load()
      startSync(this, (st, changed) => this.onSync(st, changed))
    },

    // Книгу видалили з меню — до списку.
    closeIfAsked() {
      const g = globalData()
      if (!g.closeReader) return false
      g.closeReader = false
      this.book = null
      setTimeout(() => {
        if (this.isRoot) this.leave()
        else back()
      }, 0)
      return true
    },

    // ---------- книга й розкладка ----------

    load() {
      const book = findBook(loadLib(), this.id)
      if (!readable(book)) {
        this.book = null
        this.showMessage('Цієї книги немає на годиннику.\nСвайп праворуч — назад.', '')
        return
      }
      this.book = book
      this.meta = readMeta(book.id)
      this.cfg = loadCfg()
      if (this.cfg.last !== book.id) {
        this.cfg.last = book.id
        saveCfg(this.cfg)
      }
      this.layout()
      this.start = getPos(loadPos(), book.id)
      this.render()
    },

    layout() {
      const size = FONT_SIZES[this.cfg.size] || 28
      if (this.m && this.m.dirty()) saveWidths(this.m.size, this.m.dump())
      this.size = size
      this.lineH = Math.round(size * 1.3)
      this.rows = Math.min(MAX_ROWS, Math.floor((TEXT_BOTTOM - TEXT_TOP) / this.lineH))
      this.indent = Math.round(size * 0.9)
      this.top0 = TEXT_TOP + Math.floor((TEXT_BOTTOM - TEXT_TOP - this.rows * this.lineH) / 2)
      this.m = createMeasure(size, loadWidths(size))
      const id = this.book.id
      this.src = createSource(this.book, (i) => readPart(id, i))
      this.pager = createPager(this.src, this.m, { width: TEXT_W, indent: this.indent, rows: this.rows }, { ch: this.meta.ch.map((c) => c[0]), h: this.meta.h })
    },

    render() {
      const b = this.book
      if (!b) return
      if (this.src.len() <= 0) {
        this.showMessage('Книга ще не скачана.\nВідкрий програму, коли телефон поруч.', '')
        return
      }
      const page = this.pager.pageAt(this.start)
      this.page = page
      this.start = page.start
      this.screen = null
      for (let i = 0; i < MAX_ROWS; i++) {
        const w = this.lineWs[i]
        const y = this.top0 + i * this.lineH
        const l = page.lines[i]
        if (!l) {
          setProps(w, { x: X, y, w: TEXT_W, h: this.lineH, text: '' })
          continue
        }
        const indent = l.first && !l.heading ? this.indent : 0
        setProps(w, {
          x: X + indent,
          y,
          w: TEXT_W - indent + 12,
          h: this.lineH,
          text: this.m.show(this.src.slice(l.s, l.e)),
          text_size: this.size,
          color: l.heading ? COLOR.HEADING : COLOR.BOOK_TEXT
        })
      }
      setProps(this.msgW, { x: 36, y: 120, w: this.W - 72, h: 220, text: '' })
      const ci = chapterAt(this.meta.ch, page.start)
      this.setTop(ci >= 0 ? this.meta.ch[ci][1] : b.title)
      this.setBottom(this.status())
      setPos(b.id, page.start)
    },

    status() {
      const b = this.book
      const page = this.page
      const pct = page && page.atEnd && page.end >= b.chars ? 100 : percent(b, page ? page.start : 0)
      if (!complete(b)) return pct + '% · скачано ' + Math.floor((available(b) / Math.max(1, b.chars)) * 100) + '%'
      const t = clock()
      return (t ? t + ' · ' : '') + pct + '%'
    },

    setTop(text) {
      setProps(this.topW, { x: 64, y: 12, w: this.W - 128, h: 34, text: this.m ? this.m.show(text) : text })
    },

    setBottom(text) {
      setProps(this.bottomW, { x: 70, y: 414, w: this.W - 140, h: 30, text })
    },

    showMessage(text, top) {
      const lh = this.lineH || 37
      this.lineWs.forEach((w, i) => setProps(w, { x: X, y: TEXT_TOP + i * 30, w: TEXT_W, h: lh, text: '' }))
      setProps(this.msgW, { x: 36, y: 120, w: this.W - 72, h: 220, text })
      setProps(this.topW, { x: 64, y: 12, w: this.W - 128, h: 34, text: top || '' })
      this.setBottom('')
    },

    showEnd() {
      this.screen = 'end'
      this.showMessage('Кінець книги', this.book.title)
      this.setBottom('100%')
    },

    showNotLoaded() {
      this.screen = 'missing'
      const b = this.book
      const got = Math.floor((available(b) / Math.max(1, b.chars)) * 100)
      this.showMessage('Далі ще не скачано (' + got + '%).\nВідкрий програму, коли телефон поруч, — книга докачається.', b.title)
    },

    // ---------- гортання ----------

    next() {
      if (!this.book || !this.page || this.screen) return
      const page = this.page
      if (page.atEnd) {
        if (page.end >= this.book.chars && complete(this.book)) this.showEnd()
        else this.showNotLoaded()
        return
      }
      this.history.push(page.start)
      if (this.history.length > 60) this.history.shift()
      this.start = page.end
      this.render()
    },

    prev() {
      if (!this.book || !this.page) return
      if (this.screen) {
        this.render()
        return
      }
      if (this.page.start <= 0) return
      const h = this.history.pop()
      this.start = h !== undefined && h < this.page.start ? h : this.pager.pageBefore(this.page.start)
      this.render()
    },

    onTap(info) {
      const d = this.down
      this.down = null
      if (!d) return
      const x = info && typeof info.x === 'number' ? info.x : d.x
      const y = info && typeof info.y === 'number' ? info.y : d.y
      if (typeof d.x === 'number' && typeof x === 'number' && (Math.abs(x - d.x) > 30 || Math.abs(y - d.y) > 30)) return
      if (Date.now() - d.t > 1500) return
      if (typeof d.y === 'number' && (d.y < MENU_TOP || d.y > MENU_BOTTOM)) {
        this.openMenu()
        return
      }
      if (typeof d.x === 'number' && d.x < this.W * 0.35) this.prev()
      else this.next()
    },

    openMenu() {
      if (!this.book || this.navigating) return
      this.navigating = true
      setTimeout(() => {
        this.navigating = false
      }, 1200)
      push({ url: 'page/bookmenu', params: JSON.stringify({ id: this.book.id }) })
    },

    // Читалка відкрилася першою (після пробудження екрана): назад — на стартову сторінку.
    leave() {
      if (this.navigating) return
      this.navigating = true
      globalData().autoOpened = true
      replace({ url: 'page/index' })
    },

    // ---------- докачування під час читання ----------

    onSync(st, changed) {
      if (this.destroyed || !this.book || !changed || st.id !== this.book.id) return
      const fresh = findBook(loadLib(), this.book.id)
      if (!fresh || fresh.have <= this.book.have) return
      this.book.have = fresh.have
      this.book.chars = fresh.chars
      this.book.parts = fresh.parts
      this.book.meta = fresh.meta
      if (this.screen === 'missing') {
        this.start = this.page ? this.page.end : this.start
        this.render()
      } else if (this.page && this.page.atEnd) this.render()
      else this.setBottom(this.status())
    },

    onResume() {
      refreshScreen()
      wakeRelaunch(true)
      if (this.destroyed || this.closeIfAsked()) return
      // Повернулися з меню чи змісту: шрифт, місце або сама книга могли змінитися.
      const cfg = loadCfg()
      const book = findBook(loadLib(), this.id)
      if (!readable(book)) {
        this.book = null
        if (this.isRoot) this.leave()
        else back()
        return
      }
      const pos = getPos(loadPos(), this.id)
      const sizeChanged = cfg.size !== this.cfg.size
      this.cfg = cfg
      setScreenMode({ ms: READER_SCREEN_MS, wristOff: !!cfg.wrist })
      if (sizeChanged) {
        this.book = book
        this.layout()
        this.history = []
      }
      if (!this.page || pos !== this.page.start || sizeChanged) {
        this.history = []
        this.start = pos
        this.render()
      }
    },

    onDestroy() {
      this.destroyed = true
      stopSync(this)
      try {
        offGesture()
      } catch (e) {}
      if (this.m && this.m.dirty()) saveWidths(this.m.size, this.m.dump())
      releaseScreen()
    }
  })
)
