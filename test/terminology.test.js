const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { toUniversalTerms } = require("../public/universal-copy");

test("istilah sekolah diubah menjadi istilah absensi umum", () => {
  assert.equal(toUniversalTerms("Siswa"), "Anggota");
  assert.equal(toUniversalTerms("Data Guru"), "Data Petugas");
  assert.equal(toUniversalTerms("Kelas dan Mata Pelajaran"), "Unit dan Aktivitas");
  assert.equal(toUniversalTerms("Lokasi sekolah disimpan."), "Lokasi kegiatan disimpan.");
  assert.equal(toUniversalTerms("Wali Kelas membuka Bot Siswa"), "Pengelola Unit membuka Bot Anggota");
});

test("semua halaman utama memuat lapisan terminologi universal", () => {
  for (const file of ["index.html", "camera.html", "permission.html", "teacher-camera.html", "teachers.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    assert.match(html, /src="\/universal-copy\.js"/);
  }
});

test("dashboard mengenalkan produk sebagai sistem absensi universal", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /Sistem Absensi Universal/);
  assert.match(html, /Absen Anggota/);
  assert.match(html, /Absen Petugas/);
});

test("ekspor petugas memakai istilah universal", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "teacher-attendance.js"), "utf8");
  assert.match(source, /addWorksheet\("Kehadiran Petugas"\)/);
  assert.match(source, /\["Petugas", "teacher"/);
  assert.match(source, /\["Unit", "className"/);
  assert.match(source, /\["Aktivitas", "subject"/);
  assert.match(source, /laporan-kehadiran-petugas/);
});
