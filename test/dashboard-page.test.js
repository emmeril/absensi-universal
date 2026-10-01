const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dashboardPage = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("dashboard hanya memuat aset lokal", () => {
  assert.doesNotMatch(dashboardPage, /https?:\/\//);
  assert.match(dashboardPage, /src="\/vendor\/alpine\.min\.js"/);
  assert.match(dashboardPage, /href="\/vendor\/fontawesome\/css\/all\.min\.css"/);
});

test("dashboard login memakai username dan password tanpa OTP", () => {
  assert.match(dashboardPage, /autocomplete="username"/);
  assert.match(dashboardPage, /autocomplete="current-password"/);
  assert.match(dashboardPage, /loginDashboard/);
  assert.doesNotMatch(dashboardPage, /request-otp|Kode OTP|verifyOtp/);
});

test("halaman login hanya mengenalkan absensi anggota", () => {
  assert.match(dashboardPage, /Pantau kehadiran anggota dalam satu panel/);
  assert.match(dashboardPage, /Kelola anggota, unit, jadwal, izin, dan laporan harian/);
  assert.doesNotMatch(dashboardPage, /Pantau anggota dan petugas/);
});

test("fitur absen petugas tidak dimuat atau didaftarkan", () => {
  assert.doesNotMatch(dashboardPage, /src="\/teachers\.js"/);
  assert.doesNotMatch(dashboardPage, /label:"Absen Petugas"/);
  assert.doesNotMatch(dashboardPage, /id:"bot-tu"/);
  assert.doesNotMatch(server, /createTeacherAttendance|registerCamera\(app|registerAdmin\(app/);
  assert.doesNotMatch(server, /app\.(?:get|post|patch|delete)\("\/api\/teachers/);
  assert.doesNotMatch(server, /app\.(?:get|post)\("\/api\/teacher-camera/);
});

test("role dashboard hanya administrator dan pengelola unit", () => {
  assert.match(dashboardPage, /value="admin">Administrator/);
  assert.match(dashboardPage, /value="wali_kelas">Pengelola Unit/);
  assert.doesNotMatch(dashboardPage, /value="tu"/);
  assert.match(server, /\["admin", "wali_kelas"\]\.includes\(role\)/);
});

test("sidebar hanya memuat kelompok absen anggota", () => {
  assert.match(dashboardPage, /label:"Absen Anggota"/);
  assert.doesNotMatch(dashboardPage, /teacherMenuOpen/);
  assert.match(dashboardPage, /\["brand","whatsapp","admin"\]/);
});

test("koneksi WhatsApp hanya menampilkan bot anggota", () => {
  assert.match(server, /bot\.role !== "tu"/);
  assert.match(dashboardPage, /Nomor pengelola unit/);
});

test("semua input password menyediakan kontrol visibilitas", () => {
  assert.match(dashboardPage, /showLoginPassword/);
  assert.match(dashboardPage, /showAdminPassword/);
  assert.match(dashboardPage, /Tampilkan password/);
  assert.match(dashboardPage, /Sembunyikan password/);
});

test("tabel anggota tetap memiliki filter, sortir, dan pagination", () => {
  assert.match(dashboardPage, /tables\.students\.search/);
  assert.match(dashboardPage, /toggleSort\('students','name'\)/);
  assert.match(dashboardPage, /prevPage\('students'\)/);
  assert.match(dashboardPage, /nextPage\('students',filteredStudents\.length\)/);
});

test("laporan anggota menyediakan tanggal dan ekspor", () => {
  assert.match(dashboardPage, /studentDailyReportControls/);
  assert.match(dashboardPage, /exportStudentReport\(\)/);
  assert.match(dashboardPage, /\/api\/export\?startDate=/);
});

test("pengaturan brand tetap memiliki pratinjau dan unggah logo", () => {
  assert.match(dashboardPage, /brandLogoPreview/);
  assert.match(dashboardPage, /accept="image\/png,image\/jpeg/);
  assert.match(dashboardPage, /saveBrand/);
});

test("menu akun menyediakan informasi pengguna dan logout", () => {
  assert.match(dashboardPage, /userMenuOpen/);
  assert.match(dashboardPage, /roleLabel\(user\?\.role\)/);
  assert.match(dashboardPage, /@click="logout\(\)"/);
});
