/**
 * polling.js
 * KawanChat — Smart Message Polling
 *
 * Fitur:
 * - Poll pesan baru tiap 3.5s (aktif) / 8s (background)
 * - Tidak ada request overlap
 * - Exponential backoff saat error beruntun
 * - Visibility API untuk deteksi tab aktif/background
 * - Auto-stop jika device revoked
 * - ACK setelah terima + simpan
 */

import { Api } from './api.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Chat } from './chat.js';
import { Profile } from './profile.js';
import { Notifications } from './notifications.js';
import { Contacts } from './contacts.js';
import { Config } from './config.js';

// ─── Internal state ───────────────────────────────────────────────────────────
let _pollTimer      = null;
let _isPolling      = false;
let _isRunning      = false;
let _errorCount     = 0;
let _currentDelay   = Config.POLL_INTERVAL_ACTIVE_MS;
let _onRevoked      = null;
let _onNewMessages  = null;

export const Polling = {

  /**
   * Mulai polling.
   * @param {Function} onRevoked      - Dipanggil jika device dicabut
   * @param {Function} onNewMessages  - Dipanggil setelah pesan baru masuk (untuk update UI sidebar)
   */
  start(onRevoked, onNewMessages) {
    if (_isRunning) return;
    _isRunning     = true;
    _onRevoked     = onRevoked;
    _onNewMessages = onNewMessages;
    _errorCount    = 0;

    // Visibility API
    document.addEventListener('visibilitychange', Polling._onVisibilityChange);

    Polling._schedule(100); // Mulai segera
  },

  stop() {
    _isRunning = false;
    if (_pollTimer) {
      clearTimeout(_pollTimer);
      _pollTimer = null;
    }
    document.removeEventListener('visibilitychange', Polling._onVisibilityChange);
  },

  isRunning() { return _isRunning; },

  _onVisibilityChange() {
    if (!_isRunning) return;
    if (document.visibilityState === 'visible') {
      // Tab kembali aktif → poll segera
      if (_pollTimer) clearTimeout(_pollTimer);
      _currentDelay = Config.POLL_INTERVAL_ACTIVE_MS;
      Polling._schedule(200);
    }
  },

  _schedule(delayMs) {
    if (_pollTimer) clearTimeout(_pollTimer);
    _pollTimer = setTimeout(Polling._doPoll, delayMs);
  },

  async _doPoll() {
    if (!_isRunning) return;
    if (_isPolling) {
      // Request sebelumnya masih jalan → skip, jadwalkan berikutnya
      Polling._scheduleNext();
      return;
    }

    if (!Storage.hasSession()) {
      Polling.stop();
      return;
    }

    _isPolling = true;

    try {
      const { phone, deviceId, deviceToken } = Device.getCredentials();
      const result = await Api.pollMessages({ phone, deviceId, deviceToken });

      if (!result.success) {
        // Cek apakah device dicabut
        if (result.code === 'DEVICE_REVOKED' || result.code === 'INVALID_TOKEN') {
          Polling.stop();
          if (_onRevoked) _onRevoked();
          return;
        }
        throw new Error(result.message || 'Poll failed');
      }

      // Reset error counter
      _errorCount   = 0;
      _currentDelay = Polling._getInterval();

      const messages = result.data?.messages || [];
      if (messages.length > 0) {
        await Polling._processMessages(messages);
      }

    } catch (err) {
      _errorCount++;
      console.warn(`[Polling] Error #${_errorCount}:`, err.message);
      // Exponential backoff
      _currentDelay = Math.min(
        Config.POLL_INTERVAL_ACTIVE_MS * Math.pow(Config.POLL_BACKOFF_MULTIPLIER, _errorCount),
        Config.POLL_MAX_BACKOFF_MS
      );
    } finally {
      _isPolling = false;
      if (_isRunning) {
        Polling._scheduleNext();
      }
    }
  },

  _scheduleNext() {
    const interval = _currentDelay || Polling._getInterval();
    Polling._schedule(interval);
  },

  _getInterval() {
    return document.visibilityState === 'visible'
      ? Config.POLL_INTERVAL_ACTIVE_MS
      : Config.POLL_INTERVAL_BACKGROUND_MS;
  },

  async _processMessages(messages) {
    const myPhone = Storage.getPhone();

    // Terima dan simpan pesan ke LocalStorage
    const ackedIds = Chat.receiveMessages(messages);

    // ACK ke backend
    if (ackedIds.length > 0) {
      const { phone, deviceId, deviceToken } = Device.getCredentials();
      try {
        await Api.acknowledgeMessages({ phone, deviceId, deviceToken, messageIds: ackedIds });
      } catch {
        // ACK gagal → tidak apa-apa, backend akan retry
      }
    }

    // Kirim notifikasi untuk pesan baru
    for (const msg of messages) {
      if (!ackedIds.includes(msg.id)) continue; // Sudah ada di storage

      const fromPhone   = msg.fromPhone;
      const contactName = Contacts.getDisplayName(fromPhone);

      // Notifikasi browser + audio
      Notifications.notifyNewMessage(contactName, msg.payload || msg.text || '', fromPhone);

      // Fetch profil jika versi berubah (non-blocking)
      if (msg.profileVersion) {
        const cachedVer = Storage.getProfileVersion(fromPhone);
        if (cachedVer !== msg.profileVersion) {
          Profile.getPhoto(fromPhone).then(() => {
            // Update avatar di contact list
            if (_onNewMessages) _onNewMessages(fromPhone);
          }).catch(() => {});
        }
      }
    }

    // Update sidebar contact list
    if (_onNewMessages && ackedIds.length > 0) {
      _onNewMessages();
    }
  },
};
