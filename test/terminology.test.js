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

test("dashboard tidak menawarkan fitur absen petugas", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /Absen Anggota/);
  assert.doesNotMatch(html, /label:"Absen Petugas"/);
  assert.doesNotMatch(html, /id:"bot-tu"/);
});
