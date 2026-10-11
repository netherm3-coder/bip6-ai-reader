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

const dir = zeusDir()
if (!dir) {
  console.error('Zeus CLI не знайдено: npm install -g @zeppos/zeus-cli@1')
  process.exit(1)
}

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
