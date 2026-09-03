/**
 * KawanChat Google Apps Script backend.
 * Deploy as a Web app: execute as the owner, access anyone.
 */

const SPREADSHEET_ID = '1744HSisDQd3kt2bAa38aOacDLNtXH9O7ldL1t9PxrSs';
const PAIRING_TTL_MS = 5 * 60 * 1000;
const SHEETS = {
  DEVICES: 'Devices',
  PAIRINGS: 'Pairings',
  MESSAGES: 'Messages',
  PROFILES: 'Profiles',
};

function doGet() {
  return jsonResponse({ success: true, data: { service: 'KawanChat API' } });
}

function doPost(event) {
  try {
    const body = event && event.postData && event.postData.contents
      ? JSON.parse(event.postData.contents)
      : {};
    const action = String(body.action || '');
    if (!action || typeof ACTIONS[action] !== 'function') {
      return jsonResponse({ success: false, code: 'UNKNOWN_ACTION', message: 'Action tidak dikenal.' });
    }
    return jsonResponse(ACTIONS[action](body));
  } catch (error) {
    console.error(error);
    return jsonResponse({ success: false, code: 'SERVER_ERROR', message: error.message || 'Terjadi kesalahan server.' });
  }
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data, message) {
  return { success: true, code: 'OK', message: message || '', data: data || {} };
}

function fail(code, message) {
  return { success: false, code: code, message: message };
}

function db() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function setupDatabase() {
  const spreadsheet = db();
  ensureSheet(spreadsheet, SHEETS.DEVICES, ['phone', 'deviceId', 'deviceToken', 'active', 'createdAt', 'updatedAt']);
  ensureSheet(spreadsheet, SHEETS.PAIRINGS, ['pairingId', 'phone', 'oldDeviceId', 'newDeviceId', 'token', 'status', 'createdAt', 'expiresAt', 'completedToken']);
  ensureSheet(spreadsheet, SHEETS.MESSAGES, ['id', 'fromPhone', 'toPhone', 'payload', 'timestamp', 'profileVersion', 'status', 'ackAt']);
  ensureSheet(spreadsheet, SHEETS.PROFILES, ['phone', 'profileVersion', 'fileId', 'updatedAt']);
  return ok({ sheets: Object.keys(SHEETS).map(function(key) { return SHEETS[key]; }) });
}

function ensureSheet(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function sheet(name) {
  const target = db().getSheetByName(name);
  if (!target) throw new Error('Sheet tidak ditemukan: ' + name);
  return target;
}

function rows(name) {
  const target = sheet(name);
  const values = target.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).map(function(row, index) {
    const item = {};
    values[0].forEach(function(header, column) { item[header] = row[column]; });
    item._row = index + 2;
    return item;
  });
}

function append(name, values) {
  sheet(name).appendRow(values);
}

function updateRow(name, rowNumber, values) {
  sheet(name).getRange(rowNumber, 1, 1, values.length).setValues([values]);
}

function now() {
  return new Date().toISOString();
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function validPhone(phone) {
  return /^\+[1-9]\d{6,14}$/.test(text(phone));
}

function token() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function deviceFor(data, allowInactive) {
  const phone = text(data.phone);
  const deviceId = text(data.deviceId);
  const deviceToken = text(data.deviceToken);
  const match = rows(SHEETS.DEVICES).find(function(item) {
    return text(item.phone) === phone && text(item.deviceId) === deviceId && text(item.deviceToken) === deviceToken && (allowInactive || item.active === true || text(item.active) === 'TRUE');
  });
  return match || null;
}

function devicesForPhone(phone) {
  return rows(SHEETS.DEVICES).filter(function(item) {
    return text(item.phone) === text(phone);
  });
}

function dedupeDevices() {
  setupDatabase();
  const seen = {};
  const removed = [];
  rows(SHEETS.DEVICES).reverse().forEach(function(item) {
    const key = text(item.phone) + '|' + text(item.deviceId);
    if (!text(item.phone) || !text(item.deviceId) || seen[key]) {
      if (item._row) removed.push(item._row);
      return;
    }
    seen[key] = true;
  });
  removed.sort(function(a, b) { return b - a; }).forEach(function(rowNumber) {
    sheet(SHEETS.DEVICES).deleteRow(rowNumber);
  });
  return ok({ removed: removed.length });
}

function requireDevice(data) {
  const device = deviceFor(data, false);
  if (!device) throw new Error('INVALID_TOKEN: Device atau token tidak valid.');
  return device;
}

function registerDevice(data) {
  const phone = text(data.phone);
  const deviceId = text(data.deviceId);
  if (!validPhone(phone) || !deviceId) return fail('INVALID_INPUT', 'Nomor atau identitas perangkat tidak valid.');

  setupDatabase();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const phoneDevices = devicesForPhone(phone);
    const existing = phoneDevices.find(function(item) { return text(item.deviceId) === deviceId; });
    const activeOtherDevice = phoneDevices.find(function(item) {
      return text(item.deviceId) !== deviceId && (item.active === true || text(item.active) === 'TRUE');
    });
    if (activeOtherDevice) {
      return fail('DEVICE_CONFLICT', 'Nomor ini sudah terdaftar di perangkat lain.');
    }
    if (existing) {
      const deviceToken = text(existing.deviceToken) || token();
      updateRow(SHEETS.DEVICES, existing._row, [phone, deviceId, deviceToken, true, existing.createdAt || now(), now()]);
      return ok({ deviceToken: deviceToken, isNewUser: false });
    }
    const deviceToken = token();
    append(SHEETS.DEVICES, [phone, deviceId, deviceToken, true, now(), now()]);
    return ok({ deviceToken: deviceToken, isNewUser: true });
  } finally {
    lock.releaseLock();
  }
}

function validateDevice(data) {
  setupDatabase();
  const device = deviceFor(data, false);
  return device ? ok({ phone: device.phone, deviceId: device.deviceId }) : fail('INVALID_TOKEN', 'Sesi perangkat tidak valid.');
}

function getDeviceStatus(data) {
  const device = deviceFor(data, false);
  return device ? ok({ active: true }) : fail('INVALID_TOKEN', 'Sesi perangkat tidak valid.');
}

function createPairing(data) {
  try { requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const pairingId = Utilities.getUuid();
  const pairingToken = token();
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  append(SHEETS.PAIRINGS, [pairingId, text(data.phone), text(data.deviceId), '', pairingToken, 'WAITING', now(), expiresAt, '']);
  return ok({ pairingId: pairingId, token: pairingToken, expiresAt: expiresAt });
}

function pairingById(pairingId) {
  return rows(SHEETS.PAIRINGS).find(function(item) { return text(item.pairingId) === text(pairingId); }) || null;
}

function pairingExpired(pairing) {
  return Number(pairing.expiresAt) < Date.now() && !['COMPLETED', 'REJECTED'].includes(text(pairing.status));
}

function getPairingStatus(data) {
  const pairing = pairingById(data.pairingId);
  if (!pairing) return fail('NOT_FOUND', 'Pairing tidak ditemukan.');
  if (pairingExpired(pairing)) {
    updatePairing(pairing, 'EXPIRED', pairing.newDeviceId, pairing.completedToken);
    return ok({ status: 'EXPIRED' });
  }
  const oldDevice = deviceFor(data, false);
  const newDevice = !text(data.deviceToken) && text(pairing.newDeviceId) === text(data.deviceId) && text(pairing.phone) === text(data.phone);
  if (!oldDevice && !newDevice) return fail('INVALID_TOKEN', 'Akses pairing tidak valid.');
  return ok({ status: text(pairing.status), pairingId: pairing.pairingId });
}

function scanPairingToken(data) {
  const pairing = rows(SHEETS.PAIRINGS).find(function(item) { return text(item.token) === text(data.token); });
  if (!pairing) return fail('INVALID_PAIRING_TOKEN', 'QR pairing tidak valid.');
  if (pairingExpired(pairing)) return fail('PAIRING_EXPIRED', 'QR pairing sudah kedaluwarsa.');
  if (text(pairing.newDeviceId) && text(pairing.newDeviceId) !== text(data.deviceId)) return fail('PAIRING_IN_USE', 'QR sedang digunakan perangkat lain.');
  if (['REJECTED', 'COMPLETED'].includes(text(pairing.status))) return fail('PAIRING_CLOSED', 'Pairing sudah ditutup.');
  updatePairing(pairing, 'SCANNED', text(data.deviceId), pairing.completedToken);
  return ok({ pairingId: pairing.pairingId });
}

function updatePairing(pairing, status, newDeviceId, completedToken) {
  updateRow(SHEETS.PAIRINGS, pairing._row, [pairing.pairingId, pairing.phone, pairing.oldDeviceId, newDeviceId || pairing.newDeviceId, pairing.token, status, pairing.createdAt, pairing.expiresAt, completedToken || pairing.completedToken]);
}

function approvePairing(data) {
  let device;
  try { device = requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const pairing = pairingById(data.pairingId);
  if (!pairing || text(pairing.phone) !== text(device.phone) || text(pairing.oldDeviceId) !== text(device.deviceId)) return fail('NOT_FOUND', 'Pairing tidak ditemukan.');
  if (pairingExpired(pairing)) return fail('PAIRING_EXPIRED', 'Pairing sudah kedaluwarsa.');
  updatePairing(pairing, 'APPROVED', pairing.newDeviceId, pairing.completedToken);
  return ok();
}

function rejectPairing(data) {
  const result = approvePairing(data);
  if (!result.success) return result;
  const pairing = pairingById(data.pairingId);
  updatePairing(pairing, 'REJECTED', pairing.newDeviceId, pairing.completedToken);
  return ok();
}

function completePairing(data) {
  const pairing = pairingById(data.pairingId);
  if (!pairing || text(pairing.token) !== text(data.token) || text(pairing.phone) !== text(data.phone)) return fail('INVALID_PAIRING', 'Data pairing tidak valid.');
  if (pairing.status !== 'APPROVED') return fail('PAIRING_NOT_APPROVED', 'Pairing belum disetujui.');
  if (pairingExpired(pairing)) return fail('PAIRING_EXPIRED', 'Pairing sudah kedaluwarsa.');
  const newDeviceId = text(data.newDeviceId);
  const deviceToken = token();
  const existing = rows(SHEETS.DEVICES).find(function(item) {
    return text(item.phone) === text(data.phone) && text(item.deviceId) === newDeviceId;
  });
  if (existing) updateRow(SHEETS.DEVICES, existing._row, [data.phone, newDeviceId, deviceToken, true, existing.createdAt || now(), now()]);
  else append(SHEETS.DEVICES, [data.phone, newDeviceId, deviceToken, true, now(), now()]);
  updatePairing(pairing, 'COMPLETED', newDeviceId, deviceToken);
  return ok({ deviceToken: deviceToken });
}

function sendMessage(data) {
  try { requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const to = text(data.to);
  const message = text(data.message);
  if (!validPhone(to) || !message || message.length > 4000) return fail('INVALID_INPUT', 'Penerima atau pesan tidak valid.');
  append(SHEETS.MESSAGES, [Utilities.getUuid(), text(data.phone), to, message, Date.now(), text(data.profileVersion) || '0', 'PENDING', '']);
  return ok();
}

function pollMessages(data) {
  try { requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const messages = rows(SHEETS.MESSAGES).filter(function(item) {
    return text(item.toPhone) === text(data.phone) && text(item.status) !== 'ACKED';
  }).map(function(item) {
    return { id: text(item.id), fromPhone: text(item.fromPhone), payload: text(item.payload), timestamp: Number(item.timestamp), profileVersion: text(item.profileVersion) };
  });
  return ok({ messages: messages });
}

function acknowledgeMessages(data) {
  try { requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const ids = Array.isArray(data.messageIds) ? data.messageIds.map(text) : [];
  rows(SHEETS.MESSAGES).forEach(function(item) {
    if (ids.includes(text(item.id)) && text(item.toPhone) === text(data.phone)) {
      const values = [item.id, item.fromPhone, item.toPhone, item.payload, item.timestamp, item.profileVersion, 'ACKED', now()];
      updateRow(SHEETS.MESSAGES, item._row, values);
    }
  });
  return ok();
}

function profileRow(phone) {
  return rows(SHEETS.PROFILES).find(function(item) { return text(item.phone) === text(phone); }) || null;
}

function getProfileMetadata(data) {
  const profile = profileRow(data.targetPhone);
  return ok({ profileVersion: profile ? text(profile.profileVersion) : null });
}

function getProfilePhoto(data) {
  const profile = profileRow(data.targetPhone);
  if (!profile || !text(profile.fileId)) return ok({ profilePhoto: null });
  try {
    const bytes = DriveApp.getFileById(text(profile.fileId)).getBlob().getBytes();
    return ok({ profilePhoto: Utilities.base64Encode(bytes) });
  } catch (error) {
    return ok({ profilePhoto: null });
  }
}

function updateProfile(data) {
  try { requireDevice(data); } catch (error) { return fail('INVALID_TOKEN', error.message); }
  const phone = text(data.phone);
  const existing = profileRow(phone);
  let fileId = existing ? text(existing.fileId) : '';
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) {}
  }
  if (text(data.profilePhoto)) {
    const bytes = Utilities.base64Decode(text(data.profilePhoto));
    fileId = DriveApp.createFile(Utilities.newBlob(bytes, 'image/jpeg', 'kawanchat-' + phone + '.jpg')).getId();
  } else {
    fileId = '';
  }
  const values = [phone, text(data.profileVersion) || 'none', fileId, now()];
  if (existing) updateRow(SHEETS.PROFILES, existing._row, values);
  else append(SHEETS.PROFILES, values);
  return ok();
}

const ACTIONS = {
  setupDatabase: setupDatabase,
  registerDevice: registerDevice,
  validateDevice: validateDevice,
  getDeviceStatus: getDeviceStatus,
  createPairing: createPairing,
  getPairingStatus: getPairingStatus,
  scanPairingToken: scanPairingToken,
  approvePairing: approvePairing,
  rejectPairing: rejectPairing,
  completePairing: completePairing,
  sendMessage: sendMessage,
  pollMessages: pollMessages,
  acknowledgeMessages: acknowledgeMessages,
  getProfileMetadata: getProfileMetadata,
  getProfilePhoto: getProfilePhoto,
  updateProfile: updateProfile,
};
