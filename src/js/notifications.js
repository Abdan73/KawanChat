/**
 * notifications.js
 * KawanChat — Notification & Audio Manager
 *
 * Fitur:
 * - HTML5 Notification API untuk browser notifications
 * - Web Audio API untuk tone notifikasi
 * - Fallback ke HTMLAudioElement
 * - Penanganan autoplay restriction
 * - Volume control
 * - Setting lokal (tidak dikirim ke server)
 */

import { Storage } from './storage.js';

// ─── Audio Context (shared) ───────────────────────────────────────────────────
let _audioCtx    = null;
let _userGesture = false; // Apakah user sudah berinteraksi (unlock autoplay)

function getAudioCtx() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return _audioCtx;
}

// ─── Unlock audio pada interaksi pertama ─────────────────────────────────────
function unlockAudio() {
  if (_userGesture) return;
  _userGesture = true;
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// Pasang event listener sekali
['click', 'keydown', 'touchstart', 'pointerdown'].forEach((evt) => {
  document.addEventListener(evt, unlockAudio, { once: false, passive: true });
});

// ─── Notification Module ──────────────────────────────────────────────────────
export const Notifications = {

  // ─── Permission ───────────────────────────────────────────────────────────

  async requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    const result = await Notification.requestPermission();
    return result;
  },

  getPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  },

  // ─── Notify New Message ───────────────────────────────────────────────────

  /**
   * Tampilkan notifikasi pesan baru.
   * @param {string} senderName  - Nama kontak (lokal)
   * @param {string} messageText - Preview teks pesan
   * @param {string} senderPhone - Nomor pengirim (untuk klik notifikasi → buka chat)
   */
  notifyNewMessage(senderName, messageText, senderPhone) {
    // Jangan notifikasi jika tab aktif dan chat sedang dibuka dengan pengirim ini
    if (
      document.visibilityState === 'visible' &&
      document.querySelector('#screen-main:not(.hidden)') &&
      document.querySelector('#chat-view:not(.hidden)') &&
      document.querySelector('#chat-header-phone')?.textContent === senderPhone
    ) {
      // Hanya play audio, tidak tampilkan notifikasi
      Notifications.playSound();
      return;
    }

    // Play audio
    Notifications.playSound();

    // Browser Notification
    if (!Storage.getNotifEnabled()) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const preview = messageText.length > 60
      ? messageText.substring(0, 60) + '…'
      : messageText;

    const notif = new Notification('KawanChat', {
      body:    `${senderName}: ${preview}`,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/badge-72.png',
      tag:     'kc-msg-' + senderPhone,  // replace previous notif dari same contact
      renotify: true,
      silent:  false,
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
      // Dispatch custom event untuk membuka chat
      window.dispatchEvent(
        new CustomEvent('kc:openChat', { detail: { phone: senderPhone } })
      );
    };

    // Auto close setelah 5 detik
    setTimeout(() => notif.close(), 5000);
  },

  // ─── Audio ────────────────────────────────────────────────────────────────

  /**
   * Play suara notifikasi.
   * Menggunakan Web Audio API untuk generate tone singkat.
   */
  playSound() {
    if (!Storage.getAudioEnabled()) return;

    const volume = (Storage.getAudioVolume() || 70) / 100;

    // Coba Web Audio API dulu
    if (_userGesture) {
      Notifications._playWebAudioTone(volume);
    }
    // Jika belum ada user gesture, suara tidak bisa diputar (browser restriction)
  },

  /**
   * Generate notifikasi tone menggunakan Web Audio API.
   * Tone: dua nada pendek (seperti WhatsApp/Telegram style).
   */
  _playWebAudioTone(volume) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now  = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Nada pertama (440Hz = A4)
    const osc1 = ctx.createOscillator();
    osc1.type      = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(volume * 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Nada kedua (660Hz = E5), sedikit delay
    const gain2 = ctx.createGain();
    gain2.connect(ctx.destination);
    const osc2 = ctx.createOscillator();
    osc2.type      = 'sine';
    osc2.frequency.setValueAtTime(1100, now + 0.14);
    gain2.gain.setValueAtTime(volume * 0.2, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.28);
  },

  /**
   * Test suara (dari settings).
   */
  testSound() {
    _userGesture = true; // Settings button = user gesture
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => Notifications.playSound()).catch(() => {});
    } else {
      Notifications.playSound();
    }
  },

  // ─── Settings helpers ────────────────────────────────────────────────────

  setEnabled(val) {
    Storage.setAudioEnabled(!!val);
  },

  setVolume(vol) {
    Storage.setAudioVolume(Number(vol));
  },

  setNotifEnabled(val) {
    Storage.setNotifEnabled(!!val);
    if (val && 'Notification' in window && Notification.permission === 'default') {
      Notifications.requestPermission();
    }
  },
};
