/**
 * profile.js
 * KawanChat — Profile Photo Manager
 *
 * Fitur:
 * - Upload dan kompres foto profil (Canvas, 300x300, quality 0.75)
 * - Profile versioning
 * - Local cache dengan version comparison
 * - Fetch profil kontak dari backend jika version berubah
 */

import { Api } from './api.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Config } from './config.js';

export const Profile = {

  // ─── Compress & Encode ────────────────────────────────────────────────────

  /**
   * Kompres gambar ke base64 JPEG (max 300x300, quality 0.75).
   * @param {File|Blob} file
   * @returns {Promise<string>} base64 string (tanpa data URI prefix)
   */
  compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const max    = Config.PROFILE_PHOTO_MAX_PX;

            let { width, height } = img;
            if (width > max || height > max) {
              const ratio = Math.min(max / width, max / height);
              width  = Math.round(width  * ratio);
              height = Math.round(height * ratio);
            }

            canvas.width  = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', Config.PROFILE_PHOTO_QUALITY);
            // Hapus prefix "data:image/jpeg;base64,"
            const base64  = dataUrl.split(',')[1];

            if (!base64) {
              reject(new Error('Kompresi gagal menghasilkan data.'));
              return;
            }

            // Cek ukuran
            if (base64.length > Config.PROFILE_PHOTO_MAX_BYTES * 1.4) {
              // Coba lagi dengan quality lebih rendah
              const dataUrl2 = canvas.toDataURL('image/jpeg', 0.5);
              const base64_2 = dataUrl2.split(',')[1];
              if (base64_2.length > Config.PROFILE_PHOTO_MAX_BYTES * 1.4) {
                reject(new Error('Foto terlalu besar setelah kompres. Pilih foto yang lebih kecil.'));
                return;
              }
              resolve(base64_2);
              return;
            }

            resolve(base64);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Gagal memuat gambar.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Gagal membaca file.'));
      reader.readAsDataURL(file);
    });
  },

  // ─── Upload Profile ───────────────────────────────────────────────────────

  /**
   * Upload foto profil ke backend.
   * @param {string|null} base64Photo  - Hasil compressImage() atau null jika hapus
   * @returns {Promise<object>}
   */
  async upload(base64Photo) {
    const { phone, deviceId, deviceToken } = Device.getCredentials();
    const profileVersion = Date.now().toString();

    const result = await Api.updateProfile({
      phone,
      deviceId,
      deviceToken,
      profilePhoto:    base64Photo,
      profileVersion,
    });

    if (result.success) {
      // Update cache lokal
      Storage.saveProfile(phone, base64Photo, profileVersion);
    }

    return result;
  },

  // ─── Get Profile (with versioning) ───────────────────────────────────────

  /**
   * Dapatkan foto profil kontak dengan caching berbasis version.
   * 1. Cek versi lokal vs backend
   * 2. Jika sama → gunakan cache
   * 3. Jika berbeda → fetch photo baru, simpan cache
   *
   * @param {string} targetPhone - Nomor E.164 target
   * @returns {Promise<string|null>} - base64 photo atau null
   */
  async getPhoto(targetPhone) {
    const myPhone = Storage.getPhone();

    // Cek versi dari backend
    let remoteVersion = null;
    try {
      const meta = await Api.getProfileMetadata({ phone: myPhone, targetPhone });
      if (meta.success) {
        remoteVersion = meta.data?.profileVersion || null;
      }
    } catch {
      // Offline → gunakan cache
      const cached = Storage.getProfile(targetPhone);
      return cached?.photo || null;
    }

    // Bandingkan dengan cache
    const localVersion = Storage.getProfileVersion(targetPhone);

    if (localVersion && localVersion === remoteVersion) {
      // Cache masih valid
      const cached = Storage.getProfile(targetPhone);
      return cached?.photo || null;
    }

    // Fetch foto baru
    if (!remoteVersion) {
      // User tidak punya foto
      Storage.saveProfile(targetPhone, null, 'none');
      return null;
    }

    try {
      const photoResult = await Api.getProfilePhoto({ phone: myPhone, targetPhone });
      if (photoResult.success) {
        const photo = photoResult.data?.profilePhoto || null;
        Storage.saveProfile(targetPhone, photo, remoteVersion);
        return photo;
      }
    } catch {
      // Fallback ke cache lama
      const cached = Storage.getProfile(targetPhone);
      return cached?.photo || null;
    }

    return null;
  },

  /**
   * Dapatkan foto profil sendiri dari cache lokal.
   */
  getMyPhoto() {
    const phone = Storage.getPhone();
    if (!phone) return null;
    const cached = Storage.getProfile(phone);
    return cached?.photo || null;
  },

  /**
   * Render foto ke <img> element.
   * Jika tidak ada → tampilkan fallback dengan initials.
   */
  renderToImg(imgEl, initialsEl, base64Photo, initials, colorClass) {
    if (base64Photo) {
      imgEl.src = 'data:image/jpeg;base64,' + base64Photo;
      imgEl.classList.remove('hidden');
      if (initialsEl) initialsEl.classList.add('hidden');
    } else {
      imgEl.classList.add('hidden');
      if (initialsEl) {
        initialsEl.textContent = initials || '?';
        initialsEl.classList.remove('hidden');
      }
      if (colorClass) {
        // Apply gradient color to parent
        const parent = imgEl.parentElement;
        if (parent) {
          parent.className = parent.className
            .replace(/from-\S+\s+to-\S+/g, '')
            .trim();
          parent.classList.add(...colorClass.split(' '));
        }
      }
    }
  },
};
