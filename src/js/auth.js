/**
 * auth.js
 * KawanChat — Authentication & Phone Normalization
 *
 * Mengelola:
 * - Normalisasi nomor telepon ke E.164
 * - Registrasi device baru
 * - Validasi device yang sudah terdaftar
 * - Session management
 */

import { Api, ApiError } from './api.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Config } from './config.js';

export const Auth = {

  // ─── Phone Normalization ──────────────────────────────────────────────────

  /**
   * Normalisasi nomor telepon ke format E.164.
   *
   * Contoh:
   *   ("08123456789", "+62") → "+628123456789"
   *   ("+628123456789", "+62") → "+628123456789"
   *   ("8123456789", "+62") → "+628123456789"
   *
   * @param {string} phoneInput   - Input dari user
   * @param {string} countryCode  - Kode negara (default "+62")
   * @returns {string} - Nomor E.164
   * @throws {Error} - Jika format tidak valid
   */
  normalizePhone(phoneInput, countryCode = Config.DEFAULT_COUNTRY_CODE) {
    if (typeof phoneInput !== 'string') {
      throw new Error('Nomor telepon harus berupa teks.');
    }

    // Hapus semua karakter non-digit kecuali leading "+"
    let cleaned = phoneInput.trim();

    // Jika sudah E.164 (dimulai +)
    if (cleaned.startsWith('+')) {
      // Hapus semua non-digit setelah +
      const digits = cleaned.slice(1).replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        throw new Error('Nomor telepon tidak valid (7–15 digit).');
      }
      return '+' + digits;
    }

    // Hapus semua non-digit
    const digits = cleaned.replace(/\D/g, '');

    if (digits.length < 5) {
      throw new Error('Nomor telepon terlalu pendek.');
    }

    // Hapus leading 0 jika ada
    const withoutLeadingZero = digits.startsWith('0') ? digits.slice(1) : digits;

    // Gabungkan dengan country code
    const codeDigits = countryCode.replace(/\D/g, '');
    const result = '+' + codeDigits + withoutLeadingZero;

    // Validasi panjang E.164 (7–15 digit setelah +)
    const totalDigits = codeDigits.length + withoutLeadingZero.length;
    if (totalDigits < 7 || totalDigits > 15) {
      throw new Error('Nomor telepon tidak valid. Periksa kembali nomor Anda.');
    }

    return result;
  },

  /**
   * Format nomor E.164 untuk tampilan.
   * Contoh: "+628123456789" → "+62 812-3456-789"
   */
  formatPhone(e164) {
    if (!e164 || !e164.startsWith('+')) return e164 || '';
    const digits = e164.slice(1);
    // Pisahkan kode negara (asumsi 2-3 digit) dan nomor
    const match = digits.match(/^(\d{1,3})(\d{3,4})(\d{3,4})(\d*)$/);
    if (match) {
      const parts = ['+' + match[1], match[2], match[3], match[4]].filter(Boolean);
      return parts.join(' ');
    }
    return e164;
  },

  /**
   * Ambil inisial dari nomor telepon untuk avatar placeholder.
   */
  getInitials(nameOrPhone) {
    if (!nameOrPhone) return '?';
    if (nameOrPhone.startsWith('+')) {
      // Gunakan 2 digit terakhir
      return nameOrPhone.slice(-2);
    }
    const words = nameOrPhone.trim().split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return nameOrPhone.substring(0, 2).toUpperCase();
  },

  // ─── Session Check ────────────────────────────────────────────────────────

  /**
   * Cek apakah user sudah punya session lokal yang lengkap.
   */
  hasLocalSession() {
    return Storage.hasSession();
  },

  /**
   * Validasi session lokal dengan backend.
   * Returns: { valid: bool, status: string, ... }
   */
  async validateSession() {
    if (!Storage.hasSession()) {
      return { valid: false, reason: 'NO_LOCAL_SESSION' };
    }
    const { phone, deviceId, deviceToken } = Device.getCredentials();
    try {
      const result = await Api.validateDevice({ phone, deviceId, deviceToken });
      if (result.success) {
        return { valid: true, data: result.data };
      } else {
        return { valid: false, reason: result.code, message: result.message };
      }
    } catch (err) {
      // Network error → anggap valid sementara (offline-first)
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        return { valid: true, offline: true };
      }
      return { valid: false, reason: 'VALIDATION_ERROR', message: err.message };
    }
  },

  // ─── Registration ─────────────────────────────────────────────────────────

  /**
   * Daftarkan device baru.
   * Backend akan:
   * - Membuat user baru jika phone belum terdaftar
   * - Mengembalikan DEVICE_CONFLICT jika phone sudah aktif di device lain
   *
   * @param {string} phone    - Nomor E.164
   * @param {string} deviceId - Device ID browser
   * @returns {object} - { success, code, data: { deviceToken, isNewUser } }
   */
  async register(phone, deviceId) {
    return Api.registerDevice({ phone, deviceId });
  },

  // ─── Login Flow ───────────────────────────────────────────────────────────

  /**
   * Login dengan nomor telepon.
   * Menangani:
   * 1. User baru → registrasi
   * 2. Device yang sama → re-validate dan restore token
   * 3. Device berbeda → DEVICE_CONFLICT
   *
   * @returns {object} - { status: 'registered'|'existing'|'conflict', ... }
   */
  async login(phoneInput, countryCode) {
    const phone    = Auth.normalizePhone(phoneInput, countryCode);
    const deviceId = Device.getId();

    // Simpan phone dulu untuk referensi
    Storage.setPhone(phone);

    const result = await Auth.register(phone, deviceId);

    if (result.success) {
      // Berhasil daftar/login
      const { deviceToken, isNewUser } = result.data || {};
      if (deviceToken) {
        Device.saveToken(deviceToken);
      }
      return {
        status:    isNewUser ? 'registered' : 'existing',
        phone,
        deviceId,
        deviceToken,
        isNewUser: !!isNewUser,
      };
    }

    // Device conflict — phone sudah terdaftar di device lain
    if (result.code === 'DEVICE_CONFLICT') {
      return {
        status:  'conflict',
        phone,
        deviceId,
        message: result.message,
      };
    }

    // Error lain
    throw new Error(result.message || 'Registrasi gagal. Coba lagi.');
  },

  // ─── Logout / Clear ───────────────────────────────────────────────────────

  logout() {
    Storage.clearSession();
    // Buat Device ID baru agar perangkat ini bisa didaftarkan ulang
    Device.generateNewId();
  },
};
