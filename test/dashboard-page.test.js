const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const dashboardPage = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "index.js"), "utf8");
const dashboardStyles = fs.readFileSync(path.join(root, "assets", "dashboard.css"), "utf8");

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

test("unit kosong dapat dipilih saat menambah pengelola unit", () => {
  assert.match(
    dashboardPage,
    /:disabled="Boolean\(k\.waliKelas && k\.nama!==adminForm\.className\)"/,
  );
  assert.doesNotMatch(
    dashboardPage,
    /:disabled="k\.namaWali && k\.nama!==adminForm\.className"/,
  );
});

test("Administrator dapat mengatur cakupan notifikasi per Unit", () => {
  assert.match(dashboardPage, /Notifikasi Absensi/);
  assert.match(dashboardPage, /value="all"/);
  assert.match(dashboardPage, /value="selected"/);
  assert.match(dashboardPage, /value="none"/);
  assert.match(dashboardPage, /:disabled="!canDisableAdminNotifications"/);
  assert.match(dashboardPage, /x-model="adminForm\.notificationUnits"/);
  assert.match(server, /ADMIN_NOTIFICATIONS_PATH/);
  assert.match(server, /assertAdminNotificationPolicy/);
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

test("kontak darurat anggota bersifat opsional", () => {
  assert.match(dashboardPage, /WhatsApp Kontak Darurat \(opsional\)/);
  assert.match(server, /if \(orangTua && !\/\^62\\d\{8,14\}\$\/\.test\(orangTua\)\)/);
  assert.match(server, /orangTua: orangTua \? `\$\{orangTua\}@c\.us` : ""/);
});

test("ringkasan tetap memakai tabel harian tanpa fitur unduh Excel", () => {
  assert.match(dashboardPage, /id:"laporan",label:"Laporan Absensi",icon:"fa-solid fa-clipboard-list"/);
  assert.match(dashboardPage, /tab === 'ringkasan'/);
  assert.match(dashboardPage, /tab === 'laporan'/);
  assert.match(dashboardPage, /studentDailyReportControls/);
  const ringkasanMarkup = dashboardPage.slice(
    dashboardPage.indexOf("tab === 'ringkasan'"),
    dashboardPage.indexOf("tab === 'laporan'")
  );
  assert.doesNotMatch(ringkasanMarkup, /Unduh Excel/);
});

test("submenu laporan menampilkan tabel rentang tanggal dan unduhan Excel", () => {
  assert.match(dashboardPage, /rangeStartDate/);
  assert.match(dashboardPage, /rangeEndDate/);
  assert.match(dashboardPage, /aria-label="Filter unit laporan absensi"/);
  assert.match(dashboardPage, /rangeUnitFilter/);
  assert.match(dashboardPage, /pagedRangeReport/);
  assert.match(dashboardPage, /rangeReportRecapRows/);
  assert.match(dashboardPage, />Total Hari</);
  assert.match(dashboardPage, />Belum Pulang</);
  assert.match(dashboardPage, /\/api\/report-range\?\$\{this\.rangeReportQuery\(\)\}/);
  assert.match(dashboardPage, /\/api\/export\?\$\{this\.rangeReportQuery\(\)\}/);
  assert.match(dashboardPage, /Unduh Excel/);

  const inlineScript = dashboardPage.match(/<script>\s*(function dashboard\(\)[\s\S]*?)<\/script>/);
  assert.ok(inlineScript, "skrip dashboard ditemukan");
  const historyCalls = [];
  const context = {
    history: { replaceState: (...args) => historyCalls.push(args) },
    location: { hash: "" },
  };
  vm.runInNewContext(`${inlineScript[1]}\nstate = dashboard();`, context);
  const state = context.state;
  state.user = { role: "wali_kelas" };
  state.loading = false;
  state.data.whatsappBots = [];
  state.rangeReportLoaded = true;
  state.rangeReport = { startDate: "2026-10-25", endDate: "2026-10-26", rows: [
    { tanggal: "2026-10-25", nomor: "621", nama: "Anggota A", kelas: "Operasional", masuk: "07:55", pulang: "17:00", statusMasuk: "Tepat Waktu", izin: "" },
    { tanggal: "2026-10-26", nomor: "621", nama: "Anggota A", kelas: "Operasional", masuk: "08:20", pulang: "-", statusMasuk: "Terlambat", izin: "" },
    { tanggal: "2026-10-25", nomor: "622", nama: "Anggota B", kelas: "Gudang", masuk: "-", pulang: "-", statusMasuk: "-", izin: "Sakit" },
    { tanggal: "2026-10-26", nomor: "622", nama: "Anggota B", kelas: "Gudang", masuk: "-", pulang: "-", statusMasuk: "-", izin: "" },
  ] };
  state.rangeStartDate = "2026-10-25";
  state.rangeEndDate = "2026-10-26";

  assert.equal(state.rangeReportPeriodLabel, "25/10/2026 sampai 26/10/2026 · Semua unit · 2 anggota · 4 catatan");
  assert.deepEqual(
    Array.from(state.pagedRangeReport, (row) => ({ ...row })),
    [
      { nomor: "621", nama: "Anggota A", kelas: "Operasional", totalHari: 2, hadir: 2, tepatWaktu: 1, terlambat: 1, izin: 0, belumHadir: 0, sudahPulang: 1, belumPulang: 1 },
      { nomor: "622", nama: "Anggota B", kelas: "Gudang", totalHari: 2, hadir: 0, tepatWaktu: 0, terlambat: 0, izin: 1, belumHadir: 1, sudahPulang: 0, belumPulang: 0 },
    ]
  );
  state.rangeUnitFilter = "Gudang & Logistik";
  assert.equal(
    state.rangeReportQuery(),
    "startDate=2026-10-25&endDate=2026-10-26&unit=Gudang%20%26%20Logistik"
  );

  assert.ok(state.visibleTabs.some((item) => item.id === "laporan"));
  state.changeTab("laporan");
  assert.equal(state.tab, "laporan");
  assert.equal(historyCalls.at(-1)[2], "#laporan");
  assert.equal(state.formatReportDate("2026-10-26"), "26/10/2026");
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

test("tombol dashboard memiliki target sentuh dan susunan mobile yang konsisten", () => {
  assert.match(dashboardStyles, /min-height: 2\.75rem/);
  assert.match(dashboardStyles, /min-width: 2\.75rem/);
  assert.match(dashboardStyles, /button:focus-visible/);
  assert.match(dashboardStyles, /@media \(max-width: 639px\)/);
  assert.match(
    dashboardStyles,
    /\.admin-card > div > div\[x-show\] > \.mb-5\.flex \{[\s\S]*?gap: 1rem/,
  );
  assert.match(dashboardStyles, /dashboard-modal form > \.border-t:last-child/);
  assert.match(dashboardPage, /aria-label="Buka atau tutup menu navigasi"/);
  assert.match(dashboardPage, /aria-label="Tutup dialog"/);
});

test("isi semua tabel tetap sejajar dalam satu baris", () => {
  assert.match(
    dashboardPage,
    /\.data-table th, \.data-table td \{[^}]*vertical-align: middle;[^}]*white-space: nowrap;/,
  );
  assert.match(
    dashboardStyles,
    /\.data-table td > \[class="flex justify-center gap-1"\] \{[^}]*flex-wrap: nowrap;/,
  );
  assert.match(
    dashboardStyles,
    /\[class\*="overflow-x-auto"\] \+ \[class\*="mt-4"\] \{[^}]*flex-direction: column;/,
  );
});

test("tombol kamera dan izin menumpuk penuh pada layar sempit", () => {
  for (const file of ["camera.html", "permission.html"]) {
    const page = fs.readFileSync(path.join(root, "public", file), "utf8");
    assert.match(page, /col-12 col-sm-6/);
    assert.match(page, /\.btn:focus-visible/);
    assert.doesNotMatch(page, /<div class="col-6">/);
  }
});
