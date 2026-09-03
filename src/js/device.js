/**
 * device.js
 * KawanChat — Device Identity Manager
 *
 * Mengelola Device ID dan Device Token.
 * Device ID dibuat sekali di browser menggunakan crypto.randomUUID().
 * Device Token diterima dari backend saat registrasi.
 */

import { Storage } from './storage.js';

export const Device = {

  /**
   * Dapatkan Device ID.
   * Jika belum ada, buat baru dan simpan.
   */
  getId() {
    let id = Storage.getDeviceId();
    if (!id) {
      id = crypto.randomUUID();
      Storage.setDeviceId(id);
    }
    return id;
  },

  /**
   * Paksa buat Device ID baru.
   * Digunakan saat: session lama dihapus dan user registrasi ulang.
   */
  generateNewId() {
    const id = crypto.randomUUID();
    Storage.setDeviceId(id);
    return id;
  },

  /**
   * Dapatkan Device Token dari storage.
   */
  getToken() {
    return Storage.getDeviceToken();
  },

  /**
   * Simpan Device Token yang diterima dari backend.
   */
  saveToken(token) {
    Storage.setDeviceToken(token);
  },

  /**
   * Cek apakah device sudah terdaftar (punya token).
   */
  isRegistered() {
    return !!Storage.getDeviceToken();
  },

  /**
   * Dapatkan semua credential device sekaligus.
   */
  getCredentials() {
    return {
      phone:       Storage.getPhone(),
      deviceId:    Device.getId(),
      deviceToken: Device.getToken(),
    };
  },

  /**
   * Hapus token saja (saat pairing inisiasi dari perangkat baru).
   * Device ID dipertahankan untuk identifikasi.
   */
  clearToken() {
    Storage.setDeviceToken(null);
  },

  /**
   * Format Device ID untuk tampilan (dipotong).
   */
  formatId(id) {
    if (!id) return '—';
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  },
};
