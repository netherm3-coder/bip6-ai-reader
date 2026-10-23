// Кешує оболонку сторінки й конвертер книг, щоб вона відкривалася швидко й без мережі.
// Запити до GitHub API не кешуються. Приймає «Поділитися» з інших програм (POST ./share):
// текст відповіді AI або файл книги кладе в окремий кеш і відкриває сторінку.

const CACHE = 'na-hodynnyk-v5'
// Поділене з іншої програми лежить тут, поки сторінка його не забере.
const SHARE_CACHE = 'na-hodynnyk-share'
// pdf.js (vendor/pdf*.js, ~1,8 МБ) не тут: кешується, коли вперше знадобиться.
const SHELL = [
  './',
  'index.html',
  'app.js',
  'clean.js',
  'github.js',
  'books-ui.js',
  'convert/index.js',
  'convert/text.js',
  'convert/xml.js',
  'convert/html.js',
  'convert/epub.js',
  'convert/fb2.js',
  'convert/txt.js',
  'convert/docx.js',
  'convert/pdf.js',
  'vendor/unzip.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method === 'POST' && url.origin === self.location.origin && /\/share$/.test(url.pathname)) {
    event.respondWith(takeShare(req))
    return
  }
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  // Спершу мережа (щоб оновлення доходили), без мережі — кеш.
  // Запит із параметрами «Поділитися» віддаємо з кешу сторінки без параметрів.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && !url.search) {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  )
})

// «Поділитися»: файл книги → вкладка «Книги»; текст → як відповідь AI. У кеші, а не
// в адресі сторінки, бо довгий текст в адресі сервер може не прийняти.
async function takeShare(req) {
  const home = new URL('./', self.location.href)
  const go = (query) => Response.redirect(new URL('./' + (query ? '?' + query : ''), home).href, 303)
  let form = null
  try {
    form = await req.formData()
  } catch (e) {
    return go('')
  }
  const file = form.get('book')
  if (file && typeof file === 'object' && file.size > 0) {
    try {
      const cache = await caches.open(SHARE_CACHE)
      const headers = { 'X-Name': encodeURIComponent(file.name || 'book') }
      await cache.put(new URL('__shared-book', home).href, new Response(file, { headers }))
      return go('shared=book')
    } catch (e) {
      return go('shared=failed')
    }
  }
  const data = {}
  ;['title', 'text', 'url'].forEach((k) => {
    const v = form.get(k)
    if (typeof v === 'string' && v) data[k] = v
  })
  if (!data.title && !data.text && !data.url) return go('')
  try {
    const cache = await caches.open(SHARE_CACHE)
    const headers = { 'Content-Type': 'application/json' }
    await cache.put(new URL('__shared-text', home).href, new Response(JSON.stringify(data), { headers }))
    return go('shared=text')
  } catch (e) {
    return go(new URLSearchParams(data).toString())
  }
}
