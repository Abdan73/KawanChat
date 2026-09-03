/**
 * chat.js
 * KawanChat — Chat Rendering & Message Management
 *
 * Fitur:
 * - Render pesan (masuk/keluar) dengan timestamps
 * - Send pesan via API
 * - Simpan/load dari LocalStorage
 * - Date separator
 * - HTML escaping (anti XSS)
 * - Auto scroll ke bawah
 * - Emoji shorthand
 */

import { Api } from './api.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Contacts } from './contacts.js';
import { Config } from './config.js';

// ─── Internal state ───────────────────────────────────────────────────────────
let _activeChatPhone = null;
let _isSending       = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function linkifyText(text) {
  const escaped = escapeHtml(text);
  // Make URLs clickable
  return escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline opacity-80 hover:opacity-100">$1</a>'
  );
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hari ini';
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function generateMessageId() {
  return crypto.randomUUID();
}

// ─── Chat Module ──────────────────────────────────────────────────────────────
export const Chat = {

  getActiveChatPhone() { return _activeChatPhone; },

  // ─── Open Chat ────────────────────────────────────────────────────────────

  /**
   * Buka percakapan dengan kontak.
   * @param {string} phone - Nomor E.164 kontak
   */
  open(phone) {
    _activeChatPhone = phone;

    // Update header UI
    const name = Contacts.getDisplayName(phone);
    const initials = Contacts.getInitials(phone);
    const colorClass = Contacts.getAvatarColor(phone);

    const headerName  = document.getElementById('chat-header-name');
    const headerPhone = document.getElementById('chat-header-phone');
    const headerInit  = document.getElementById('chat-header-initials');
    const headerAvatar = document.getElementById('chat-header-avatar');

    if (headerName)  headerName.textContent  = name;
    if (headerPhone) headerPhone.textContent = phone;
    if (headerInit)  {
      headerInit.textContent = initials;
      headerInit.classList.remove('hidden');
    }
    if (headerAvatar) headerAvatar.classList.add('hidden');

    // Color avatar header
    const avatarContainer = headerAvatar?.parentElement;
    if (avatarContainer && colorClass) {
      avatarContainer.className = avatarContainer.className
        .replace(/from-\S+\s+to-\S+/g, '').trim();
      avatarContainer.classList.add(...colorClass.split(' '));
    }

    // Mark messages as seen
    Storage.setLastSeen(phone, Date.now());

    // Render pesan dari LocalStorage
    Chat.renderAll(phone);

    // Fokus input
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 100);
  },

  // ─── Render Messages ──────────────────────────────────────────────────────

  renderAll(phone) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const messages  = Storage.getChat(phone);
    const myPhone   = Storage.getPhone();

    container.innerHTML = '';

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full py-12 text-center">
          <div class="w-14 h-14 bg-surface-100 dark:bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
            <svg class="w-7 h-7 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <p class="text-sm text-surface-400 dark:text-surface-500">Belum ada pesan</p>
          <p class="text-xs text-surface-300 dark:text-surface-600 mt-1">Kirim pesan pertamamu!</p>
        </div>
      `;
      return;
    }

    let lastDateStr = '';
    const fragment = document.createDocumentFragment();

    messages.forEach((msg) => {
      const dateStr = formatDate(msg.timestamp);
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        fragment.appendChild(Chat._buildDateSeparator(dateStr));
      }
      const isMe = msg.fromPhone === myPhone;
      fragment.appendChild(Chat._buildBubble(msg, isMe));
    });

    container.appendChild(fragment);
    Chat.scrollToBottom(true);
  },

  _buildDateSeparator(dateStr) {
    const el = document.createElement('div');
    el.className = 'kc-date-sep';
    el.innerHTML = `<span>${escapeHtml(dateStr)}</span>`;
    return el;
  },

  _buildBubble(msg, isMe) {
    const wrapper = document.createElement('div');
    wrapper.className = isMe ? 'kc-msg-out' : 'kc-msg-in';
    wrapper.dataset.msgId = msg.id;

    const timeStr   = formatTime(msg.timestamp);
    const textHtml  = linkifyText(msg.text || '');

    if (isMe) {
      wrapper.innerHTML = `
        <div class="flex flex-col items-end gap-0.5">
          <div class="kc-bubble-out msg-enter">
            <p class="text-sm leading-relaxed whitespace-pre-wrap">${textHtml}</p>
          </div>
          <div class="flex items-center gap-1 px-1">
            <span class="kc-msg-time text-surface-400 dark:text-surface-500">${timeStr}</span>
            <span class="kc-msg-status text-surface-400">${Chat._statusIcon(msg.status)}</span>
          </div>
        </div>
      `;
    } else {
      wrapper.innerHTML = `
        <div class="flex flex-col items-start gap-0.5">
          <div class="kc-bubble-in msg-enter">
            <p class="text-sm leading-relaxed whitespace-pre-wrap">${textHtml}</p>
          </div>
          <span class="kc-msg-time text-surface-400 dark:text-surface-500 px-1">${timeStr}</span>
        </div>
      `;
    }
    return wrapper;
  },

  _statusIcon(status) {
    switch (status) {
      case 'sent':        return '✓';
      case 'delivered':   return '✓✓';
      case 'read':        return '<span class="text-blue-400">✓✓</span>';
      default:            return '🕐';
    }
  },

  /**
   * Tambah satu pesan baru ke tampilan (tanpa re-render seluruh chat).
   */
  appendMessageToView(msg, isMe) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Hapus empty state jika ada
    const emptyState = container.querySelector('.flex.flex-col.items-center');
    if (emptyState) container.innerHTML = '';

    // Cek apakah perlu date separator
    const messages = Storage.getChat(isMe ? _activeChatPhone : msg.fromPhone);
    if (messages.length > 1) {
      const prevMsg  = messages[messages.length - 2];
      const prevDate = formatDate(prevMsg.timestamp);
      const currDate = formatDate(msg.timestamp);
      if (prevDate !== currDate) {
        container.appendChild(Chat._buildDateSeparator(currDate));
      }
    }

    container.appendChild(Chat._buildBubble(msg, isMe));
    Chat.scrollToBottom();
  },

  scrollToBottom(instant = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    if (instant) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  },

  // ─── Send Message ─────────────────────────────────────────────────────────

  async sendMessage(text) {
    if (!text || !text.trim()) return;
    if (_isSending) return;
    if (!_activeChatPhone) return;

    const sanitized = text.trim().substring(0, Config.MAX_MESSAGE_LENGTH);
    _isSending = true;

    const myPhone    = Storage.getPhone();
    const profileVer = Storage.getProfileVersion(myPhone) || '0';
    const { deviceId, deviceToken } = Device.getCredentials();

    // Buat pesan lokal (optimistic update)
    const localMsg = {
      id:        generateMessageId(),
      fromPhone: myPhone,
      toPhone:   _activeChatPhone,
      text:      sanitized,
      timestamp: Date.now(),
      status:    'pending',
    };

    // Simpan dan tampilkan langsung (optimistic)
    Storage.appendMessage(_activeChatPhone, localMsg);
    Chat.appendMessageToView(localMsg, true);

    // Clear input
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    try {
      const result = await Api.sendMessage({
        phone:          myPhone,
        deviceId,
        deviceToken,
        to:             _activeChatPhone,
        message:        sanitized,
        profileVersion: profileVer,
      });

      // Update status
      if (!result.success) {
        Chat._updateMessageStatus(localMsg.id, 'error');
        window.dispatchEvent(new CustomEvent('kc:toast', {
          detail: { message: result.message || 'Pesan gagal dikirim.', type: 'error' },
        }));
      }
      const updatedStatus = result.success ? 'sent' : 'error';
      Chat._updateMessageStatus(localMsg.id, updatedStatus);

      // Update di storage
      const msgs = Storage.getChat(_activeChatPhone);
      const idx  = msgs.findIndex((m) => m.id === localMsg.id);
      if (idx !== -1) {
        msgs[idx].status = updatedStatus;
        Storage.saveChat(_activeChatPhone, msgs);
      }

    } catch (err) {
      console.error('[Chat] Send error:', err);
      Chat._updateMessageStatus(localMsg.id, 'error');
      window.dispatchEvent(new CustomEvent('kc:toast', {
        detail: { message: err.message || 'Pesan gagal dikirim. Periksa koneksi Anda.', type: 'error' },
      }));
    } finally {
      _isSending = false;
    }
  },

  _updateMessageStatus(msgId, status) {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .kc-msg-status`);
    if (el) el.innerHTML = Chat._statusIcon(status);
  },

  // ─── Receive Messages (called by Polling) ────────────────────────────────

  /**
   * Proses pesan masuk dari polling.
   * @param {Array} messages - Array pesan dari backend
   * @returns {string[]} - Array messageId yang berhasil disimpan
   */
  receiveMessages(messages) {
    const myPhone = Storage.getPhone();
    const acked   = [];

    for (const msg of messages) {
      const localMsg = {
        id:        msg.id,
        fromPhone: msg.fromPhone,
        toPhone:   myPhone,
        text:      msg.payload || msg.text || '',
        timestamp: msg.timestamp || Date.now(),
        status:    'received',
        profileVersion: msg.profileVersion,
      };

      const isNewMsg = Storage.appendMessage(msg.fromPhone, localMsg);

      if (isNewMsg) {
        acked.push(msg.id);

        // Jika chat aktif dengan pengirim ini → tampilkan langsung
        if (_activeChatPhone === msg.fromPhone) {
          Chat.appendMessageToView(localMsg, false);
          // Update last seen
          Storage.setLastSeen(msg.fromPhone, Date.now());
        }
      }
    }

    return acked;
  },
};
