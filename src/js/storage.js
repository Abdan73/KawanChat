/**
 * storage.js
 * KawanChat — LocalStorage Manager
 *
 * Semua akses LocalStorage harus melalui modul ini.
 * Fitur: JSON safety, quota handling, key namespacing, chat history limit.
 */

import { Config } from './config.js';

const SK = Config.STORAGE_KEYS;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    // JSON corrupt → remove dan return null
    try { localStorage.removeItem(key); } catch { /* noop */ }
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // QuotaExceededError
    if (err.name === 'QuotaExceededError' || err.code === 22) {
      console.error('[Storage] Quota exceeded. Attempting cleanup...');
      Storage._emergencyCleanup();
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        console.error('[Storage] Still cannot write after cleanup:', key);
        return false;
      }
    }
    console.error('[Storage] Write error:', err);
    return false;
  }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

// ─── Storage Module ───────────────────────────────────────────────────────────
export const Storage = {

  // ─── Session / Device ────────────────────────────────────────────────────

  getPhone()        { return safeGet(SK.PHONE); },
  setPhone(phone)   { return safeSet(SK.PHONE, phone); },
  clearPhone()      { safeRemove(SK.PHONE); },

  getDeviceId()     { return safeGet(SK.DEVICE_ID); },
  setDeviceId(id)   { return safeSet(SK.DEVICE_ID, id); },

  getDeviceToken()       { return safeGet(SK.DEVICE_TOKEN); },
  setDeviceToken(token)  { return safeSet(SK.DEVICE_TOKEN, token); },

  hasSession() {
    return !!(Storage.getPhone() && Storage.getDeviceId() && Storage.getDeviceToken());
  },

  clearSession() {
    safeRemove(SK.PHONE);
    safeRemove(SK.DEVICE_ID);
    safeRemove(SK.DEVICE_TOKEN);
  },

  // ─── Contacts ─────────────────────────────────────────────────────────────
  // Format: { "+628123": { name: "Budi" }, ... }

  getContacts() {
    return safeGet(SK.CONTACTS) || {};
  },

  saveContacts(contacts) {
    return safeSet(SK.CONTACTS, contacts);
  },

  getContactName(phone) {
    const contacts = Storage.getContacts();
    return contacts[phone]?.name || null;
  },

  setContact(phone, name) {
    const contacts = Storage.getContacts();
    contacts[phone] = { name: name || '' };
    return safeSet(SK.CONTACTS, contacts);
  },

  removeContact(phone) {
    const contacts = Storage.getContacts();
    delete contacts[phone];
    return safeSet(SK.CONTACTS, contacts);
  },

  // ─── Chat History ─────────────────────────────────────────────────────────
  // Key: KC_CHAT_+628123456789
  // Value: Array of message objects

  _chatKey(phone) {
    return SK.CHAT_PREFIX + phone;
  },

  getChat(phone) {
    return safeGet(Storage._chatKey(phone)) || [];
  },

  saveChat(phone, messages) {
    // Enforce message limit
    let msgs = messages;
    if (msgs.length > Config.MAX_MESSAGES_PER_CHAT) {
      msgs = msgs.slice(msgs.length - Config.MAX_MESSAGES_PER_CHAT);
    }
    return safeSet(Storage._chatKey(phone), msgs);
  },

  appendMessage(phone, message) {
    const msgs = Storage.getChat(phone);
    // Deduplicate by id
    if (message.id && msgs.some((m) => m.id === message.id)) return false;
    msgs.push(message);
    Storage.saveChat(phone, msgs);
    return true;
  },

  clearChat(phone) {
    safeRemove(Storage._chatKey(phone));
  },

  // ─── Profile Cache ────────────────────────────────────────────────────────
  // KC_PROFILE_+628123      → { photo: base64 | null }
  // KC_PROFILE_VERSION_+62… → version string

  _profileKey(phone)    { return SK.PROFILE_PREFIX + phone; },
  _profileVerKey(phone) { return SK.PROFILE_VER_PFX + phone; },

  getProfile(phone) {
    return safeGet(Storage._profileKey(phone));
  },

  getProfileVersion(phone) {
    return safeGet(Storage._profileVerKey(phone));
  },

  saveProfile(phone, photo, version) {
    safeSet(Storage._profileKey(phone), { photo });
    safeSet(Storage._profileVerKey(phone), version);
  },

  clearProfile(phone) {
    safeRemove(Storage._profileKey(phone));
    safeRemove(Storage._profileVerKey(phone));
  },

  // ─── Theme ────────────────────────────────────────────────────────────────

  getTheme()       { return safeGet(SK.THEME) || 'light'; },
  setTheme(theme)  { return safeSet(SK.THEME, theme); },

  // ─── Audio Settings ───────────────────────────────────────────────────────

  getAudioEnabled()       { return safeGet(SK.AUDIO_ENABLED) !== false; }, // default true
  setAudioEnabled(val)    { return safeSet(SK.AUDIO_ENABLED, !!val); },

  getAudioVolume()        { return safeGet(SK.AUDIO_VOLUME) ?? 70; },
  setAudioVolume(vol)     { return safeSet(SK.AUDIO_VOLUME, Number(vol)); },

  // ─── Notification Settings ────────────────────────────────────────────────

  getNotifEnabled()       { return safeGet(SK.NOTIF_ENABLED) !== false; }, // default true
  setNotifEnabled(val)    { return safeSet(SK.NOTIF_ENABLED, !!val); },

  // ─── Last Seen ────────────────────────────────────────────────────────────

  getLastSeen(phone) {
    return safeGet(SK.LAST_SEEN_PFX + phone) || 0;
  },

  setLastSeen(phone, timestamp) {
    return safeSet(SK.LAST_SEEN_PFX + phone, timestamp);
  },

  // ─── Unread Count ────────────────────────────────────────────────────────
  // Count messages in chat that are after lastSeen and from the other side

  getUnreadCount(phone) {
    const chat    = Storage.getChat(phone);
    const myPhone = Storage.getPhone();
    const lastSeen = Storage.getLastSeen(phone);
    return chat.filter(
      (m) => m.fromPhone !== myPhone && (m.timestamp || 0) > lastSeen
    ).length;
  },

  // ─── Clear All Data ───────────────────────────────────────────────────────

  clearAll() {
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('KC_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => safeRemove(k));
  },

  // ─── Emergency Cleanup ────────────────────────────────────────────────────
  // Remove oldest chat data to free space

  _emergencyCleanup() {
    const chatKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SK.CHAT_PREFIX)) {
        chatKeys.push(key);
      }
    }
    // Remove half of each chat (oldest messages)
    chatKeys.forEach((key) => {
      try {
        const msgs = JSON.parse(localStorage.getItem(key) || '[]');
        const trimmed = msgs.slice(Math.floor(msgs.length / 2));
        localStorage.setItem(key, JSON.stringify(trimmed));
      } catch {
        localStorage.removeItem(key);
      }
    });
    // Remove profile photos (large data)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SK.PROFILE_PREFIX)) {
        safeRemove(key);
      }
    }
  },
};
