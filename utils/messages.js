// Тексти помилок для екрана годинника (до двох рядків).

const MESSAGES = {
  no_token: 'Немає токена. Zepp → AI Читалка → Налаштування.',
  bad_repo: 'Неправильний репозиторій у налаштуваннях Zepp.',
  unauthorized: 'Токен GitHub недійсний. Заміни в налаштуваннях Zepp.',
  forbidden: 'Токен без доступу до репозиторію.',
  not_found: 'Список не знайдено. Перевір налаштування в Zepp.',
  rate_limited: 'GitHub обмежив запити. Спробуй пізніше.',
  network: 'Телефон без інтернету.',
  timeout: 'GitHub не відповів. Спробуй ще раз.',
  server: 'Помилка GitHub. Спробуй пізніше.',
  bad_data: 'Пошкоджений список на GitHub.',
  bad_id: 'Неправильний запит.',
  ble: "Годинник не з'єднаний з телефоном.",
  side_off: 'Zepp не відповідає — відкрий його на телефоні.',
  phone_timeout: 'Телефон не відповів. Zepp запущений?',
  book_data: 'Книга на телефоні пошкоджена або змінилася.',
  nospace: 'Мало місця на годиннику.'
}

export function errorMessage(code) {
  return MESSAGES[code] || 'Не вдалося оновити (' + code + ').'
}

// Помилки бібліотеки обміну з телефоном (zml) → коди вище:
//   2 «ble disconnect» — годинник не з'єднаний з телефоном;
//   1 «shake timeout», 3 «side service is not running» — Zepp не запустив сервіс програми;
//   4 / timeout — запит пішов, але відповіді не дочекалися.
export function bleCode(err) {
  const text = String((err && (err.message || err.msg)) || err || '').toLowerCase()
  const code = err && err.code
  if (code === 4 || text.indexOf('request id') >= 0 || (text.indexOf('timeout') >= 0 && text.indexOf('shake') < 0)) {
    return 'phone_timeout'
  }
  if (code === 2 || text.indexOf('ble disconnect') >= 0) return 'ble'
  return 'side_off'
}

// Чи варто повторити: зв'язок міг ще не встановитися (Zepp прокидається).
export function transient(code) {
  return code === 'ble' || code === 'side_off' || code === 'phone_timeout'
}
