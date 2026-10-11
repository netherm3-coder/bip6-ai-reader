// Сторінка налаштувань програми в застосунку Zepp (на телефоні).

import { DEFAULT_REPO, SETTINGS_KEYS } from '../shared/config'

function masked(token) {
  if (!token) return ''
  return 'збережено: …' + token.slice(-4)
}

const textStyle = { fontSize: '14px', color: '#666', lineHeight: '20px', marginTop: '6px' }
const headStyle = { fontSize: '16px', fontWeight: 'bold', color: '#222', marginTop: '18px' }

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const token = storage.getItem(SETTINGS_KEYS.TOKEN) || ''
    const repo = storage.getItem(SETTINGS_KEYS.REPO) || DEFAULT_REPO
    const status = storage.getItem(SETTINGS_KEYS.STATUS) || ''

    return View({ style: { padding: '12px 20px 24px' } }, [
      Text({ style: { fontSize: '20px', fontWeight: 'bold', color: '#111' } }, 'AI Читалка'),
      Text(
        { style: textStyle },
        'Годинник показує відповіді Claude і Gemini, які ти надіслав зі сторінки «На годинник» на телефоні.'
      ),

      Text({ style: headStyle }, '1. Токен GitHub'),
      TextInput({
        label: token ? 'Токен (' + masked(token) + ')' : 'Токен GitHub',
        value: '',
        placeholder: token ? 'Встав новий, щоб замінити' : 'github_pat_…',
        onChange: (value) => {
          const v = String(value || '').trim()
          if (v) storage.setItem(SETTINGS_KEYS.TOKEN, v)
        }
      }),
      Text({ style: textStyle }, 'Той самий токен, що й на сторінці «На годинник».'),

      Text({ style: headStyle }, '2. Приватний репозиторій'),
      TextInput({
        label: 'Репозиторій',
        value: repo,
        onChange: (value) => {
          const v = String(value || '')
            .trim()
            .replace(/^https?:\/\/github\.com\//, '')
            .replace(/\/+$/, '')
          storage.setItem(SETTINGS_KEYS.REPO, v || DEFAULT_REPO)
        }
      }),

      View({ style: { marginTop: '18px' } }, [
        Button({
          label: 'Перевірити зв\'язок',
          style: { fontSize: '15px', borderRadius: '24px', background: '#2f7ff5', color: 'white', padding: '0 18px' },
          onClick: () => storage.setItem(SETTINGS_KEYS.CHECK, String(Date.now()))
        })
      ]),
      Text({ style: { fontSize: '15px', color: '#222', lineHeight: '22px', marginTop: '10px' } }, status || 'Ще не перевірено.')
    ])
  }
})
