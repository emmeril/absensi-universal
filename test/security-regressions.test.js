const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const express = require("express");
const ExcelJS = require("exceljs");
const { safeAsyncListener } = require("../lib/safe-async-listener");

const source = fs.readFileSync(require.resolve("../index.js"), "utf8");

test("login username/password membuat sesi sesuai role tanpa WhatsApp", async () => {
  const routes = {};
  const sessions = new Map();
  const context = {
    app: { post: (route, handler) => { routes[route] = handler; } },
    Date, crypto,
    normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
    loadDashboardAccounts: () => ({
      admin: { userId: "621234567890@c.us", passwordHash: "benar" },
      wali: { userId: "621111111111@c.us", passwordHash: "wali-benar" },
    }),
    loadRoles: () => ({
      "621234567890@c.us": "admin",
      "621111111111@c.us": "wali_kelas",
    }),
    verifyPassword: async (password, hash) => password === hash,
    DUMMY_PASSWORD_HASH: "dummy",
    webSessions: sessions,
    resolveDashboardUserName: async () => "Admin",
    serializeSessionCookie: (token) => `absensi_session=${token}`,
    sessionCookieIsSecure: () => true,
  };
  vm.runInNewContext(source.slice(source.indexOf('app.post("/api/auth/login"'), source.indexOf('app.get("/api/auth/me"')), context);
  function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader(name, value) { this[name] = value; } };
  }
  let res = response();
  await routes["/api/auth/login"]({ body: { username: " ADMIN ", password: "benar" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.role, "admin");
  assert.equal(res.body.user.username, "admin");
  assert.equal(sessions.size, 1);
  assert.match(res["Set-Cookie"], /^absensi_session=/);

  res = response();
  await routes["/api/auth/login"]({ body: { username: "wali", password: "wali-benar" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.role, "wali_kelas");
  assert.equal(sessions.size, 2);

  res = response();
  await routes["/api/auth/login"]({ body: { username: "admin", password: "salah" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Username atau password salah.");
  assert.equal(sessions.size, 2);
});

test("simultaneous exports retain each user's filtered report", async (t) => {
  const app = express();
  const ids = { a: "62111@c.us", b: "62222@c.us", deleted: "62333@c.us" };
  app.use((req, res, next) => {
    req.webUser = { id: req.query.user, role: req.query.user === "admin" ? "admin" : req.query.user === "tu" ? "tu" : "wali_kelas" };
    next();
  });
  const context = {
    app, ExcelJS, Buffer, KONTAK_PATH: "contacts", IZIN_PATH: "permissions",
    loadJSON: (key) => key === "contacts" ? { [ids.a]: "Student A", [ids.b]: "Student B" } : {},
    loadJSONSelected: (_key, select) => select({}),
    attendanceForDate: async () => ({
      [ids.deleted]: {
        masuk: { waktu: "07:01:00", status: "Tepat Waktu", nama: "Former Student", kelas: "A", waliKelas: "teacher" },
      },
    }),
    loadIzin: () => ({}), getWaktu: () => ({ tanggal: "2026-09-09" }),
    isValidDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || ""),
    loadKelas: () => ({ A: { waliKelas: "teacher", siswa: { [ids.a]: {} } }, B: { waliKelas: "other", siswa: { [ids.b]: {} } } }),
  };
  for (const [start, end] of [
    ["async function exportExcel(", "function ensureDir"],
    ["function findKelasSiswa(", "function textNotification"],
    ["function kelasUntukWali(", "function removeUnusedWaliRole"],
    ["async function buildReportRows(", 'app.get("/api/whatsapp'],
  ]) vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/export`;
  const results = await Promise.all(["teacher", "admin"].map(async (user) => {
    const response = await fetch(`${url}?user=${user}`);
    assert.equal(response.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const worksheet = workbook.getWorksheet("Rekap");
    const headers = worksheet.getRow(1).values.slice(1);
    return worksheet.getRows(2, worksheet.rowCount - 1).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).value]))
    );
  }));
  assert.deepEqual(results[0].map((row) => row.Nama), ["Student A", "Former Student"]);
  assert.deepEqual(results[1].map((row) => row.Nama), ["Student A", "Student B", "Former Student"]);

  const rangeResponse = await fetch(`${url}?user=admin&startDate=2026-09-08&endDate=2026-09-09`);
  assert.equal(rangeResponse.status, 200);
  assert.match(rangeResponse.headers.get("content-disposition"), /Rekap-2026-09-08-sampai-2026-09-09\.xlsx/);
  const rangeWorkbook = new ExcelJS.Workbook();
  await rangeWorkbook.xlsx.load(Buffer.from(await rangeResponse.arrayBuffer()));
  const rangeSheet = rangeWorkbook.getWorksheet("Rekap");
  assert.deepEqual(
    rangeSheet.getRows(2, rangeSheet.rowCount - 1).map((row) => row.getCell(1).value),
    ["2026-09-08", "2026-09-08", "2026-09-08", "2026-09-09", "2026-09-09", "2026-09-09"]
  );
  const waliRangeResponse = await fetch(`${url}?user=teacher&startDate=2026-09-08&endDate=2026-09-09`);
  assert.equal(waliRangeResponse.status, 200);
  const waliRangeWorkbook = new ExcelJS.Workbook();
  await waliRangeWorkbook.xlsx.load(Buffer.from(await waliRangeResponse.arrayBuffer()));
  const waliRangeSheet = waliRangeWorkbook.getWorksheet("Rekap");
  assert.deepEqual(
    waliRangeSheet.getRows(2, waliRangeSheet.rowCount - 1).map((row) => row.getCell(2).value),
    ["Student A", "Former Student", "Student A", "Former Student"]
  );
  assert.equal((await fetch(`${url}?user=admin&startDate=2026-09-10&endDate=2026-09-09`)).status, 400);
  assert.equal((await fetch(`${url}?user=admin&startDate=2025-01-01&endDate=2026-01-02`)).status, 400);
  assert.equal((await fetch(`${url}?user=tu&startDate=2026-09-08&endDate=2026-09-09`)).status, 403);
});

test("QR dan reset WhatsApp dibatasi sesuai kepemilikan bot wali", () => {
  const bots = [
    { key: "wali:62111", expectedNumber: "62111", qr: "own" },
    { key: "wali:62222", expectedNumber: "62222", qr: "other" },
    { key: "tu:62333", expectedNumber: "62333", role: "tu", qr: "teacher" },
  ];
  const context = { whatsapp: { statuses: () => bots } };
  vm.runInNewContext(
    source.slice(
      source.indexOf("function requireWebAdmin"),
      source.indexOf("function requireWebPhotoManager")
    ),
    context
  );
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  let nextCalls = 0;
  const ownRequest = {
    params: { key: "wali:62111" },
    webUser: { role: "wali_kelas", nomor: "62111" },
  };
  context.requireWhatsappBotAccess(ownRequest, response(), () => { nextCalls += 1; });
  assert.equal(ownRequest.whatsappBot.key, "wali:62111");

  let res = response();
  context.requireWhatsappBotAccess({
    params: { key: "wali:62222" },
    webUser: { role: "wali_kelas", nomor: "62111" },
  }, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 403);

  context.requireWhatsappBotAccess({
    params: { key: "wali:62222" },
    webUser: { role: "admin", nomor: "62999" },
  }, response(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);

  context.requireWhatsappBotAccess({
    params: { key: "tu:62333" },
    webUser: { role: "tu", nomor: "62444" },
  }, response(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 3);

  res = response();
  context.requireWhatsappBotAccess({
    params: { key: "wali:missing" },
    webUser: { role: "admin", nomor: "62999" },
  }, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 404);
  assert.match(
    source,
    /app\.get\("\/api\/whatsapp\/:key\/qr\.svg", requireWhatsappBotAccess/
  );
  assert.match(
    source,
    /app\.post\("\/api\/whatsapp\/:key\/reset", requireWhatsappBotAccess/
  );
  assert.match(source, /user\.role === "admin" \|\| \(user\.role === "tu" && bot\.role === "tu"\) \|\| bot\.expectedNumber === user\.nomor/);
  assert.match(source, /hasQr: Boolean\(qr\)/);
  assert.doesNotMatch(source, /QR_ACCESS_TOKEN|requireQrAccess|QR_RESET_TOKEN/);
});

test("message listener catches both synchronous and asynchronous failures and keeps running", async () => {
  const errors = [];
  const listener = safeAsyncListener((mode) => {
    if (mode === "sync") throw Error("sync");
    if (mode === "async") return Promise.reject(Error("async"));
    return "ok";
  }, (error) => errors.push(error.message));
  await listener("sync");
  await listener("async");
  assert.equal(await listener("success"), "ok");
  assert.deepEqual(errors, ["sync", "async"]);
});

function automaticFlowFixture() {
  const { JsonState } = require("../lib/json-state");
  const state = new JsonState({
    initial: { contacts: { student: "Siswa" }, storage: {}, permissions: {} },
    writeBatch: async () => {},
  });
  const routes = {}, files = new Map(), sessions = new Map();
  const attendanceRecords = new Map();
  const outbox = [];
  const attendanceKey = (record) => `${record.tanggal}:${record.siswaId}:${record.tipe}`;
  const context = {
    ...require("../lib/attendance-rules"), crypto, Buffer,
    STORAGE_PATH: "storage", IZIN_PATH: "permissions", KONTAK_PATH: "contacts",
    JAM_PATH: "time", LOKASI_PATH: "location", IZIN_BUKTI_DIR: "evidence",
    ATTENDANCE_PHOTO_DIR: "attendance",
    loadJSON: (key, fallback) => state.read(key, fallback),
    loadJSONSelected: (key, select, fallback) => state.readSelected(key, select, fallback),
    jsonState: state,
    updateJSON: (keys, mutate) => state.update(keys, mutate),
    updateJSONAtomic: (keys, mutate, databaseMutate) =>
      state.transact(keys, mutate, (_draft, result) =>
        databaseMutate({ result, transaction: {} })
      ),
    attendanceStatus: async (tanggal, siswaId) => ({
      masuk: attendanceRecords.has(`${tanggal}:${siswaId}:masuk`),
      pulang: attendanceRecords.has(`${tanggal}:${siswaId}:pulang`),
    }),
    createAttendance: async (record) => {
      const key = attendanceKey(record);
      if (attendanceRecords.has(key)) {
        const error = new Error("duplicate");
        error.name = "SequelizeUniqueConstraintError";
        throw error;
      }
      attendanceRecords.set(key, structuredClone(record));
    },
    withDatabaseTransaction: async (work) => work({}),
    enqueueNotifications: async (jobs) => outbox.push(...jobs),
    textNotification: (botKey, recipientId, text, options = {}) => ({ botKey, recipientId, kind: "text", text, ...options }),
    imageNotification: (botKey, recipientId, mediaPath, text, options = {}) => ({ botKey, recipientId, kind: "image", mediaPath, text, ...options }),
    notificationOutboxProcessor: { wake() {} },
    getWaktu: () => ({ tanggal: "2026-09-09", jam: "07:00:00" }),
    getAttendanceStatus: () => "Tepat Waktu",
    getAttendanceWindow: () => ({ mulai: "00:00", selesai: "23:59" }),
    haversine: () => 0, ATTENDANCE_RADIUS_METERS: 100,
    findKelasSiswa: () => null, loadKelas: () => ({}),
    getStudentNotificationRecipients: () => [],
    app: { post: (route, handler) => { routes[route] = handler; } },
    permissionSessions: sessions, getPermissionSession: (token) => sessions.get(token),
    parseImageDataUrl: (image) => image ? { mimetype: "image/jpeg", data: "dGVzdA==", buffer: Buffer.from("test") } : null,
    validateImagePayload: async (image) => image,
    imageExtension: () => "jpg",
    attendancePhotoPath: () => "attendance/photo.jpg",
    writePrivateFile: (name, data) => files.set(name, data),
    deleteManagedFile: (name) => files.delete(name),
    deletePrivateFileSafely: (name) => files.delete(name),
    ensureDir: () => {}, console: { error() {} },
    fs: { existsSync: (name) => files.has(name) },
  };
  vm.runInNewContext(source.slice(source.indexOf("async function catatAbsensiKamera"), source.indexOf("const whatsapp = new BaileysManager")), context);
  vm.runInNewContext(source.slice(source.indexOf('app.post("/api/permission-camera/:token/evidence"'), source.indexOf('app.get("/api/attendance-camera/:token"')), context);
  return { context, state, routes, files, sessions, attendanceRecords, outbox };
}

function fakeResponse() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
}

test("masuk and pulang record automatically; concurrent duplicates commit once", async () => {
  const { context, attendanceRecords } = automaticFlowFixture();
  const foto = { mimetype: "image/jpeg", data: "dGVzdA==", buffer: Buffer.from("test") };
  for (const tipe of ["masuk", "pulang"]) {
    const results = await Promise.allSettled([
      context.catatAbsensiKamera("student", tipe, {}, foto),
      context.catatAbsensiKamera("student", tipe, {}, foto),
    ]);
    assert.equal(
      results.filter((item) => item.status === "fulfilled").length,
      1,
      results.map((item) => item.reason?.stack || item.status).join("\n")
    );
    const result = results.find((item) => item.status === "fulfilled").value;
    assert.equal(result.status, "Tepat Waktu");
    assert.equal(result.pending, undefined);
    const record = attendanceRecords.get(`2026-09-09:student:${tipe}`);
    assert.equal(record.waktu, "07:00:00");
    assert.equal(record.foto, undefined);
    assert.equal(record.fotoPath, "attendance/photo.jpg");
  }
});

test("automatic attendance still rejects permission conflicts, outside location, and closed schedule", async () => {
  for (const mode of ["permission", "location", "schedule", "removed"]) {
    const { context, state, attendanceRecords } = automaticFlowFixture();
    if (mode === "permission") await state.update("permissions", (draft) => { draft.permissions["2026-09-09"] = { student: { alasan: "sakit" } }; });
    if (mode === "location") context.haversine = () => 101;
    if (mode === "schedule") context.getAttendanceWindow = () => ({ mulai: "08:00", selesai: "09:00" });
    if (mode === "removed") await state.update("contacts", (draft) => { delete draft.contacts.student; });
    await assert.rejects(context.catatAbsensiKamera("student", "masuk", {}, {}));
    assert.equal(attendanceRecords.size, 0);
  }
});

test("izin records automatically after verified selfie and evidence; duplicate and unverified submissions fail", async () => {
  const { routes, sessions, state, files } = automaticFlowFixture();
  const handler = routes["/api/permission-camera/:token/evidence"];
  const makeSession = (verified = true) => ({ userId: "student", tanggal: "2026-09-09", alasan: "sakit", verified, processing: false, selfie: { mimetype: "image/jpeg", data: "dGVzdA==", buffer: Buffer.from("test") }, lokasi: {} });
  sessions.set("unverified", makeSession(false));
  let res = fakeResponse();
  await handler({ params: { token: "unverified" }, body: { image: "proof" } }, res);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(state.read("permissions"), {});
  sessions.set("valid", makeSession());
  res = fakeResponse();
  await handler({ params: { token: "valid" }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(files.size, 0);
  res = fakeResponse();
  await handler({ params: { token: "valid" }, body: { image: "proof" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pending, undefined);
  const permission = state.read("permissions")["2026-09-09"].student;
  assert.equal(permission.alasan, "sakit");
  assert.equal(permission.terverifikasiWajah, true);
  assert.ok(files.has(permission.bukti));
  assert.equal(sessions.has("valid"), false);
  sessions.set("duplicate", makeSession());
  res = fakeResponse();
  await handler({ params: { token: "duplicate" }, body: { image: "proof" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(files.size, 2);
  assert.deepEqual(state.read("permissions")["2026-09-09"].student, permission);
});
