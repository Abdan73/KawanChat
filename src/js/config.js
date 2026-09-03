/**
 * config.js
 * KawanChat — Global Configuration
 *
 * IMPORTANT: Ganti GAS_API_URL dengan URL Web App Google Apps Script Anda
 * setelah melakukan deploy. Lihat README.md untuk panduan lengkap.
 */

export const Config = Object.freeze({

  // ─── Google Apps Script Web App URL ───────────────────────────────────────
  // Ganti dengan URL dari: Apps Script → Deploy → Web App → URL
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbyS7ZZvm8j8bSf5x_os9GW48koVBqnnN0l7fYXUsrG6cE66tyKa749xX-1S6ql2NS0I/exec',

  // ─── App Info ─────────────────────────────────────────────────────────────
  APP_NAME: 'KawanChat',
  APP_VERSION: '1.0.0',

  // ─── Polling ──────────────────────────────────────────────────────────────
  POLL_INTERVAL_ACTIVE_MS: 3500,   // 3.5s saat tab aktif
  POLL_INTERVAL_BACKGROUND_MS: 8000,   // 8s saat tab di background
  POLL_MAX_BACKOFF_MS: 30000,  // Max backoff 30s saat error beruntun
  POLL_BACKOFF_MULTIPLIER: 1.5,    // Faktor backoff

  // ─── API ──────────────────────────────────────────────────────────────────
  API_TIMEOUT_MS: 15000,  // 15s timeout per request
  API_MAX_RETRIES: 3,      // Max retry sebelum error
  API_RETRY_DELAY_MS: 1000,   // Delay awal retry

  // ─── Chat Storage ─────────────────────────────────────────────────────────
  MAX_MESSAGES_PER_CHAT: 1000,   // Batas pesan per chat di LocalStorage
  MAX_MESSAGE_LENGTH: 4000,   // Karakter maksimal per pesan

  // ─── Profile ──────────────────────────────────────────────────────────────
  PROFILE_PHOTO_MAX_PX: 300,    // Max dimensi foto profil (px)
  PROFILE_PHOTO_QUALITY: 0.75,   // JPEG quality (0–1)
  PROFILE_PHOTO_MAX_BYTES: 150000, // ~150KB max base64 setelah compress

  // ─── Pairing ──────────────────────────────────────────────────────────────
  PAIRING_POLL_INTERVAL_MS: 2000,   // Poll status pairing tiap 2s
  PAIRING_TOKEN_TTL_S: 300,    // 5 menit (dikontrol backend)

  // ─── Phone ────────────────────────────────────────────────────────────────
  DEFAULT_COUNTRY_CODE: '+62',

  // ─── LocalStorage Keys ────────────────────────────────────────────────────
  STORAGE_KEYS: {
    DEVICE_ID: 'KC_DEVICE_ID',
    DEVICE_TOKEN: 'KC_DEVICE_TOKEN',
    PHONE: 'KC_PHONE',
    THEME: 'KC_THEME',
    CONTACTS: 'KC_CONTACTS',
    AUDIO_ENABLED: 'KC_AUDIO_ENABLED',
    AUDIO_VOLUME: 'KC_AUDIO_VOLUME',
    AUDIO_SOUND: 'KC_AUDIO_SOUND',
    NOTIF_ENABLED: 'KC_NOTIF_ENABLED',
    CHAT_PREFIX: 'KC_CHAT_',
    PROFILE_PREFIX: 'KC_PROFILE_',
    PROFILE_VER_PFX: 'KC_PROFILE_VERSION_',
    LAST_SEEN_PFX: 'KC_LAST_SEEN_',
  },

  // ─── Emojis ───────────────────────────────────────────────────────────────
  EMOJI_LIST: [
    '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
    '😉', '😊', '😋', '😎', '😍', '🥰', '😘', '🤗',
    '🤔', '😐', '😑', '😶', '🙄', '😏', '😒', '🤨',
    '😔', '😪', '🥺', '😢', '😭', '😤', '😠', '😡',
    '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
    '😓', '🤫', '🤭', '😇', '🥳', '🤩', '🤑', '👍',
    '👎', '👋', '🤝', '👏', '🙌', '🤜', '🤛', '✊',
    '👊', '🖖', '✌️', '🤞', '💪', '🙏', '❤️', '💔',
    '💯', '🔥', '⭐', '✨', '💫', '🎉', '🎊', '🎈',
    '📱', '💬', '📨', '📩', '✉️', '📧', '🔔', '🔕',
  ],
});
