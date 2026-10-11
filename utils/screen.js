// Екран, поки відкрита програма: не гасне сам (до SCREEN_ON_MS без дотиків)
// і не гасне, коли опускаєш руку.
//
// Час світіння система скидає сама, коли сторінка закривається. Паузу жесту
// «опустити руку» повертаємо самі — коли не лишилося жодної відкритої сторінки.
// Лічильник лежить у globalData програми, бо нова сторінка може побудуватися
// раніше, ніж знищиться попередня.

import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { SCREEN_ON_MS } from './constants'

function shared() {
  try {
    const app = getApp()
    return (app && app._options && app._options.globalData) || null
  } catch (e) {
    return null
  }
}

function apply() {
  try {
    setPageBrightTime({ brightTime: SCREEN_ON_MS })
  } catch (e) {}
  try {
    pauseDropWristScreenOff({ duration: 0 })
  } catch (e) {}
}

// Викликати в build() кожної сторінки.
export function holdScreen() {
  const g = shared()
  if (g) g.screenHolds = (g.screenHolds || 0) + 1
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
