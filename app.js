import { BaseApp } from '@zeppos/zml/base-app'
import { restoreWrist } from './utils/screen'

// Скільки чекати, поки Zepp на телефоні запустить сервіс програми. Стандартні 5 с
// замало, коли Zepp «спить» у фоні: тоді годинник одразу писав «Немає зв'язку».
const SHAKE_MS = 15000

App(
  BaseApp({
    globalData: {},
    onCreate() {
      try {
        if (this.messaging) this.messaging.shakeTimeout = SHAKE_MS
      } catch (e) {}
    },
    onDestroy() {
      // На виході з програми жест «опустити руку» знову гасить екран.
      restoreWrist()
    }
  })
)
