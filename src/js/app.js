/**
 * app.js
 * KawanChat — Main Application Orchestrator
 *
 * Entry point untuk seluruh aplikasi.
 * Mengelola:
 * - Screen routing
 * - Event binding
 * - Application state
 * - UI rendering
 * - Modal management
 * - Toast system
 */

import '../css/style.css';

import { Config } from './config.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Auth } from './auth.js';
import { Pairing } from './pairing.js';
import { Contacts } from './contacts.js';
import { Chat } from './chat.js';
import { Polling } from './polling.js';
import { Profile } from './profile.js';
import { Notifications } from './notifications.js';
import { Theme } from './theme.js';

let _scanPollTimer = null;
let _pollingIndicatorTimer = null;
let _openChatListenerBound = false;

// Load jsQR dinamis (untuk QR scanning fallback)
import('jsqr').then((mod) => {
  window._jsQR = mod.default || mod;
}).catch(() => {
  console.warn('[App] jsQR not loaded. BarcodeDetector will be used if available.');
});

// ─── Screen Router ────────────────────────────────────────────────────────────
const SCREENS = [
  'screen-setup',
  'screen-existing-device',
  'screen-pairing',
  'screen-revoked',
  'screen-profile-setup',
  'screen-main',
];

function showScreen(screenId) {
  SCREENS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === screenId) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

// ─── Toast System ─────────────────────────────────────────────────────────────
function showToast(message, type = 'info', durationMs = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
    warning: '⚠',
  };

  const toast = document.createElement('div');
  toast.className = `kc-toast kc-toast-${type}`;
  const icon = document.createElement('span');
  icon.className = 'text-base font-bold';
  icon.textContent = icons[type] || 'ℹ';
  const content = document.createElement('span');
  content.className = 'flex-1';
  content.textContent = message;
  const close = document.createElement('button');
  close.className = 'opacity-70 hover:opacity-100 ml-2 text-lg leading-none';
  close.type = 'button';
  close.setAttribute('aria-label', 'Tutup notifikasi');
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(icon, content, close);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

window.addEventListener('kc:toast', (event) => {
  const detail = event.detail || {};
  showToast(detail.message || 'Terjadi kesalahan.', detail.type || 'error');
});

// ─── Modal Manager ────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('kc-modal-overlay')) {
    e.target.classList.add('hidden');
  }
});

// Close buttons
document.querySelectorAll('.modal-close-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modal;
    if (modalId) closeModal(modalId);
  });
});

// ─── Loading states ───────────────────────────────────────────────────────────
function setLoading(btnId, textId, loadingId, isLoading) {
  const btn     = document.getElementById(btnId);
  const textEl  = document.getElementById(textId);
  const loadEl  = document.getElementById(loadingId);
  if (btn)    btn.disabled = isLoading;
  if (textEl) textEl.classList.toggle('hidden', isLoading);
  if (loadEl) loadEl.classList.toggle('hidden', !isLoading);
}

// ─── Sidebar Rendering ────────────────────────────────────────────────────────
function renderContactList(query = '') {
  const listEl    = document.getElementById('contact-list-items');
  const emptyEl   = document.getElementById('contact-list-empty');
  if (!listEl || !emptyEl) return;

  const contacts = query ? Contacts.search(query) : Contacts.getSorted();

  if (contacts.length === 0) {
    listEl.innerHTML  = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  const myPhone = Storage.getPhone();

  listEl.innerHTML = contacts.map((c) => {
    const unread     = Storage.getUnreadCount(c.phone);
    const chat       = Storage.getChat(c.phone);
    const lastMsg    = chat[chat.length - 1];
    const lastText   = lastMsg
      ? (lastMsg.fromPhone === myPhone ? '↗ ' : '') + (lastMsg.text || '').substring(0, 40)
      : 'Tap untuk mulai chat';
    const lastTime   = lastMsg
      ? new Date(lastMsg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : '';
    const color      = Contacts.getAvatarColor(c.phone);
    const isActive   = Chat.getActiveChatPhone() === c.phone;

    return `
      <div class="kc-contact-item ${isActive ? 'active' : ''}"
           data-phone="${c.phone}"
           id="contact-item-${c.phone.replace(/\+/g, '').replace(/\s/g, '')}">
        <div class="w-11 h-11 rounded-full bg-gradient-to-br ${color} flex items-center justify-center flex-shrink-0 overflow-hidden">
          <span class="text-white text-sm font-bold contact-initials">${c.initials}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-0.5">
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-50 truncate">${escSafe(c.displayName)}</p>
            <span class="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0 ml-1">${lastTime}</span>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400 truncate">${escSafe(lastText)}</p>
        </div>
        ${unread > 0 ? `<span class="kc-badge-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </div>
    `;
  }).join('');

  // Bind click events
  listEl.querySelectorAll('.kc-contact-item').forEach((item) => {
    item.addEventListener('click', () => {
      const phone = item.dataset.phone;
      openChatWith(phone);
    });
  });
}

function escSafe(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateMyAvatar() {
  const phone   = Storage.getPhone();
  const initials = phone ? Auth.getInitials(phone) : '?';
  const photo    = Profile.getMyPhoto();

  ['my-avatar-img', 'settings-avatar-img'].forEach((id) => {
    const img = document.getElementById(id);
    if (!img) return;
    if (photo) {
      img.src = 'data:image/jpeg;base64,' + photo;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }
  });

  ['my-avatar-initials', 'settings-avatar-initials'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = initials;
  });

  const phoneDisplay   = document.getElementById('my-phone-display');
  const settingsPhone  = document.getElementById('settings-phone-display');
  const formatted      = phone ? Auth.formatPhone(phone) : '';
  if (phoneDisplay)  phoneDisplay.textContent  = formatted;
  if (settingsPhone) settingsPhone.textContent = formatted;
}

// ─── Open Chat ────────────────────────────────────────────────────────────────
function openChatWith(phone) {
  // Mobile: sembunyikan sidebar
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 768) {
    sidebar?.classList.add('sidebar-hidden');
  }

  // Tampilkan chat view
  document.getElementById('chat-welcome')?.classList.add('hidden');
  const chatView = document.getElementById('chat-view');
  chatView?.classList.remove('hidden');

  Chat.open(phone);
  renderContactList(); // Update unread badges
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function initSetupScreen() {
  const continueBtn = document.getElementById('setup-continue-btn');
  const phoneInput  = document.getElementById('setup-phone');
  const codeSelect  = document.getElementById('setup-country-code');
  const errorEl     = document.getElementById('setup-error');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function clearError() {
    errorEl.classList.add('hidden');
  }

  // Enter key submit
  phoneInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') continueBtn?.click();
  });

  // Filter non-numeric input
  phoneInput?.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/[^\d\s\-\+\(\)]/g, '');
    clearError();
  });

  continueBtn?.addEventListener('click', async () => {
    const phone = phoneInput?.value?.trim();
    if (!phone) {
      showError('Masukkan nomor telepon terlebih dahulu.');
      return;
    }

    setLoading('setup-continue-btn', 'setup-continue-text', 'setup-continue-loading', true);
    clearError();

    try {
      const code   = codeSelect?.value || Config.DEFAULT_COUNTRY_CODE;
      const result = await Auth.login(phone, code);

      if (result.status === 'registered') {
        // User baru → ke profile setup
        showScreen('screen-profile-setup');
      } else if (result.status === 'existing') {
        // Device valid → ke main app
        showScreen('screen-main');
        initMainApp();
      } else if (result.status === 'conflict') {
        // Device lain sudah aktif → tawarkan pairing
        document.getElementById('existing-phone-display').textContent = result.phone;
        showScreen('screen-existing-device');
      }
    } catch (err) {
      showError(err.message || 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setLoading('setup-continue-btn', 'setup-continue-text', 'setup-continue-loading', false);
    }
  });

  // Theme toggle
  document.getElementById('setup-theme-btn')?.addEventListener('click', () => Theme.toggle());
}

// ─── Existing Device Screen ───────────────────────────────────────────────────
function initExistingDeviceScreen() {
  document.getElementById('existing-pair-btn')?.addEventListener('click', () => {
    // Tampilkan panel scanner (NEW device mode)
    document.getElementById('pairing-qr-panel').classList.add('hidden');
    document.getElementById('pairing-scan-panel').classList.remove('hidden');
    showScreen('screen-pairing');
    initPairingScanPanel();
  });

  document.getElementById('existing-back-btn')?.addEventListener('click', () => {
    Storage.clearPhone();
    showScreen('screen-setup');
  });
}

// ─── Pairing Screen ───────────────────────────────────────────────────────────
async function initPairingQrPanel() {
  const canvas       = document.getElementById('pairing-qr-canvas');
  const statusEl     = document.getElementById('pairing-qr-status');
  const countdownEl  = document.getElementById('pairing-countdown');
  const approvalEl   = document.getElementById('pairing-approval-panel');

  document.getElementById('pairing-qr-panel').classList.remove('hidden');
  document.getElementById('pairing-scan-panel').classList.add('hidden');

  try {
    await Pairing.startQrGeneration(
      canvas,
      (status, data) => {
        if (status === 'SCANNED') {
          statusEl.innerHTML = `
            <div class="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400">
              <span class="w-2 h-2 bg-amber-400 rounded-full"></span>
              Perangkat baru meminta akses
            </div>
          `;
          approvalEl.classList.remove('hidden');
        } else if (status === 'APPROVED') {
          statusEl.innerHTML = '<div class="text-emerald-500 font-medium">✓ Pairing disetujui!</div>';
          setTimeout(() => {
            Pairing.cleanup();
            closeModal('modal-settings');
            showToast('Perangkat baru berhasil dipasangkan. Perangkat ini tetap aktif.', 'success');
          }, 1500);
        } else if (status === 'REJECTED') {
          statusEl.innerHTML = '<div class="text-red-500 font-medium">✕ Pairing ditolak.</div>';
          approvalEl.classList.add('hidden');
          Pairing.cleanup();
        } else if (status === 'EXPIRED') {
          statusEl.innerHTML = '<div class="text-surface-400">Kode QR telah kadaluarsa.</div>';
          Pairing.cleanup();
        }
      },
      countdownEl
    );
  } catch (err) {
    showToast('Gagal membuat QR: ' + err.message, 'error');
    showScreen('screen-main');
  }

  // Approve button
  const approveBtn = document.getElementById('pairing-approve-btn');
  if (approveBtn) approveBtn.onclick = async () => {
    const pairingId = Pairing.getCurrentPairingId();
    if (!pairingId) return;
    try {
      const result = await Pairing.approve(pairingId);
      if (result.success) {
        showToast('Pairing disetujui!', 'success');
      }
    } catch (err) {
      showToast('Gagal menyetujui: ' + err.message, 'error');
    }
  };

  // Reject button
  const rejectBtn = document.getElementById('pairing-reject-btn');
  if (rejectBtn) rejectBtn.onclick = async () => {
    const pairingId = Pairing.getCurrentPairingId();
    if (!pairingId) return;
    try {
      await Pairing.reject(pairingId);
      Pairing.cleanup();
      showScreen('screen-main');
      showToast('Pairing ditolak.', 'info');
    } catch {
      showScreen('screen-main');
    }
  };

  // Cancel
  const qrCancelBtn = document.getElementById('pairing-qr-cancel-btn');
  if (qrCancelBtn) qrCancelBtn.onclick = () => {
    Pairing.cleanup();
    showScreen('screen-main');
  };
}

async function initPairingScanPanel() {
  const videoEl   = document.getElementById('pairing-video');
  const statusEl  = document.getElementById('pairing-scan-status');
  const phone     = Storage.getPhone();

  // One-time scan result handler
  let scanDone = false;

  async function onTokenDetected(token) {
    if (scanDone) return;
    scanDone = true;
    statusEl.textContent = 'Token terdeteksi, mengirim...';

    try {
      const result = await Pairing.submitScan(phone, token);
      if (!result.success) {
        showToast(result.message || 'Token tidak valid.', 'error');
        showScreen('screen-setup');
        return;
      }

      const { pairingId } = result.data;
      statusEl.textContent = 'Menunggu persetujuan dari perangkat lama...';

      // Poll untuk approval
      if (_scanPollTimer) clearInterval(_scanPollTimer);
      _scanPollTimer = setInterval(async () => {
        try {
          const statusResult = await import('./api.js').then((m) =>
            m.Api.getPairingStatus({
              pairingId,
              phone,
              deviceId: Device.getId(),
              deviceToken: null,
            })
          );

          const s = statusResult?.data?.status;
          if (s === 'APPROVED') {
            clearInterval(_scanPollTimer);
            _scanPollTimer = null;
            statusEl.textContent = 'Disetujui! Menyelesaikan pairing...';
            const completeResult = await Pairing.complete(pairingId, phone, token);
            if (completeResult.success) {
              showScreen('screen-main');
              initMainApp();
              showToast('Perangkat baru berhasil dipasangkan!', 'success');
            } else {
              showToast(completeResult.message || 'Gagal menyelesaikan pairing.', 'error');
              showScreen('screen-setup');
            }
          } else if (s === 'REJECTED' || s === 'EXPIRED') {
            clearInterval(_scanPollTimer);
            _scanPollTimer = null;
            showToast('Pairing ditolak atau kadaluarsa.', 'warning');
            showScreen('screen-setup');
          }
        } catch { /* lanjutkan */ }
      }, Config.PAIRING_POLL_INTERVAL_MS);

    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      if (_scanPollTimer) clearInterval(_scanPollTimer);
      _scanPollTimer = null;
      Pairing.cleanup();
      showScreen('screen-setup');
    }
  }

  await Pairing.startCamera(
    videoEl,
    onTokenDetected,
    (errMsg) => {
      statusEl.textContent = errMsg;
    }
  );

  statusEl.textContent = 'Arahkan kamera ke QR Code';

  // Manual code input
  const manualSubmitBtn = document.getElementById('pairing-manual-submit-btn');
  if (manualSubmitBtn) manualSubmitBtn.onclick = () => {
    const code = document.getElementById('pairing-manual-code')?.value?.trim();
    if (code && code.length > 10) {
      Pairing.stopCamera();
      onTokenDetected(code);
    } else {
      showToast('Masukkan kode yang valid.', 'warning');
    }
  };

  // Cancel
  const scanCancelBtn = document.getElementById('pairing-scan-cancel-btn');
  if (scanCancelBtn) scanCancelBtn.onclick = () => {
    if (_scanPollTimer) clearInterval(_scanPollTimer);
    _scanPollTimer = null;
    Pairing.cleanup();
    showScreen('screen-setup');
  };
}

// ─── Profile Setup Screen ─────────────────────────────────────────────────────
function initProfileSetupScreen() {
  let selectedPhoto = null;
  const profilePreview = document.getElementById('profile-setup-preview');
  const profileFileInput = document.getElementById('profile-setup-file-input');

  profilePreview?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      profileFileInput?.click();
    }
  });

  profileFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await Profile.compressImage(file);
      selectedPhoto = base64;
      const img  = document.getElementById('profile-setup-img');
      const ph   = document.getElementById('profile-setup-placeholder');
      if (img) { img.src = 'data:image/jpeg;base64,' + base64; img.classList.remove('hidden'); }
      if (ph)  { ph.classList.add('hidden'); }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('profile-setup-save-btn')?.addEventListener('click', async () => {
    setLoading('profile-setup-save-btn', 'profile-setup-save-text', 'profile-setup-save-loading', true);
    try {
      if (selectedPhoto) {
        const result = await Profile.upload(selectedPhoto);
        if (!result.success) throw new Error(result.message || 'Gagal mengunggah foto profil.');
      }
      showScreen('screen-main');
      initMainApp();
    } catch (err) {
      showToast('Gagal menyimpan profil: ' + err.message, 'error');
    } finally {
      setLoading('profile-setup-save-btn', 'profile-setup-save-text', 'profile-setup-save-loading', false);
    }
  });

  document.getElementById('profile-setup-skip-btn')?.addEventListener('click', () => {
    showScreen('screen-main');
    initMainApp();
  });
}

// ─── Main App ─────────────────────────────────────────────────────────────────
let _mainAppInitialized = false;

function initMainApp() {
  if (_mainAppInitialized) return;
  _mainAppInitialized = true;

  updateMyAvatar();
  renderContactList();

  // ── Polling ──
  Polling.start(
    // onRevoked
    () => {
      showScreen('screen-revoked');
      Storage.clearSession();
    },
    // onNewMessages
    () => {
      renderContactList();
    }
  );

  // ── Search ──
  document.getElementById('contact-search')?.addEventListener('input', (e) => {
    renderContactList(e.target.value);
  });

  // ── New Chat / Add Contact Button ──
  document.getElementById('new-chat-btn')?.addEventListener('click', () => openModal('modal-add-contact'));
  document.getElementById('contact-list-add-btn')?.addEventListener('click', () => openModal('modal-add-contact'));

  // ── Settings Button ──
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    initSettingsModal();
    openModal('modal-settings');
  });

  // ── Chat Back (mobile) ──
  document.getElementById('chat-back-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('sidebar-hidden');
    document.getElementById('chat-view')?.classList.add('hidden');
    document.getElementById('chat-welcome')?.classList.remove('hidden');
  });

  // ── Chat Info Button ──
  document.getElementById('chat-info-btn')?.addEventListener('click', () => {
    const phone = Chat.getActiveChatPhone();
    if (!phone) return;
    openContactInfoModal(phone);
  });

  // ── Chat Send ──
  const chatInput   = document.getElementById('chat-input');
  const sendBtn     = document.getElementById('chat-send-btn');

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });

  chatInput?.addEventListener('input', () => {
    // Auto-resize textarea
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 128) + 'px';
  });

  sendBtn?.addEventListener('click', sendCurrentMessage);

  // ── Emoji picker ──
  document.getElementById('emoji-btn')?.addEventListener('click', () => {
    initEmojiPicker();
    openModal('modal-emoji');
  });

  // ── Add Contact Submit ──
  document.getElementById('add-contact-submit-btn')?.addEventListener('click', () => {
    const codeEl  = document.getElementById('add-contact-code');
    const phoneEl = document.getElementById('add-contact-phone');
    const nameEl  = document.getElementById('add-contact-name');
    const errEl   = document.getElementById('add-contact-error');

    const code    = codeEl?.value  || Config.DEFAULT_COUNTRY_CODE;
    const phoneIn = phoneEl?.value?.trim() || '';
    const name    = nameEl?.value?.trim()  || '';

    try {
      const normalized = Auth.normalizePhone(phoneIn, code);
      if (normalized === Storage.getPhone()) {
        errEl.textContent = 'Tidak bisa menambahkan diri sendiri.';
        errEl.classList.remove('hidden');
        return;
      }
      Contacts.upsert(normalized, name);
      closeModal('modal-add-contact');
      phoneEl.value = '';
      nameEl.value  = '';
      errEl.classList.add('hidden');
      renderContactList();
      showToast('Kontak ditambahkan!', 'success');
      // Langsung buka chat
      openChatWith(normalized);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  // ── Revoked Screen ──
  document.getElementById('revoked-restart-btn')?.addEventListener('click', () => {
    Auth.logout();
    _mainAppInitialized = false;
    Polling.stop();
    showScreen('screen-setup');
  });

  // ── Custom event: open chat from notification click ──
  if (!_openChatListenerBound) {
    window.addEventListener('kc:openChat', (e) => {
      const phone = e.detail?.phone;
      if (phone && Contacts.has(phone)) {
        openChatWith(phone);
      }
    });
    _openChatListenerBound = true;
  }

  // ── Polling indicator ──
  if (!_pollingIndicatorTimer) {
    _pollingIndicatorTimer = setInterval(updatePollingIndicator, 5000);
  }
}

async function sendCurrentMessage() {
  const input = document.getElementById('chat-input');
  if (!input?.value?.trim()) return;
  const text = input.value;
  input.value = '';
  input.style.height = 'auto';
  await Chat.sendMessage(text);
}

function updatePollingIndicator() {
  const dot    = document.getElementById('polling-indicator');
  const text   = document.getElementById('polling-status-text');
  const active = Polling.isRunning();
  if (dot) {
    dot.className = active
      ? 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot'
      : 'w-2 h-2 rounded-full bg-red-400';
  }
  if (text) text.textContent = active ? 'Terhubung' : 'Tidak terhubung';
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function initSettingsModal() {
  const phone = Storage.getPhone();

  // Device info
  const deviceIdEl = document.getElementById('settings-device-id');
  if (deviceIdEl) deviceIdEl.textContent = Device.formatId(Device.getId());

  // Dark mode
  const dmToggle = document.getElementById('settings-dark-mode');
  if (dmToggle) {
    dmToggle.checked = Theme.isDark();
    dmToggle.onchange = () => Theme.toggle();
  }

  // Audio
  const audioToggle = document.getElementById('settings-audio');
  const volumeSlider = document.getElementById('settings-volume');
  const volumeVal    = document.getElementById('settings-volume-value');

  if (audioToggle) {
    audioToggle.checked  = Storage.getAudioEnabled();
    audioToggle.onchange = () => Notifications.setEnabled(audioToggle.checked);
  }
  if (volumeSlider) {
    volumeSlider.value = Storage.getAudioVolume();
    volumeSlider.oninput = () => {
      const v = volumeSlider.value;
      if (volumeVal) volumeVal.textContent = v;
      Notifications.setVolume(v);
    };
  }

  // Notifications
  const notifToggle = document.getElementById('settings-notifications');
  if (notifToggle) {
    notifToggle.checked  = Storage.getNotifEnabled();
    notifToggle.onchange = () => Notifications.setNotifEnabled(notifToggle.checked);
  }

  // Avatar in settings
  const settingsAvatarTrigger = document.getElementById('settings-avatar-trigger');
  const settingsAvatarFile    = document.getElementById('settings-avatar-file');

  if (settingsAvatarTrigger) settingsAvatarTrigger.onclick = () => settingsAvatarFile?.click();
  if (settingsAvatarFile) settingsAvatarFile.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await Profile.compressImage(file);
      const result = await Profile.upload(base64);
      if (!result.success) throw new Error(result.message || 'Gagal mengunggah foto profil.');
      updateMyAvatar();
      showToast('Foto profil diperbarui!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Pair New Device
  const pairNewDeviceBtn = document.getElementById('settings-pair-new-device-btn');
  if (pairNewDeviceBtn) pairNewDeviceBtn.onclick = () => {
    closeModal('modal-settings');
    document.getElementById('pairing-qr-panel').classList.remove('hidden');
    document.getElementById('pairing-scan-panel').classList.add('hidden');
    document.getElementById('pairing-approval-panel').classList.add('hidden');
    document.getElementById('pairing-qr-status').innerHTML = `
      <div class="flex items-center justify-center gap-2">
        <span class="w-2 h-2 bg-amber-400 rounded-full animate-pulse-dot"></span>
        Menunggu scan...
      </div>
    `;
    showScreen('screen-pairing');
    initPairingQrPanel();
  };

  // Clear data
  const clearDataBtn = document.getElementById('settings-clear-data-btn');
  if (clearDataBtn) clearDataBtn.onclick = () => {
    if (confirm('Yakin ingin menghapus semua data lokal? Histori chat akan hilang.')) {
      Polling.stop();
      Storage.clearAll();
      _mainAppInitialized = false;
      showScreen('screen-setup');
      closeModal('modal-settings');
      showToast('Semua data lokal dihapus.', 'info');
    }
  };
}

// ─── Contact Info Modal ───────────────────────────────────────────────────────
function openContactInfoModal(phone) {
  const name     = Contacts.getDisplayName(phone);
  const initials = Contacts.getInitials(phone);
  const color    = Contacts.getAvatarColor(phone);

  document.getElementById('contact-info-name').textContent  = name;
  document.getElementById('contact-info-phone').textContent = phone;
  document.getElementById('contact-info-initials').textContent = initials;
  document.getElementById('contact-info-name-input').value  = Contacts.getAll()[phone]?.name || '';

  // Avatar
  const avatarEl = document.getElementById('contact-info-avatar');
  const initEl   = document.getElementById('contact-info-initials');
  const parent   = avatarEl?.parentElement;
  if (parent) {
    parent.className = parent.className.replace(/from-\S+\s+to-\S+/g, '').trim();
    parent.classList.add(...color.split(' '));
  }

  // Load cached photo
  const cached = Storage.getProfile(phone);
  if (cached?.photo) {
    avatarEl.src = 'data:image/jpeg;base64,' + cached.photo;
    avatarEl.classList.remove('hidden');
    initEl.classList.add('hidden');
  } else {
    avatarEl.classList.add('hidden');
    initEl.classList.remove('hidden');
  }

  // Save name
  document.getElementById('contact-info-save-btn').onclick = () => {
    const newName = document.getElementById('contact-info-name-input').value.trim();
    Contacts.upsert(phone, newName);
    closeModal('modal-contact-info');
    renderContactList();
    showToast('Nama kontak disimpan!', 'success');
  };

  // Delete
  document.getElementById('contact-info-delete-btn').onclick = () => {
    if (confirm(`Hapus kontak ${name}?`)) {
      Contacts.remove(phone);
      closeModal('modal-contact-info');
      renderContactList();
      document.getElementById('chat-view')?.classList.add('hidden');
      document.getElementById('chat-welcome')?.classList.remove('hidden');
      showToast('Kontak dihapus.', 'info');
    }
  };

  openModal('modal-contact-info');
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
function initEmojiPicker() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = '';

  Config.EMOJI_LIST.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'text-xl hover:scale-125 transition-transform duration-100 p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value += emoji;
        input.focus();
        // Trigger resize
        input.dispatchEvent(new Event('input'));
      }
      closeModal('modal-emoji');
    });
    grid.appendChild(btn);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
async function main() {
  // 1. Init theme ASAP (before render)
  Theme.init();

  // 2. Init all screen event handlers
  initSetupScreen();
  initExistingDeviceScreen();
  initProfileSetupScreen();

  // 3. Request notification permission quietly
  Notifications.requestPermission().catch(() => {});

  // 4. Determine starting screen
  if (Auth.hasLocalSession()) {
    // Validasi session dengan backend
    const validation = await Auth.validateSession();

    if (validation.valid) {
      showScreen('screen-main');
      initMainApp();
    } else if (validation.reason === 'DEVICE_REVOKED' || validation.reason === 'INVALID_TOKEN') {
      Storage.clearSession();
      showScreen('screen-revoked');
    } else {
      // Jangan hapus session hanya karena backend sedang bermasalah.
      showScreen('screen-main');
      initMainApp();
      showToast(
        validation.offline
          ? 'Mode offline. Menghubungkan kembali...'
          : 'Server belum dapat divalidasi. Mode offline aktif.',
        'warning'
      );
    }
  } else {
    showScreen('screen-setup');
  }
}

// Bootstrap
main().catch((err) => {
  console.error('[App] Fatal init error:', err);
  // Fallback ke setup screen
  showScreen('screen-setup');
});
