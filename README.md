# Ruang Hadir

Ruang Hadir adalah sistem absensi umum berbasis WhatsApp untuk organisasi, kantor, komunitas, kepanitiaan, tempat pelatihan, dan kegiatan lain. Sistem mencatat kehadiran dengan verifikasi wajah, lokasi, jadwal, izin, notifikasi, serta laporan web.

## Model penggunaan

Ruang Hadir menyediakan alur kehadiran anggota yang dapat dipakai oleh beragam organisasi:

- **Anggota** memakai jadwal masuk dan pulang harian. Anggota ditempatkan dalam unit dan dapat memiliki nomor kontak darurat.

Istilah tersebut sengaja bersifat umum. Unit dapat berarti divisi, cabang, regu, kelompok, kelas, lokasi, atau tim.

## Fitur

- Absensi masuk dan pulang melalui tautan kamera sekali pakai.
- Verifikasi selfie dengan foto referensi.
- Validasi GPS terhadap titik lokasi kegiatan.
- Izin dua tahap dengan selfie dan bukti pendukung.
- Pengelolaan anggota, unit, jadwal, izin, dan pengguna.
- Bot WhatsApp anggota untuk setiap unit.
- Notifikasi kepada admin, pengelola unit, dan kontak darurat.
- Laporan harian dan ekspor Excel.
- Branding nama aplikasi dan logo.
- Penyimpanan SQLite serta antrean notifikasi persisten.

## Peran dashboard

| Peran | Fungsi |
| --- | --- |
| Administrator | Mengelola seluruh data, akun, konfigurasi, dan laporan. |
| Pengelola Unit | Mengelola anggota dan Bot Anggota pada unit yang menjadi tanggung jawabnya. |

Dashboard memakai role `admin` dan `wali_kelas`. Data role lama tetap disimpan agar pembaruan tidak menghapus data secara otomatis, tetapi role tersebut tidak dapat masuk ke dashboard.

## Perintah WhatsApp

### Bot Anggota

| Perintah | Fungsi | Akses |
| --- | --- | --- |
| `!masuk` | Membuka absensi masuk | Anggota terdaftar |
| `!pulang` | Membuka absensi pulang | Anggota terdaftar |
| `!izin alasan` | Membuka pengajuan izin | Anggota terdaftar |
| `!lokasi` | Mengatur titik lokasi kegiatan | Administrator |
| `!bantuan` | Menampilkan bantuan sesuai peran | Semua pengguna |

Anggota harus mengirim perintah ke nomor Bot Anggota milik unitnya. Tautan masuk atau pulang berlaku selama dua menit. Tautan izin berlaku selama lima menit.

## Persyaratan

- Node.js 22.12 atau lebih baru.
- npm.
- Nomor WhatsApp untuk Bot Anggota.
- HTTPS untuk halaman kamera pada penggunaan di luar localhost.

## Instalasi

```bash
git clone <alamat-repository>
cd absensi-universal
npm install
cp .env.example .env
```

Pada PowerShell:

```powershell
Copy-Item .env.example .env
```

Isi `INITIAL_ADMIN_NUMBER`, `INITIAL_ADMIN_USERNAME`, dan `INITIAL_ADMIN_PASSWORD` pada `.env`. Gunakan kode negara tanpa tanda `+`. Nomor Indonesia yang diawali `08` ditulis menjadi `628`.

## Konfigurasi

| Berkas | Kegunaan |
| --- | --- |
| `roles.example.json` | Contoh akun dan peran awal |
| `lokasi.example.json` | Contoh titik lokasi kegiatan |
| `jam.example.json` | Contoh jadwal masuk dan pulang |

Variabel lingkungan utama:

| Variabel | Nilai awal | Keterangan |
| --- | ---: | --- |
| `TZ` | `Asia/Jakarta` | Zona waktu aplikasi |
| `DB_PATH` | `data/absensi.sqlite` | Lokasi database SQLite |
| `PUBLIC_BASE_URL` | `http://localhost:3200` | Alamat publik untuk tautan kamera |
| `PORT` | `3200` | Port HTTP lokal aplikasi |
| `INITIAL_ADMIN_NUMBER` | kosong | Nomor administrator pertama |
| `INITIAL_ADMIN_USERNAME` | kosong | Username administrator pertama |
| `INITIAL_ADMIN_PASSWORD` | kosong | Password administrator pertama, minimal 10 karakter |
| `TRUST_PROXY_HOPS` | `0` | Jumlah reverse proxy tepercaya |
| `SESSION_COOKIE_SECURE` | otomatis | Paksa cookie sesi melalui HTTPS |
| `BAILEYS_AUTH_DATA_PATH` | `.baileys_auth` | Direktori sesi WhatsApp |
| `FACE_WORKER_COUNT` | `1` | Jumlah worker verifikasi wajah |
| `FACE_QUEUE_LIMIT` | `100` | Batas antrean verifikasi |
| `FACE_TIMEOUT_MS` | `60000` | Batas waktu verifikasi dalam milidetik |
| `WA_SEND_SAFETY_MODE` | `automatic` | Pengaturan ritme pengiriman WhatsApp |
| `NOTIFICATION_OUTBOX_CONCURRENCY` | `4` | Jumlah notifikasi yang diproses bersamaan |

Lihat `.env.example` untuk daftar lengkap pengaturan performa, antrean, dan pengiriman WhatsApp.

## Menjalankan aplikasi

```bash
node index.js
```

Buka dashboard di `http://localhost:3200`. Setelah masuk:

1. Buat unit.
2. Buat akun pengelola unit bila diperlukan.
3. Tambahkan anggota dan foto referensinya.
4. Hubungkan nomor pada **Pengaturan > Bot Anggota**.
5. Atur titik lokasi kegiatan dengan perintah `!lokasi`.

Untuk produksi dengan PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

## Kompatibilitas data lama

Nama file dan field JSON lama seperti `siswa` dan `kelas` tetap dipertahankan sebagai format penyimpanan kompatibel. Data lama fitur petugas tidak dihapus otomatis, tetapi fitur, halaman, endpoint, dan botnya tidak lagi dijalankan. Data JSON lain tetap dapat diimpor saat startup, lalu perubahan berikutnya disimpan di SQLite.

Direktori `.baileys_auth`, `data`, `face_db`, `face_rec`, `attendance_photos`, `izin_bukti`, `brand`, dan `exports` berisi data privat atau sensitif dan tidak boleh dimasukkan ke Git.

## Pengujian

```bash
npm test
npm run build:css
```

Pengujian mencakup aturan kehadiran, lokasi, keamanan web, autentikasi, penyimpanan, QR, antrean, dan pengiriman WhatsApp.

## Catatan keamanan

- Gunakan HTTPS untuk akses kamera dan GPS.
- Jangan membagikan direktori sesi `.baileys_auth`.
- Batasi akses dashboard ke pengguna yang berwenang.
- Ganti kredensial administrator awal setelah pemasangan.
- Cadangkan database dan foto referensi secara berkala.
- Pencocokan wajah belum merupakan pemeriksaan liveness.
- Browser dapat mengirim gambar atau koordinat yang sudah dimanipulasi. Sistem membantu verifikasi operasional, tetapi tidak menjamin pencegahan foto lama atau GPS palsu.
