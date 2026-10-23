// Екран, поки відкрита програма: не гасне сам (до SCREEN_ON_MS без дотиків)
// і не гасне, коли опускаєш руку.
//
// Час світіння система скидає сама, коли сторінка закривається. Паузу жесту
// «опустити руку» повертаємо самі — коли не лишилося жодної відкритої сторінки.
// Лічильник лежить у globalData програми, бо нова сторінка може побудуватися
// раніше, ніж знищиться попередня.

import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff, setWakeUpRelaunch } from '@zos/display'
import { SCREEN_ON_MS } from './constants'

function shared() {
  try {
    const app = getApp()
    return (app && app._options && app._options.globalData) || null
  } catch (e) {
    return null
  }
}

// Налаштування поточної сторінки (у кожної сторінки своя копія модуля).
let current = { ms: SCREEN_ON_MS, wristOff: false }

function apply() {
  try {
    setPageBrightTime({ brightTime: current.ms })
  } catch (e) {}
  try {
    if (current.wristOff) resetDropWristScreenOff()
    else pauseDropWristScreenOff({ duration: 0 })
  } catch (e) {}
}

// Викликати в build() кожної сторінки. opts: { ms — скільки світиться без дотиків,
// wristOff — гаснути, коли опускаєш руку }.
export function holdScreen(opts) {
  const g = shared()
  if (g) g.screenHolds = (g.screenHolds || 0) + 1
  current = { ms: (opts && opts.ms) || SCREEN_ON_MS, wristOff: !!(opts && opts.wristOff) }
  apply()
}

// Змінити налаштування відкритої сторінки (напр., перемикач у читалці).
export function setScreenMode(opts) {
  current = { ms: (opts && opts.ms) || current.ms, wristOff: !!(opts && opts.wristOff) }
  apply()
}

// Повернулися на сторінку (onResume): система могла скинути налаштування.
export function refreshScreen() {
  apply()
}

// Викликати в onDestroy() кожної сторінки.
export function releaseScreen() {
  const g = shared()
  if (g) {
    g.screenHolds = Math.max(0, (g.screenHolds || 0) - 1)
    if (g.screenHolds > 0) return
  }
  restoreWrist()
}

// Повернути жест «опустити руку» (і під час виходу з програми).
export function restoreWrist() {
  try {
    resetDropWristScreenOff()
  } catch (e) {}
}

// Після того як екран згас (і система закрила програму), підняти руку — і
// повернутися на цю ж сторінку. Вмикає лише читалка книг.
export function wakeRelaunch(on) {
  try {
    setWakeUpRelaunch({ relaunch: !!on })
  } catch (e) {}
}
