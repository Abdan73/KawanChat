/**
 * theme.js
 * KawanChat — Dark/Light Theme Manager
 *
 * Menggunakan Tailwind CSS `dark` class pada <html>.
 * Preferensi disimpan di KC_THEME (localStorage).
 */

import { Storage } from './storage.js';

export const Theme = {

  /**
   * Inisialisasi tema saat app load.
   * Harus dipanggil di awal sebelum render apapun.
   */
  init() {
    const saved = Storage.getTheme();
    if (saved === 'dark') {
      Theme.applyDark();
    } else if (saved === 'light') {
      Theme.applyLight();
    } else {
      // Auto detect dari system preference
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        Theme.applyDark();
      } else {
        Theme.applyLight();
      }
    }

    // Listen untuk perubahan system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e) => {
      const current = Storage.getTheme();
      // Hanya auto-switch jika user belum pilih manual
      if (!current) {
        e.matches ? Theme.applyDark() : Theme.applyLight();
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else {
      mediaQuery.addListener(handleSystemThemeChange);
    }
  },

  /**
   * Toggle antara dark dan light.
   */
  toggle() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      Theme.applyLight();
    } else {
      Theme.applyDark();
    }
    Theme._syncSettingsUI();
  },

  applyDark() {
    document.documentElement.classList.add('dark');
    Storage.setTheme('dark');
    Theme._syncSettingsUI();
  },

  applyLight() {
    document.documentElement.classList.remove('dark');
    Storage.setTheme('light');
    Theme._syncSettingsUI();
  },

  isDark() {
    return document.documentElement.classList.contains('dark');
  },

  /**
   * Sync UI elemen yang menampilkan state tema.
   */
  _syncSettingsUI() {
    const isDark = Theme.isDark();

    // Settings modal checkbox
    const settingsCheckbox = document.getElementById('settings-dark-mode');
    if (settingsCheckbox) settingsCheckbox.checked = isDark;

    // Setup screen theme button
    const moonIcon = document.getElementById('setup-theme-icon-moon');
    const sunIcon  = document.getElementById('setup-theme-icon-sun');
    const label    = document.getElementById('setup-theme-label');

    if (isDark) {
      moonIcon?.classList.add('hidden');
      sunIcon?.classList.remove('hidden');
      if (label) label.textContent = 'Mode Terang';
    } else {
      moonIcon?.classList.remove('hidden');
      sunIcon?.classList.add('hidden');
      if (label) label.textContent = 'Mode Gelap';
    }
  },
};
