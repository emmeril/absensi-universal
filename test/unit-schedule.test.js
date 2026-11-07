const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const express = require("express");
const { JsonState } = require("../lib/json-state");
const { DEFAULT_SCHEDULE, resolveUnitSchedule, assertScheduleAccess } = require("../lib/unit-schedule");

const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const page = fs.readFileSync(require.resolve("../public/index.html"), "utf8");
const users = {
  admin: { id: "admin", role: "admin" },
  manager: { id: "manager", role: "wali_kelas" },
  other: { id: "other", role: "wali_kelas" },
};
const input = {
  masuk: "08:00", pulang: "17:00", toleransi: 10,
  mulaiMasuk: "07:00", selesaiMasuk: "10:00",
  mulaiPulang: "16:00", selesaiPulang: "19:00",
};

test("jadwal lama tetap berlaku dan jadwal unit tidak mengubah acuan organisasi", () => {
  const legacy = { masuk: "07:00:00", pulang: "14:00:00" };
  const inherited = resolveUnitSchedule(legacy, { siswa: {} });
  assert.equal(inherited.masuk, legacy.masuk);
  assert.equal(inherited.mulaiMasuk, DEFAULT_SCHEDULE.mulaiMasuk);
  const custom = resolveUnitSchedule(legacy, { jadwal: { masuk: "08:00:00", toleransi: 15 } });
  assert.equal(custom.masuk, "08:00:00");
  assert.equal(custom.pulang, "14:00:00");
  assert.equal(custom.toleransi, 15);
  assert.equal(resolveUnitSchedule(legacy).masuk, "07:00:00");
  assert.deepEqual(legacy, { masuk: "07:00:00", pulang: "14:00:00" });
});

async function apiFixture(t) {
  const writes = [];
  const state = new JsonState({
    initial: {
      time: { ...DEFAULT_SCHEDULE, masuk: "06:00:00" },
      units: { A: { siswa: {}, waliKelas: "manager" }, B: { siswa: {}, waliKelas: "other" } },
      roles: { admin: "admin" }, preferences: {},
    },
    writeBatch: async (data) => writes.push(structuredClone(data)),
  });
  const app = express();
  app.use(express.json());
  const context = {
    app, assertScheduleAccess, resolveUnitSchedule,
    JAM_PATH: "time", KELAS_PATH: "units", ROLE_PATH: "roles", ADMIN_NOTIFICATIONS_PATH: "preferences",
    webUser: (req) => users[req.headers["x-test-user"]] || null,
    isValidTime: (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    updateJSON: (keys, mutate) => state.update(keys, mutate),
    loadKelas: () => state.read("units"),
    assertAdminNotificationPolicy() {},
    adminNotificationPreference: () => ({ mode: "all", units: [] }),
    receivesUnit: () => true,
    normalizeNotificationPreference: (value) => value,
    adminIds: () => ["admin"],
    whatsapp: { sync: async () => {} },
    console,
  };
  vm.runInNewContext(source.slice(source.indexOf("function requireWebAuth("), source.indexOf("function requireWhatsappBotAccess(")), context);
  app.use("/api", context.requireWebAuth);
  for (const [start, end] of [
    ['app.post("/api/settings/time"', 'app.post("/api/permissions"'],
    ['app.post("/api/classes"', 'app.post("/api/students"'],
  ]) vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.once("listening", resolve));
  const call = async (user, method, path = "/api/settings/time", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { state, call, writes };
}

test("API menyimpan jadwal per unit dan pembaruan bersamaan tidak saling menimpa", async (t) => {
  const { call, state, writes } = await apiFixture(t);
  const result = await Promise.all([
    call("manager", "POST", undefined, { ...input, unit: "a" }),
    call("other", "POST", undefined, { ...input, unit: "B", masuk: "09:00" }),
  ]);
  assert.deepEqual(result.map((item) => item.status), [200, 200]);
  assert.equal(state.read("units").A.jadwal.masuk, "08:00:00");
  assert.equal(state.read("units").B.jadwal.masuk, "09:00:00");
  assert.equal(state.read("time").masuk, "06:00:00");
  assert.equal(writes.length, 2);
  assert.equal((await call("admin", "POST", undefined, input)).status, 200);
  assert.equal(state.read("time").masuk, "08:00:00");
  assert.equal(state.read("units").B.jadwal.masuk, "09:00:00");
});

test("API menolak akses tanpa login, jadwal organisasi bagi pengelola, dan unit lain", async (t) => {
  const { call, state, writes } = await apiFixture(t);
  for (const [user, unit, expected] of [
    ["anonymous", "A", 401], ["manager", "", 403], ["manager", "B", 403],
    ["admin", "MISSING", 404], ["manager", "constructor", 404],
  ]) assert.equal((await call(user, "POST", undefined, { ...input, unit })).status, expected);
  assert.equal((await call("manager", "DELETE", "/api/settings/time?unit=B")).status, 403);
  assert.equal((await call("manager", "DELETE", "/api/settings/time")).status, 400);
  assert.equal((await call("manager", "DELETE", "/api/settings/time?unit=MISSING")).status, 404);
  assert.equal(state.read("units").A.jadwal, undefined);
  assert.equal(writes.length, 0);
});

test("validasi jam, rentang, toleransi, dan nama unit gagal tanpa menulis data", async (t) => {
  const { call, writes } = await apiFixture(t);
  assert.equal((await call("admin", "POST")).status, 400);
  assert.equal((await call("admin", "POST", undefined, [])).status, 400);
  for (const invalid of [
    { masuk: "25:00" }, { pulang: "8:00" }, { toleransi: 181 }, { toleransi: -1 },
    { toleransi: 1.5 }, { mulaiMasuk: "11:00" }, { selesaiPulang: "15:00" },
    { mulaiPulang: "16:00", selesaiPulang: "16:00" }, { unit: { name: "A" } },
  ]) {
    const response = await call("admin", "POST", undefined, { ...input, unit: "A", ...invalid });
    assert.equal(response.status, 400, JSON.stringify(invalid));
  }
  assert.equal(writes.length, 0);
});

test("reset memakai acuan terbaru dan jadwal khusus mengikuti ganti nama serta hapus unit", async (t) => {
  const { call, state } = await apiFixture(t);
  await call("manager", "POST", undefined, { ...input, unit: "A" });
  await call("admin", "POST", undefined, { ...input, masuk: "10:00" });
  assert.equal(resolveUnitSchedule(state.read("time"), state.read("units").A).masuk, "08:00:00");
  assert.equal((await call("manager", "DELETE", "/api/settings/time?unit=A")).status, 200);
  assert.equal(resolveUnitSchedule(state.read("time"), state.read("units").A).masuk, "10:00:00");
  await call("manager", "POST", undefined, { ...input, unit: "A" });
  assert.equal((await call("admin", "POST", "/api/classes", { originalNama: "A", nama: "C" })).status, 200);
  assert.equal(state.read("units").A, undefined);
  assert.equal(state.read("units").C.jadwal.masuk, "08:00:00");
  assert.equal((await call("admin", "DELETE", "/api/classes/C")).status, 200);
  assert.equal(state.read("units").C, undefined);
});

test("form jadwal terpisah dari ringkasan, batal tidak mengubah nilai, dan pengelola memilih unit sendiri", async () => {
  const context = {};
  const script = page.match(/<script>\s*(function dashboard\(\)[\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(`${script}\nstate = dashboard();`, context);
  const state = context.state;
  state.user = users.admin;
  state.data.jam = { ...DEFAULT_SCHEDULE };
  state.data.kelas = [{ nama: "A", jadwal: { ...DEFAULT_SCHEDULE, masuk: "08:00:00" } }, { nama: "B", jadwal: null }];
  state.timeUnit = "A";
  state.openModal("time");
  state.time.masuk = "11:00";
  assert.equal(state.timeSummary.masuk, "08:00");
  state.closeModal();
  state.openModal("time");
  assert.equal(state.time.masuk, "08:00");
  state.timeUnit = "B";
  assert.equal(state.timeSummary.masuk, "09:00");
  assert.equal(state.timeFormUnit, "A");
  state.user = users.manager;
  state.request = async () => ({ jam: DEFAULT_SCHEDULE, kelas: [{ nama: "OWN", jadwal: null }] });
  await state.refresh();
  assert.equal(state.timeUnit, "OWN");
  assert.equal(state.visibleTabs.some((tab) => tab.id === "pengaturan"), true);
  state.data.kelas = [];
  assert.equal(state.canEditTime, false);
});

test("simpan form memakai unit saat dibuka, mencegah klik ganda, dan mempertahankan form jika gagal", async () => {
  const context = {};
  const script = page.match(/<script>\s*(function dashboard\(\)[\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(`${script}\nstate = dashboard();`, context);
  const state = context.state;
  state.user = users.admin;
  state.data.kelas = [{ nama: "A", jadwal: null }, { nama: "B", jadwal: null }];
  state.timeUnit = "A";
  state.openModal("time");
  state.timeUnit = "B";
  const writes = [];
  let release;
  state.request = async (_url, options) => {
    writes.push(JSON.parse(options.body));
    await new Promise((resolve) => { release = resolve; });
  };
  state.refresh = async () => {};
  state.notify = () => {};
  const saving = state.saveTime();
  await state.saveTime();
  assert.equal(state.timeSaving, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].unit, "A");
  release();
  await saving;
  assert.equal(state.modal, "");
  assert.equal(state.timeSaving, false);
  state.openModal("time");
  state.request = async () => { throw new Error("Gagal menyimpan jadwal"); };
  await state.saveTime();
  assert.equal(state.modal, "time");
  assert.equal(state.timeError, "Gagal menyimpan jadwal");
  assert.equal(state.timeSaving, false);
});

test("perintah WhatsApp memakai rentang unit dan tetap memakai jadwal lama tanpa jadwal khusus", async () => {
  const { safeAsyncListener } = require("../lib/safe-async-listener");
  const { isWithinAttendanceWindow, validateAttendance } = require("../lib/attendance-rules");
  for (const command of ["!masuk", "!pulang"]) {
    for (const custom of [true, false]) {
      let listener;
      const replies = [];
      const context = {
        Date, safeAsyncListener, resolveUnitSchedule, isWithinAttendanceWindow, validateAttendance,
        console: { log() {}, error(...args) { throw new Error(args.join(" ")); } },
        KONTAK_PATH: "contacts", ROLE_PATH: "roles", JAM_PATH: "time", FACE_REC: "photos",
        whatsapp: { on: (_name, handler) => { listener = handler; } },
        pendingLokasi: new Map(),
        loadJSON: (key) => key === "contacts" ? { "member@c.us": "Anggota uji" } : key === "time" ? DEFAULT_SCHEDULE : {},
        loadKelas: () => ({}),
        findKelasSiswa: () => ({
          namaKelas: "A", waliKelas: "6289900000001@c.us",
          jadwal: custom ? { mulaiMasuk: "08:00:00", selesaiMasuk: "10:00:00", mulaiPulang: "16:00:00", selesaiPulang: "19:00:00" } : null,
        }),
        getWaktu: () => ({ tanggal: "2026-11-07", jam: "07:00:00" }),
        loadDailyStudentStatus: async () => ({ masuk: false, pulang: false, izin: false }),
        sendWhatsappWithRetry: (send) => send(),
        toUniversalTerms: (value) => value,
        fs: { existsSync: () => false },
      };
      vm.runInNewContext(source.slice(source.indexOf("function getAttendanceWindow("), source.indexOf("function getStudentNotificationRecipients(")), context);
      vm.runInNewContext(source.slice(source.indexOf('whatsapp.on("message"'), source.indexOf("function parseCookies(")), context);
      await listener({ botKey: "test", expectedNumber: "6289900000001", classNames: ["A"], message: { from: "member@c.us", body: command, reply: async (value) => replies.push(value) } });
      assert.equal(replies.length, 1);
      assert.match(replies[0], custom ? /hanya dapat dilakukan pukul/ : /Foto referensi wajah belum ada/);
    }
  }
});
