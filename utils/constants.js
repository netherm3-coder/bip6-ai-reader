// Кольори й розміри. Екран Bip 6: 390x450, AMOLED, кути з радіусом 86 px.

export const COLOR = {
  BG: 0x000000,
  TEXT: 0xffffff,
  TEXT_SOFT: 0xd8d8d8,
  TEXT_DIM: 0x9a9a9a,
  CARD: 0x1c1c1e,
  CARD_PRESS: 0x3a3a3c,
  LINE: 0x2c2c2e,
  ACCENT: 0x2f7ff5,
  ACCENT_PRESS: 0x1f5fc0,
  NEUTRAL: 0x2c2c2e,
  NEUTRAL_PRESS: 0x48484a,
  WARN: 0xff9f0a,
  CLAUDE: 0xd97757,
  GEMINI: 0x6c8cff
}

export const SOURCE_COLOR = {
  claude: COLOR.CLAUDE,
  gemini: COLOR.GEMINI
}

// Висота системного рядка стану на квадратних екранах (назва програми + час).
export const STATUS_BAR_H = 64

// Скільки символів показувати на годиннику (довше — лише на телефоні).
export const MAX_SHOWN = 12000

// Скільки найновіших текстів підвантажувати наперед після оновлення списку.
export const PREFETCH = 3

// Поки програма відкрита, екран не гасне сам. Запобіжник для батареї:
// згасне після 20 хв без жодного дотику.
export const SCREEN_ON_MS = 20 * 60 * 1000
