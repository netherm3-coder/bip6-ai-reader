#!/usr/bin/env node
// Збирає пакет у режимі preview — саме такі приймає сканер «Режиму розробника»
// в Zepp («Only preview packages are supported»). Без входу в Zepp і без
// завантаження на їхній сервер. Спершу має відпрацювати звичайний `zeus build`:
// він завантажує список пристроїв, без якого збірка не знайде Bip 6.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function zeusDir() {
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dir = path.join(root, '@zeppos', 'zeus-cli')
    if (fs.existsSync(path.join(dir, 'bin', 'main.js'))) return dir
  } catch (e) {}
  return null
}

// Zeus позначає пакет терміном дії 48 год (packageInfo.expiredTime = 172800 с).
// Через ~2 доби після встановлення з QR Zepp переставав запускати сервіс програми
// на телефоні, і годинник писав «Немає зв'язку з телефоном». Подовжуємо термін
// до 5 років (так, щоб час закінчення вміщався в 32-бітне число).
const LONG_EXPIRY = 5 * 365 * 24 * 3600

function patchExpiry(zeus) {
  const dirs = [path.join(zeus, 'node_modules', '@zeppos', 'zpm', 'lib'), path.join(zeus, '..', 'zpm', 'lib')]
  let patched = 0
  let already = 0
  dirs.forEach((d) => {
    let files = []
    try {
      files = fs.readdirSync(d).filter((f) => f.endsWith('.js'))
    } catch (e) {
      return
    }
    files.forEach((f) => {
      const file = path.join(d, f)
      const src = fs.readFileSync(file, 'utf8')
      if (src.indexOf('expiredTime=' + LONG_EXPIRY) >= 0) already++
      if (src.indexOf('expiredTime=172800') < 0) return
      fs.writeFileSync(file, src.split('expiredTime=172800').join('expiredTime=' + LONG_EXPIRY))
      patched++
    })
  })
  return patched + already
}

const dir = process.env.ZEUS_DIR || zeusDir()
if (!dir) {
  console.error('Zeus CLI не знайдено: npm install -g @zeppos/zeus-cli@1')
  process.exit(1)
}
if (patchExpiry(dir)) console.log('Термін дії preview-пакета: 5 років')
else console.log('::warning::Не вдалося подовжити термін дії preview-пакета (змінився Zeus?) — лишається 48 год.')

const project = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(project, 'app.json'), 'utf8'))
const sources = []
Object.values(app.targets || {}).forEach((t) =>
  (t.platforms || []).forEach((p) => {
    if (p.deviceSource && !sources.includes(Number(p.deviceSource))) sources.push(Number(p.deviceSource))
  })
)

process.chdir(project)
const { buildSupportV3Config } = require(path.join(dir, 'private-modules/zeppos-app-utils/dist/modules/build.js'))

buildSupportV3Config(project, 'preview', { sources, renameWithAppId: app.app.appId })
  .then((name) => {
    if (!name) process.exit(1)
    console.log('Preview-пакет: dist/' + name)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
