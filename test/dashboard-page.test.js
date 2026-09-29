const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboardPage = fs.readFileSync(
  path.join(__dirname, "..", "public", "index.html"),
  "utf8"
);
const teacherScript = fs.readFileSync(
  path.join(__dirname, "..", "public", "teachers.js"),
  "utf8"
);

test("dashboard hanya memuat aset lokal", () => {
  assert.match(dashboardPage, /\/dashboard\.css/);
  assert.match(dashboardPage, /\/vendor\/alpine\.min\.js/);
  assert.doesNotMatch(dashboardPage, /https?:\/\/|cdn\.|jsdelivr|cdnjs/);
});

test("form edit mengirim identitas asli siswa dan kelas", () => {
  assert.match(dashboardPage, /originalNomor:s\.nomor/);
  assert.match(dashboardPage, /originalNama:k\.nama/);
});

test("dashboard login memakai username dan password tanpa OTP", () => {
  assert.match(dashboardPage, /loginDashboard/);
  assert.match(dashboardPage, /login\.username/);
  assert.match(dashboardPage, /login\.password/);
  assert.doesNotMatch(dashboardPage, /request-otp|Kode OTP|verifyOtp/);
});

test("halaman login mencakup pengelolaan absensi guru", () => {
  assert.match(dashboardPage, /Pantau kehadiran siswa dan guru dalam satu panel/);
  assert.match(dashboardPage, /Kelola siswa, guru, kelas, jadwal mengajar, izin, dan laporan harian/);
});

test("form management user mengelola akun admin dan wali kelas", () => {
  assert.match(dashboardPage, /Tambah User/);
  assert.match(dashboardPage, /adminForm\.role/);
  assert.match(dashboardPage, /adminForm\.className/);
  assert.match(dashboardPage, /value="tu">Tata Usaha/);
  assert.match(dashboardPage, /adminForm\.username/);
  assert.match(dashboardPage, /adminForm\.password/);
});

test("notifikasi absensi guru dikirim ke admin dan tata usaha", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(server, /\["admin", "tu"\]\.includes\(role\)/);
  assert.match(server, /teacher-attendance:\$\{record\.key\}/);
});

test("wali kelas disinkronkan ke data guru", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(server, /KELAS_PATH, KONTAK_PATH, TEACHERS_PATH/);
  assert.match(server, /teacherConfig\.teachers\[nomor\] = \{ \.\.\.teacherConfig\.teachers\[nomor\], name: nama, active: true \}/);
  assert.match(server, /async function syncWaliKelasToTeachers\(\)/);
});

test("master kelas siswa dan guru disinkronkan", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(server, /async function syncClassCatalogs\(\)/);
  assert.match(server, /KELAS_PATH, TEACHERS_PATH/);
  assert.match(server, /Kelas masih digunakan pada jadwal mengajar/);
});

test("semua input password memiliki placeholder dan tombol tampilkan password", () => {
  assert.match(dashboardPage, /placeholder="Masukkan password"/);
  assert.match(dashboardPage, /Minimal 10 karakter/);
  assert.match(dashboardPage, /showLoginPassword \? 'text' : 'password'/);
  assert.match(dashboardPage, /showAdminPassword \? 'text' : 'password'/);
  assert.match(dashboardPage, /fa-eye-slash/);
  assert.match(dashboardPage, /aria-label/);
});

test("koneksi WhatsApp tersedia untuk admin dan wali kelas", () => {
  assert.match(dashboardPage, /id:"whatsapp",label:"Bot Siswa"/);
  assert.match(dashboardPage, /\["ringkasan","siswa","whatsapp"\]/);
  assert.match(dashboardPage, /tab === 'whatsapp'/);
  assert.match(dashboardPage, /\/api\/whatsapp\/\$\{encodeURIComponent\(bot\.key\)\}\/qr\.svg/);
  assert.match(dashboardPage, /resetWhatsapp\(bot\)/);
  assert.doesNotMatch(dashboardPage, /href="\/qr"/);
  assert.doesNotMatch(dashboardPage, /title="Status WhatsApp"/);
});

test("sidebar memisahkan absen siswa, absen guru, dan pengaturan umum", () => {
  assert.match(dashboardPage, /group in attendanceGroups/);
  assert.match(dashboardPage, /item in settingsTabs/);
  assert.match(dashboardPage, /toggleSettingsMenu\(\)/);
  assert.match(dashboardPage, /label:"Pengaturan Brand",icon:"fa-solid fa-palette"/);
  assert.match(dashboardPage, /label:"Pengaturan Jadwal",icon:"fa-solid fa-calendar-days"/);

  const script = dashboardPage.match(
    /<script>\s*(function dashboard\(\)[\s\S]*?)\s*<\/script>/
  );
  assert.ok(script, "fungsi dashboard ditemukan");
  const createDashboard = vm.runInNewContext(`${script[1]}; dashboard;`);
  const state = createDashboard();

  state.user = { role: "admin" };
  assert.deepEqual(Array.from(state.mainTabs, (item) => item.id), [
    "ringkasan",
    "siswa",
    "kelas",
    "izin",
    "pengaturan",
  ]);
  assert.deepEqual(Array.from(state.settingsTabs, (item) => item.label), [
    "Pengaturan Brand",
    "Bot Siswa",
    "Bot Guru",
    "Management User",
  ]);
  assert.deepEqual(Array.from(state.teacherTabs, (item) => item.label), ["Ringkasan", "Data Guru", "Mata Pelajaran", "Kelas", "Jam Mengajar", "Izin", "Laporan Kehadiran Guru"]);
  state.data.whatsappBots = [{ role: "tu", key: "tu:1" }, { role: "wali", key: "wali:2" }];
  state.tab = "bot-tu";
  assert.deepEqual(Array.from(state.visibleWhatsappBots, bot => bot.key), ["tu:1"]);
  state.tab = "whatsapp";
  assert.deepEqual(Array.from(state.visibleWhatsappBots, bot => bot.key), ["wali:2"]);

  state.user = { role: "teacher" };
  assert.deepEqual(Array.from(state.mainTabs, (item) => item.id), [
    "ringkasan",
    "siswa",
  ]);
  assert.deepEqual(Array.from(state.settingsTabs, (item) => item.label), ["Bot Siswa"]);
  assert.deepEqual(Array.from(state.teacherTabs), []);

  state.user = { role: "tu" };
  assert.deepEqual(Array.from(state.mainTabs), []);
  assert.deepEqual(Array.from(state.teacherTabs, (item) => item.label), ["Ringkasan", "Data Guru", "Mata Pelajaran", "Kelas", "Jam Mengajar", "Izin", "Laporan Kehadiran Guru"]);
  assert.deepEqual(Array.from(state.settingsTabs, (item) => item.label), ["Bot Guru"]);
});

test("kartu ringkasan siswa tidak tampil pada menu pengaturan", () => {
  assert.match(dashboardPage, /x-show="!isTeacherPage && !isSettingsTab"/);
});

test("notifikasi Bot Siswa tidak tampil pada menu pengaturan", () => {
  assert.match(dashboardPage, /data-bot-alert="student"[^>]+!isTeacherPage && !isSettingsTab/);
});

test("pemberitahuan bot pada menu guru hanya mengarah ke Bot Guru", () => {
  assert.match(dashboardPage, /data-bot-alert="teacher"[^>]+isTeacherTab/);
  assert.match(dashboardPage, /Bot Guru belum siap atau belum terhubung/);
  assert.match(dashboardPage, /data-bot-alert="student"[^>]+!isTeacherPage/);
  assert.doesNotMatch(dashboardPage, /currentTeacherDescription/);
});

test("pengaturan Bot Guru tidak menampilkan formulir tanggal libur", () => {
  assert.match(dashboardPage, /<h4 class="font-bold text-slate-700">Bot Guru<\/h4>/);
  assert.doesNotMatch(dashboardPage, /id="holidays"|Tanggal libur|Bot Guru & Hari Libur/);
  assert.match(teacherScript, /api\("\/settings", \{ number: \$\("tuNumber"\)\.value \}\)/);
});

test("tombol simpan Bot Guru berada di samping form nomor pada layar lebar", () => {
  assert.match(dashboardPage, /id="settingsForm" class="flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end"/);
  assert.match(dashboardPage, /id="tuNumber"[\s\S]*?<\/div>\s*<button class="teacher-button-primary w-fit shrink-0 whitespace-nowrap px-3 py-2\.5 sm:mb-6"/);
});

test("pengaturan brand mengubah nama dan mengunggah logo aplikasi", () => {
  assert.match(dashboardPage, /tab === 'brand'/);
  assert.match(dashboardPage, /@submit\.prevent="saveBrand"/);
  assert.match(dashboardPage, /x-model="brandForm\.name"/);
  assert.match(dashboardPage, /accept="image\/png,image\/jpeg,\.png,\.jpg,\.jpeg"/);
  assert.match(dashboardPage, /@change="selectBrandLogo\(\$event\)"/);
  assert.match(dashboardPage, /request\("\/api\/settings\/brand",\{method:"POST",body:form\}\)/);
  assert.match(dashboardPage, /request\("\/api\/settings\/brand\/logo",\{method:"DELETE"\}\)/);
  assert.match(dashboardPage, /document\.title=`\$\{this\.brand\.name\} \| Panel Administrasi`/);
  assert.match(dashboardPage, /x-text="brand\.name"/);
  assert.match(dashboardPage, /:src="brand\.logoUrl"/);
});

test("pengaturan brand tetap responsif pada layar mobile", () => {
  assert.match(dashboardPage, /lg:grid-cols-\[280px_minmax\(0,1fr\)\]/);
  assert.match(dashboardPage, /sm:h-32 sm:w-32/);
  assert.match(dashboardPage, /flex-col items-center justify-center[^\n]+sm:flex-row/);
  assert.match(dashboardPage, /max-w-full truncate[^\n]+brandLogoFile/);
  assert.match(dashboardPage, /grid grid-cols-1 gap-2[^\n]+sm:flex sm:justify-end/);
  assert.match(dashboardPage, /w-full rounded[^\n]+Simpan Brand/);
});

test("ikon user navbar membuka informasi akun dan tombol logout", () => {
  assert.match(dashboardPage, /userMenuOpen: false/);
  assert.match(dashboardPage, /@click="userMenuOpen=!userMenuOpen"/);
  assert.match(dashboardPage, /@click\.outside="userMenuOpen=false"/);
  assert.match(dashboardPage, /@keydown\.escape\.window="userMenuOpen=false"/);
  assert.match(dashboardPage, /:aria-expanded="userMenuOpen"/);
  assert.match(dashboardPage, /x-text="user\?\.username \|\| '-'"/);
  assert.match(dashboardPage, /x-text="user\?\.nomor \|\| '-'"/);
  assert.match(dashboardPage, /@click="logout\(\)"/);
  assert.match(dashboardPage, /async logout\(\)\{this\.userMenuOpen=false/);
});

test("semua tabel data memiliki filter dan tombol reset", () => {
  assert.match(dashboardPage, /display: flex; flex-wrap: nowrap; align-items: center; overflow-x: auto/);

  for (const table of ["report", "students", "classes", "permissions", "admins"]) {
    assert.match(dashboardPage, new RegExp(`hasTableFilters\\('${table}'\\)`));
    assert.match(dashboardPage, new RegExp(`resetTableFilters\\('${table}'\\)`));
  }

  for (const filter of [
    "report.classFilter",
    "report.statusFilter",
    "students.classFilter",
    "students.photoFilter",
    "classes.studentFilter",
    "permissions.classFilter",
    "permissions.evidenceFilter",
    "admins.accountFilter",
    "admins.roleFilter",
  ]) {
    assert.match(dashboardPage, new RegExp(`tables\\.${filter}`));
  }
});

test("filter tabel dapat dikombinasikan dan direset", () => {
  const script = dashboardPage.match(
    /<script>\s*(function dashboard\(\)[\s\S]*?)\s*<\/script>/
  );
  assert.ok(script, "fungsi dashboard ditemukan");
  const createDashboard = vm.runInNewContext(`${script[1]}; dashboard;`);
  const state = createDashboard();

  state.user = { nomor: "6281" };
  state.data.siswa = [
    { nama: "Ani", nomor: "1", kelas: "7A", orangTua: "11", punyaFoto: true },
    { nama: "Budi", nomor: "2", kelas: "7A", orangTua: "22", punyaFoto: false },
  ];
  state.tables.students.classFilter = "7A";
  state.tables.students.photoFilter = "missing";
  assert.deepEqual(Array.from(state.filteredStudents, (row) => row.nama), ["Budi"]);

  state.report.rows = [
    { nama: "Ani", nomor: "1", kelas: "7A", masuk: "07:00", statusMasuk: "Tepat Waktu", statusPulang: "-", izin: "", buktiIzin: false },
    { nama: "Budi", nomor: "2", kelas: "7A", masuk: "-", statusMasuk: "-", statusPulang: "-", izin: "Sakit", buktiIzin: true },
  ];
  state.tables.report.statusFilter = "permission";
  assert.deepEqual(Array.from(state.filteredReport, (row) => row.nama), ["Budi"]);
  state.tables.permissions.evidenceFilter = "available";
  assert.deepEqual(Array.from(state.filteredPermissions, (row) => row.nama), ["Budi"]);

  state.data.kelas = [
    { nama: "7A", namaWali: "Wati", waliKelas: "6283", username: "wali.7a", jumlahSiswa: 2 },
    { nama: "7B", namaWali: "Dodi", waliKelas: "6284", username: "", jumlahSiswa: 0 },
  ];
  state.tables.classes.studentFilter = "empty";
  assert.deepEqual(Array.from(state.filteredClasses, (row) => row.nama), ["7B"]);

  state.data.admins = [
    { nama: "Admin Utama", nomor: "6281", username: "admin", role: "admin" },
    { nama: "Wali 7B", nomor: "6282", username: "", role: "wali_kelas", className: "7B" },
  ];
  state.tables.admins.accountFilter = "available";
  state.tables.admins.roleFilter = "admin";
  assert.deepEqual(Array.from(state.filteredAdmins, (row) => row.nama), ["Admin Utama"]);

  state.resetTableFilters("students");
  assert.equal(state.tables.students.classFilter, "");
  assert.equal(state.tables.students.photoFilter, "");
  assert.equal(state.tables.students.page, 1);
});

test("header ringkasan membedakan status masuk dan status pulang", () => {
  assert.match(dashboardPage, />Status Masuk<i/);
  assert.match(dashboardPage, />Status Pulang<i/);
});

test("header tabel mengurutkan data naik dan turun sebelum pagination", () => {
  const script = dashboardPage.match(
    /<script>\s*(function dashboard\(\)[\s\S]*?)\s*<\/script>/
  );
  assert.ok(script, "fungsi dashboard ditemukan");
  const createDashboard = vm.runInNewContext(`${script[1]}; dashboard;`);
  const state = createDashboard();

  for (const table of ["report", "students", "classes", "permissions", "admins"]) {
    assert.match(dashboardPage, new RegExp(`toggleSort\\('${table}'`));
  }

  state.data.siswa = [
    { nama: "Zaki", nomor: "10", kelas: "7B", orangTua: "20", punyaFoto: true },
    { nama: "Andi", nomor: "2", kelas: "7A", orangTua: "10", punyaFoto: false },
  ];
  state.tables.students.page = 3;
  state.toggleSort("students", "name");
  assert.equal(state.tables.students.page, 1);
  assert.equal(state.sortAria("students", "name"), "ascending");
  assert.equal(state.sortIcon("students", "name"), "fa-sort-up");
  assert.deepEqual(Array.from(state.pagedStudents, (row) => row.nama), ["Andi", "Zaki"]);

  state.toggleSort("students", "name");
  assert.equal(state.sortAria("students", "name"), "descending");
  assert.deepEqual(Array.from(state.pagedStudents, (row) => row.nama), ["Zaki", "Andi"]);

  state.data.kelas = [
    { nama: "7A", namaWali: "Wati", waliKelas: "1", username: "a", jumlahSiswa: 10 },
    { nama: "7B", namaWali: "Dodi", waliKelas: "2", username: "b", jumlahSiswa: 2 },
  ];
  state.toggleSort("classes", "studentCount");
  assert.deepEqual(Array.from(state.pagedClasses, (row) => row.jumlahSiswa), [2, 10]);
});

test("header aksi tidak menampilkan ikon dan tidak dapat diurutkan", () => {
  const actionHeaders = dashboardPage.match(
    /<th class="text-center">Aksi<\/th>/g
  ) || [];

  assert.equal(actionHeaders.length, 8);
  assert.doesNotMatch(dashboardPage, /toggleSort\([^)]*['"]action['"]/);
  assert.match(
    dashboardPage,
    /th\.text-center::before, \.data-table thead th\.text-center::after \{ display: none !important; content: none !important; \}/
  );
});

test("data guru mengikuti pola tabel siswa dan memakai modal", () => {
  assert.match(dashboardPage, /id="addTeacher"[^>]*>[^<]*<i[^>]*><\/i>Tambah Guru<\/button>/);
  assert.match(dashboardPage, /id="teacherModal"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(dashboardPage, /id="teacherPageSize"/);
  assert.match(dashboardPage, /id="teacherSearch"/);
  assert.match(dashboardPage, /id="teacherStatusFilter"/);
  assert.match(dashboardPage, /id="teacherPhotoFilter"/);
  for (const key of ["name", "number", "status", "photo"]) assert.match(dashboardPage, new RegExp(`data-teacher-sort="${key}"`));
  assert.match(teacherScript, /function renderTeachers\(\)/);
  assert.match(teacherScript, /teacherTable\.page/);
  assert.doesNotMatch(dashboardPage, /id="teacherNumber"[^>]*\sdisabled(?:\s|=|>)/);
  assert.match(teacherScript, /originalNumber: \$\("teacherNumber"\)\.dataset\.original/);
  assert.match(teacherScript, /api\(`\/person\/\$\{encodeURIComponent\(teacher\.number\)\}`, undefined, "DELETE"\)/);
  assert.match(teacherScript, /fa-trash/);
  assert.doesNotMatch(dashboardPage, /<th>Tindakan<\/th>/);
});

test("kontrol tabel guru memakai ID elemen yang tersedia", () => {
  for (const prefix of ["summary", "report", "schedule", "permission"]) {
    const title = prefix[0].toUpperCase() + prefix.slice(1);
    assert.match(dashboardPage, new RegExp(`id="reset${title}Filters"`));
    assert.match(teacherScript, /reset\$\{prefix\[0\]\.toUpperCase\(\)\}\$\{prefix\.slice\(1\)\}Filters/);
  }
  assert.doesNotMatch(teacherScript, /\$\{prefix\}ResetFilters/);
});

test("jadwal guru memakai dropdown data master mata pelajaran dan kelas", () => {
  assert.match(dashboardPage, /id:"mapel-guru",label:"Mata Pelajaran"/);
  assert.match(dashboardPage, /id:"kelas-guru",label:"Kelas"/);
  assert.match(dashboardPage, /id="subjectsPanel"/);
  assert.match(dashboardPage, /id="classesPanel"/);
  assert.match(dashboardPage, /data-add-catalog="subjects"[^>]*>[^<]*<i[^>]*><\/i>Tambah Mata Pelajaran<\/button>/);
  assert.match(dashboardPage, /data-add-catalog="classes"[^>]*>[^<]*<i[^>]*><\/i>Tambah Kelas<\/button>/);
  assert.match(teacherScript, /openCatalogModal\(kind, name\)/);
  assert.match(teacherScript, /original \? `\/catalog\/\$\{kind\}\/\$\{encodeURIComponent\(original\)\}`/);
  assert.match(dashboardPage, /id="catalogModal"[^>]+role="dialog"[^>]+aria-modal="true"/);
  for (const kind of ["subjects", "classes"]) {
    assert.match(dashboardPage, new RegExp(`id="${kind}CatalogPageSize"`));
    assert.match(dashboardPage, new RegExp(`id="${kind}CatalogSearch"`));
    assert.match(dashboardPage, new RegExp(`data-catalog-sort="${kind}"`));
  }
  assert.match(dashboardPage, /<select id="subject"[^>]*required>/);
  assert.match(dashboardPage, /<select id="className"[^>]*required>/);
  assert.doesNotMatch(dashboardPage, /<input id="subject"/);
  assert.doesNotMatch(dashboardPage, /<input id="className"/);
  assert.match(teacherScript, /\/catalog\/\$\{kind\}/);
  assert.match(teacherScript, /function renderCatalog\(kind\)/);
  assert.match(teacherScript, /catalogTables\[kind\]/);
  assert.match(teacherScript, /"mapel-guru": "subjectsPanel"/);
  assert.match(teacherScript, /"kelas-guru": "classesPanel"/);
  assert.match(dashboardPage, /id="scheduleModal"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(dashboardPage, /id="addSchedule"/);
  assert.match(dashboardPage, /id="scheduleTeacherFilter"/);
  assert.doesNotMatch(dashboardPage, /id="tolerance"/);
  assert.doesNotMatch(dashboardPage, /id="from"/);
  assert.doesNotMatch(dashboardPage, /id="until"/);
  assert.match(dashboardPage, /data-schedule-sort="day">Hari/);
  assert.match(dashboardPage, /data-schedule-sort="time">Jam/);
  assert.match(dashboardPage, /data-schedule-sort="class">Kelas/);
  assert.match(dashboardPage, /data-schedule-sort="subject">Pelajaran/);
  assert.match(teacherScript, /"Edit jadwal"/);
  assert.match(teacherScript, /"Hapus jadwal"/);
});

test("laporan kehadiran guru dapat diunduh sebagai Excel", () => {
  assert.match(dashboardPage, /id="exportReport"[^>]*>[^<]*<i[^>]*fa-file-excel[^>]*><\/i>Unduh Excel<\/button>/);
  assert.match(dashboardPage, /id="teacherExportStartDate"/);
  assert.match(dashboardPage, /id="teacherExportEndDate"/);
  assert.match(teacherScript, /\/report\/export\?startDate=/);
  assert.doesNotMatch(dashboardPage, /Unduh CSV/);
});

test("tombol muat ulang berada bersama tanggal laporan harian", () => {
  assert.match(dashboardPage, /id="studentDailyReportControls"[^>]*>.*Tanggal laporan harian siswa.*Muat ulang/);
  assert.match(dashboardPage, /id="teacherDailyReportControls"[^>]*>.*id="teacherReportDate".*id="refreshReport"[^>]*>[^<]*<i[^>]*fa-rotate[^>]*><\/i>Muat ulang/);
});

test("export absensi siswa menyediakan rentang tanggal", () => {
  assert.match(dashboardPage, /x-model="exportStartDate"/);
  assert.match(dashboardPage, /x-model="exportEndDate"/);
  assert.match(dashboardPage, /\/api\/export\?startDate=/);
});

test("export rentang tanggal mengikuti menu role wali kelas dan tata usaha", () => {
  assert.match(dashboardPage, /return this\.tabs\.filter\(item=>\["ringkasan","siswa","whatsapp"\]\.includes\(item\.id\)\)/);
  assert.match(dashboardPage, /"laporan-guru"/);
  assert.match(dashboardPage, /this\.user\?\.role==="tu"/);
});

test("izin guru memakai modal serta aksi edit dan hapus", () => {
  assert.match(dashboardPage, /id="addPermission"/);
  assert.match(dashboardPage, /id="permissionModal"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(teacherScript, /openPermissionModal\(item\)/);
  assert.match(teacherScript, /"Edit izin guru"/);
  assert.match(teacherScript, /"Hapus izin guru"/);
});
