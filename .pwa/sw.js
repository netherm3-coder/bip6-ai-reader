// Кешує оболонку сторінки, щоб вона відкривалася швидко й без мережі.
// Запити до GitHub API не кешуються.

const CACHE = 'na-hodynnyk-v3'
const SHELL = ['./', 'index.html', 'app.js', 'clean.js', 'github.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
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
