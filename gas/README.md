# KawanChat Google Apps Script

## Setup

1. Buka spreadsheet dengan ID `1744HSisDQd3kt2bAa38aOacDLNtXH9O7ldL1t9PxrSs`.
2. Buka **Extensions > Apps Script**.
3. Salin isi `gas/Code.gs` ke file `Code.gs` di Apps Script.
4. Simpan, lalu jalankan fungsi `setupDatabase` sekali dari editor Apps Script.
5. Izinkan akses Google Sheets dan Google Drive saat diminta.
6. Pilih **Deploy > New deployment**.
7. Pilih tipe **Web app**.
8. Set **Execute as** ke akun pemilik script.
9. Set **Who has access** ke **Anyone**.
10. Deploy dan salin URL `/exec` ke `src/js/config.js` pada `GAS_API_URL`.

## Sheet yang dibuat otomatis

- `Devices`: nomor, device ID, token, dan status perangkat.
- `Pairings`: token QR dan status pairing.
- `Messages`: antrean pesan dan status acknowledgement.
- `Profiles`: versi profil dan ID file foto di Google Drive.

Jangan menghapus baris header. Fungsi `setupDatabase` aman dijalankan ulang.

## Catatan deployment

Setiap kali mengubah `Code.gs`, buat deployment version baru atau pilih **Deploy > Manage deployments > Edit > New version**. Frontend harus memakai URL Web App deployment, bukan URL editor Apps Script atau URL spreadsheet.
