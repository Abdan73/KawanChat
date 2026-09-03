/**
 * contacts.js
 * KawanChat — Local Address Book Manager
 *
 * Kontak disimpan HANYA di LocalStorage (KC_CONTACTS).
 * Backend TIDAK pernah menyimpan nama kontak.
 * Kontak diidentifikasi oleh nomor E.164.
 */

import { Storage } from './storage.js';
import { Auth } from './auth.js';

export const Contacts = {

  /**
   * Dapatkan semua kontak lokal.
   * @returns {Object} - { "+628xxx": { name: "..." }, ... }
   */
  getAll() {
    return Storage.getContacts();
  },

  /**
   * Dapatkan nama tampilan untuk nomor telepon.
   * Jika tidak ada nama → format nomor sebagai fallback.
   */
  getDisplayName(phone) {
    const name = Storage.getContactName(phone);
    if (name && name.trim()) return name.trim();
    return Auth.formatPhone(phone);
  },

  /**
   * Ambil inisial untuk avatar placeholder.
   */
  getInitials(phone) {
    const name = Storage.getContactName(phone);
    return Auth.getInitials(name || phone);
  },

  /**
   * Tambah atau update kontak.
   * @param {string} phone - Nomor E.164
   * @param {string} name  - Nama lokal (opsional)
   */
  upsert(phone, name = '') {
    Storage.setContact(phone, name.trim());
  },

  /**
   * Hapus kontak dari address book.
   * TIDAK menghapus histori chat.
   */
  remove(phone) {
    Storage.removeContact(phone);
  },

  /**
   * Cek apakah nomor ada di daftar kontak.
   */
  has(phone) {
    const contacts = Storage.getContacts();
    return phone in contacts;
  },

  /**
   * Dapatkan kontak yang sudah diurutkan (berdasarkan nama/nomor).
   * @returns {Array} - [{ phone, name, displayName, initials }, ...]
   */
  getSorted() {
    const contacts = Storage.getContacts();
    return Object.entries(contacts)
      .map(([phone, data]) => ({
        phone,
        name:        data.name || '',
        displayName: Contacts.getDisplayName(phone),
        initials:    Contacts.getInitials(phone),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'id', { sensitivity: 'base' }));
  },

  /**
   * Filter kontak berdasarkan query pencarian.
   */
  search(query) {
    if (!query || !query.trim()) return Contacts.getSorted();
    const q = query.trim().toLowerCase();
    return Contacts.getSorted().filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.phone.includes(q)
    );
  },

  /**
   * Dapatkan warna avatar berdasarkan nomor telepon (konsisten per kontak).
   */
  getAvatarColor(phone) {
    const colors = [
      'from-violet-400 to-purple-600',
      'from-blue-400 to-indigo-600',
      'from-emerald-400 to-teal-600',
      'from-amber-400 to-orange-500',
      'from-rose-400 to-red-600',
      'from-cyan-400 to-sky-600',
      'from-pink-400 to-fuchsia-600',
      'from-lime-400 to-green-600',
    ];
    let hash = 0;
    for (const char of (phone || '')) {
      hash = char.charCodeAt(0) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  },
};
