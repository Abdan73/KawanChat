/**
 * pairing.js
 * KawanChat — QR Device Pairing Manager
 *
 * Mengelola seluruh flow pairing:
 * - Perangkat LAMA: generate pairing token → tampilkan QR → poll untuk approval request → approve/reject
 * - Perangkat BARU: scan QR (kamera/manual) → kirim scan token → tunggu completePairing
 */

import { Api } from './api.js';
import { Storage } from './storage.js';
import { Device } from './device.js';
import { Config } from './config.js';

// ─── Internal state ───────────────────────────────────────────────────────────
let _pairingPollTimer = null;
let _countdownTimer   = null;
let _videoStream      = null;
let _scanAnimFrame    = null;
let _currentPairingId = null;
let _currentToken     = null;

export const Pairing = {

  // ─── QR Generation (OLD device) ──────────────────────────────────────────

  /**
   * Buat pairing token di backend dan generate QR di canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {Function} onStatusChange - Callback (status: string, data: any)
   * @param {HTMLElement} countdownEl - Element untuk countdown
   */
  async startQrGeneration(canvas, onStatusChange, countdownEl) {
    const { phone, deviceId, deviceToken } = Device.getCredentials();

    // Buat pairing di backend
    const result = await Api.createPairing({ phone, deviceId, deviceToken });
    if (!result.success) {
      throw new Error(result.message || 'Gagal membuat pairing token.');
    }

    const { pairingId, token, expiresAt } = result.data;
    _currentPairingId = pairingId;
    _currentToken     = token;

    // Render QR
    await Pairing._renderQr(canvas, token);

    // Mulai countdown
    Pairing._startCountdown(expiresAt, countdownEl);

    // Mulai polling status pairing (menunggu new device scan)
    Pairing._startPairingPoll(pairingId, onStatusChange);

    return { pairingId, token };
  },

  /**
   * Render QR Code ke canvas menggunakan library qrcode.
   */
  async _renderQr(canvas, token) {
    try {
      const QRCode = (await import('qrcode')).default;
      await QRCode.toCanvas(canvas, token, {
        width:            200,
        margin:           2,
        color: {
          dark:  '#1e293b',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      console.error('[Pairing] QR render error:', err);
      throw new Error('Gagal menampilkan QR Code.');
    }
  },

  /**
   * Countdown timer berdasarkan expiresAt timestamp.
   */
  _startCountdown(expiresAtMs, countdownEl) {
    if (_countdownTimer) clearInterval(_countdownTimer);
    _countdownTimer = setInterval(() => {
      const remaining = Math.max(0, expiresAtMs - Date.now());
      const minutes   = Math.floor(remaining / 60000);
      const seconds   = Math.floor((remaining % 60000) / 1000);
      if (countdownEl) {
        countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      if (remaining <= 0) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
      }
    }, 500);
  },

  /**
   * Poll backend untuk mengetahui apakah new device sudah scan QR.
   */
  _startPairingPoll(pairingId, onStatusChange) {
    Pairing._stopPairingPoll();
    const { phone, deviceId, deviceToken } = Device.getCredentials();

    const doPoll = async () => {
      try {
        const result = await Api.getPairingStatus({ pairingId, phone, deviceId, deviceToken });
        if (result.success && result.data) {
          const { status } = result.data;
          onStatusChange(status, result.data);

          // Jika sudah final, stop polling
          if (['APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED'].includes(status)) {
            Pairing._stopPairingPoll();
            return;
          }
        }
      } catch {
        // Polling error — lanjutkan
      }
      _pairingPollTimer = setTimeout(doPoll, Config.PAIRING_POLL_INTERVAL_MS);
    };

    _pairingPollTimer = setTimeout(doPoll, Config.PAIRING_POLL_INTERVAL_MS);
  },

  _stopPairingPoll() {
    if (_pairingPollTimer) {
      clearTimeout(_pairingPollTimer);
      _pairingPollTimer = null;
    }
    if (_countdownTimer) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
    }
  },

  // ─── Approve / Reject (OLD device) ───────────────────────────────────────

  async approve(pairingId) {
    const { phone, deviceId, deviceToken } = Device.getCredentials();
    return Api.approvePairing({ pairingId, phone, deviceId, deviceToken });
  },

  async reject(pairingId) {
    const { phone, deviceId, deviceToken } = Device.getCredentials();
    return Api.rejectPairing({ pairingId, phone, deviceId, deviceToken });
  },

  getCurrentPairingId() { return _currentPairingId; },

  // ─── QR Scanner (NEW device) ──────────────────────────────────────────────

  /**
   * Mulai kamera untuk scan QR.
   * @param {HTMLVideoElement} videoEl
   * @param {Function} onDetected  - Callback saat token terdeteksi
   * @param {Function} onError     - Callback saat kamera error
   */
  async startCamera(videoEl, onDetected, onError) {
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 640 },
      });
      videoEl.srcObject = _videoStream;
      await videoEl.play();

      Pairing._scanLoop(videoEl, onDetected);
      return true;
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Izin kamera ditolak. Aktifkan izin kamera di browser.'
        : 'Kamera tidak dapat diakses: ' + err.message;
      onError(msg);
      return false;
    }
  },

  /**
   * Scan loop — menggunakan BarcodeDetector API atau jsQR fallback.
   */
  _scanLoop(videoEl, onDetected) {
    let detected = false;

    const tick = async () => {
      if (detected || !videoEl.srcObject) return;

      try {
        let token = null;

        // ── BarcodeDetector API (Chrome/Edge modern) ──
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const barcodes = await detector.detect(videoEl);
          if (barcodes.length > 0) token = barcodes[0].rawValue;
        } else {
          // ── jsQR fallback ──
          token = Pairing._scanWithJsQr(videoEl);
        }

        if (token && token.length > 10) {
          detected = true;
          Pairing.stopCamera();
          onDetected(token);
          return;
        }
      } catch {
        // Frame tidak siap, coba lagi
      }

      _scanAnimFrame = requestAnimationFrame(tick);
    };

    _scanAnimFrame = requestAnimationFrame(tick);
  },

  /**
   * Scan menggunakan jsQR (library).
   */
  _scanWithJsQr(videoEl) {
    try {
      const canvas  = document.createElement('canvas');
      const w       = videoEl.videoWidth;
      const h       = videoEl.videoHeight;
      if (!w || !h) return null;
      canvas.width  = w;
      canvas.height = h;
      const ctx     = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      // jsQR diimport secara dynamic
      const jsQR     = window._jsQR;
      if (!jsQR) return null;
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      return code ? code.data : null;
    } catch {
      return null;
    }
  },

  stopCamera() {
    if (_scanAnimFrame) {
      cancelAnimationFrame(_scanAnimFrame);
      _scanAnimFrame = null;
    }
    if (_videoStream) {
      _videoStream.getTracks().forEach((t) => t.stop());
      _videoStream = null;
    }
  },

  /**
   * Kirim token yang di-scan ke backend.
   */
  async submitScan(phone, token) {
    const deviceId = Device.getId();
    return Api.scanPairingToken({ phone, deviceId, token });
  },

  /**
   * Complete pairing setelah approved oleh old device.
   */
  async complete(pairingId, phone, newToken) {
    const newDeviceId = Device.getId();
    const result = await Api.completePairing({ pairingId, phone, newDeviceId, token: newToken });
    if (result.success && result.data?.deviceToken) {
      // Simpan token baru
      Device.saveToken(result.data.deviceToken);
      Storage.setPhone(phone);
    }
    return result;
  },

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  cleanup() {
    Pairing._stopPairingPoll();
    Pairing.stopCamera();
    _currentPairingId = null;
    _currentToken     = null;
  },
};
