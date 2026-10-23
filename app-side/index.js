// Сервіс у застосунку Zepp на телефоні: на запит годинника забирає з GitHub
// відповіді й книги (книги — частинами по 8000 символів).

import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { createReader, statusText } from './github'
import { DEFAULT_REPO, SETTINGS_KEYS } from '../shared/config'

const reader = createReader({
  fetch: (opts) => fetch(opts),
  getToken: () => settingsLib.getItem(SETTINGS_KEYS.TOKEN),
  getRepo: () => settingsLib.getItem(SETTINGS_KEYS.REPO) || DEFAULT_REPO
})

function errorCode(e) {
  return (e && e.code) || 'network'
}

function runCheck() {
  return reader
    .check()
    .then((info) => settingsLib.setItem(SETTINGS_KEYS.STATUS, statusText(info, null)))
    .catch((e) => settingsLib.setItem(SETTINGS_KEYS.STATUS, statusText(null, errorCode(e))))
}

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      const method = req && req.method
      let task = null
      const params = (req && req.params) || {}
      if (method === 'list') task = reader.list()
      else if (method === 'get') task = reader.get(params.id)
      else if (method === 'books') task = reader.books()
      else if (method === 'bmeta') task = reader.bookMeta(params.id)
      else if (method === 'bpart') task = reader.bookPart(params.id, params.i, params.p)
      if (!task) {
        res(null, { error: 'unknown_method' })
        return
      }
      task.then((data) => res(null, data)).catch((e) => res(null, { error: errorCode(e) }))
    },

    onSettingsChange({ key }) {
      if (key === SETTINGS_KEYS.CHECK || key === SETTINGS_KEYS.TOKEN || key === SETTINGS_KEYS.REPO) runCheck()
    },

    onRun() {},

    onDestroy() {}
  })
)
