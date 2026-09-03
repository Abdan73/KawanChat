/**
 * api.js
 * KawanChat — API Client
 *
 * Semua komunikasi frontend → Google Apps Script melalui modul ini.
 * Menggunakan fetch() dengan timeout, retry, dan exponential backoff.
 */

import { Config } from './config.js';

// ─── Internal: sleep helper ──────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Internal: fetch with timeout ────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = Config.API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('REQUEST_TIMEOUT', 'Request timed out. Periksa koneksi Anda.', 0);
    }
    throw err;
  }
}

// ─── Custom Error class ───────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(code, message, httpStatus = 0) {
    super(message);
    this.name  = 'ApiError';
    this.code  = code;
    this.httpStatus = httpStatus;
  }
}

// ─── API Module ───────────────────────────────────────────────────────────────
export const Api = {

  /**
   * request(action, data, options)
   *
   * Kirim POST request ke Google Apps Script Web App.
   *
   * @param {string} action   - Nama action (e.g. 'sendMessage')
   * @param {object} data     - Payload tambahan
   * @param {object} options  - { retries, noRetry }
   * @returns {Promise<object>} - Response data dari GAS
   */
  async request(action, data = {}, options = {}) {
    const {
      retries = Config.API_MAX_RETRIES,
      noRetry = false,
    } = options;

    const payload = { action, ...data };
    let attempt  = 0;
    let lastErr  = null;

    while (attempt <= (noRetry ? 0 : retries)) {
      try {
        // Backoff pada retry (kecuali percobaan pertama)
        if (attempt > 0) {
          const delay = Config.API_RETRY_DELAY_MS * Math.pow(1.8, attempt - 1);
          await sleep(Math.min(delay, 10000));
        }

        const response = await fetchWithTimeout(
          Config.GAS_API_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
          },
          Config.API_TIMEOUT_MS
        );

        // GAS kadang redirect (302) atau mengembalikan text HTML pada error
        if (!response.ok && response.status !== 302) {
          throw new ApiError(
            'HTTP_ERROR',
            `Server error: ${response.status} ${response.statusText}`,
            response.status
          );
        }

        // Parse JSON
        let result;
        try {
          const text = await response.text();
          result = JSON.parse(text);
        } catch {
          throw new ApiError('INVALID_JSON', 'Response bukan JSON yang valid.', response.status);
        }

        // Validasi struktur response
        if (typeof result.success !== 'boolean') {
          throw new ApiError('INVALID_RESPONSE', 'Struktur response tidak dikenal.');
        }

        // Return result (sukses maupun gagal; caller yang handle)
        return result;

      } catch (err) {
        lastErr = err;

        // Jangan retry jika:
        // - noRetry true
        // - Error bukan masalah jaringan (misal invalid response)
        // - Sudah mencapai batas retry
        if (
          noRetry ||
          (err instanceof ApiError && ['INVALID_JSON', 'INVALID_RESPONSE'].includes(err.code)) ||
          attempt >= retries
        ) {
          break;
        }

        attempt++;
        console.warn(`[API] Retry ${attempt}/${retries} for action "${action}":`, err.message);
      }
    }

    // Semua retry gagal
    if (lastErr instanceof ApiError) throw lastErr;

    // Network / unknown error
    throw new ApiError(
      'NETWORK_ERROR',
      lastErr?.message || 'Tidak dapat terhubung ke server. Periksa koneksi internet.',
      0
    );
  },

  /**
   * Shorthand helpers untuk action umum.
   * Semua method di bawah memanggil Api.request() di belakangnya.
   */

  async setupDatabase() {
    return Api.request('setupDatabase', {}, { noRetry: false });
  },

  async registerDevice({ phone, deviceId }) {
    return Api.request('registerDevice', { phone, deviceId });
  },

  async validateDevice({ phone, deviceId, deviceToken }) {
    return Api.request('validateDevice', { phone, deviceId, deviceToken }, { noRetry: true });
  },

  async getDeviceStatus({ phone, deviceId, deviceToken }) {
    return Api.request('getDeviceStatus', { phone, deviceId, deviceToken }, { noRetry: true });
  },

  async createPairing({ phone, deviceId, deviceToken }) {
    return Api.request('createPairing', { phone, deviceId, deviceToken });
  },

  async getPairingStatus({ pairingId, phone, deviceId, deviceToken }) {
    return Api.request('getPairingStatus', { pairingId, phone, deviceId, deviceToken }, { noRetry: true });
  },

  async scanPairingToken({ phone, deviceId, token }) {
    return Api.request('scanPairingToken', { phone, deviceId, token });
  },

  async approvePairing({ pairingId, phone, deviceId, deviceToken }) {
    return Api.request('approvePairing', { pairingId, phone, deviceId, deviceToken });
  },

  async rejectPairing({ pairingId, phone, deviceId, deviceToken }) {
    return Api.request('rejectPairing', { pairingId, phone, deviceId, deviceToken });
  },

  async completePairing({ pairingId, phone, newDeviceId, token }) {
    return Api.request('completePairing', { pairingId, phone, newDeviceId, token });
  },

  async sendMessage({ phone, deviceId, deviceToken, to, message, profileVersion }) {
    return Api.request('sendMessage', { phone, deviceId, deviceToken, to, message, profileVersion }, { noRetry: false });
  },

  async pollMessages({ phone, deviceId, deviceToken }) {
    return Api.request('pollMessages', { phone, deviceId, deviceToken }, { noRetry: true, retries: 1 });
  },

  async acknowledgeMessages({ phone, deviceId, deviceToken, messageIds }) {
    return Api.request('acknowledgeMessages', { phone, deviceId, deviceToken, messageIds });
  },

  async getProfileMetadata({ phone, targetPhone }) {
    return Api.request('getProfileMetadata', { phone, targetPhone }, { noRetry: true });
  },

  async getProfilePhoto({ phone, targetPhone }) {
    return Api.request('getProfilePhoto', { phone, targetPhone }, { noRetry: true });
  },

  async updateProfile({ phone, deviceId, deviceToken, profilePhoto, profileVersion }) {
    return Api.request('updateProfile', { phone, deviceId, deviceToken, profilePhoto, profileVersion });
  },
};
