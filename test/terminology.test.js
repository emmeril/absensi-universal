const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { toUniversalTerms } = require("../public/universal-copy");

test("istilah sekolah diubah menjadi istilah absensi umum", () => {
  assert.equal(toUniversalTerms("Siswa"), "Anggota");
  assert.equal(toUniversalTerms("Kelas"), "Unit");
  assert.equal(toUniversalTerms("Lokasi sekolah disimpan."), "Lokasi kegiatan disimpan.");
  assert.equal(toUniversalTerms("Wali Kelas membuka Bot Siswa"), "Pengelola Unit membuka Bot Anggota");
});

test("semua halaman anggota memuat lapisan terminologi universal", () => {
  for (const file of ["index.html", "camera.html", "permission.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    assert.match(html, /src="\/universal-copy\.js"/);
  }
});

test("teks dashboard menggunakan istilah anggota dan unit secara langsung", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

  assert.match(html, /placeholder="Cari nama, unit, atau status\.\.\."/);
  assert.match(html, /placeholder="Cari unit atau pengelola unit\.\.\."/);
  assert.match(html, /placeholder="Cari anggota, unit, atau alasan\.\.\."/);
  assert.match(html, /placeholder="Contoh: Divisi Operasional"/);
  assert.doesNotMatch(html, /placeholder="[^"]*\bkelas\b/i);
  assert.doesNotMatch(html, />\s*(?:Siswa|Kelas|Wali Kelas|Orang Tua)\s*</i);
  assert.doesNotMatch(html, /(?:data|absensi) sekolah/i);
});

test("pesan API dan WhatsApp menggunakan istilah universal", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

  assert.match(server, /Pengelolaan anggota, unit, jadwal, izin, admin, dan laporan/);
  assert.match(server, /Pengelola unit hanya dapat mengunggah foto anggota di unitnya/);
  assert.doesNotMatch(server, /Hubungi admin sekolah/);
  assert.doesNotMatch(server, /Lokasi sekolah/);
  assert.doesNotMatch(server, /Izin Siswa/);
});

test("dashboard tidak menawarkan fitur absen petugas", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /Absen Anggota/);
  assert.doesNotMatch(html, /label:"Absen Petugas"/);
  assert.doesNotMatch(html, /id:"bot-tu"/);
});
