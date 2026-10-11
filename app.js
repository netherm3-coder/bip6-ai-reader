import { BaseApp } from '@zeppos/zml/base-app'
import { restoreWrist } from './utils/screen'

App(
  BaseApp({
    globalData: {},
    onCreate() {},
    onDestroy() {
      // На виході з програми жест «опустити руку» знову гасить екран.
      restoreWrist()
    }
  })
)
