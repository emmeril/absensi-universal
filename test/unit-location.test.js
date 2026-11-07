const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JsonState } = require("../lib/json-state");
const { safeAsyncListener } = require("../lib/safe-async-listener");
const { resolveUnitLocation, resolveLocationUnit } = require("../lib/unit-location");
const { validateLocationMessage, locationRejectionMessage } = require("../lib/location-message");
const { adminUnitContext, assertAdminUnitScope } = require("../lib/admin-unit-scope");

const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const admin = "6289900000001@c.us";
const managerA = "6289900000002@c.us";
const managerB = "6289900000003@c.us";
const botA = "wali:6289900000002";
const botB = "wali:6289900000003";
const pointA = { latitude: -6.2, longitude: 106.8 };
const pointB = { latitude: -6.9, longitude: 107.6 };
const legacyPoint = { latitude: -6.7329, longitude: 108.5522 };

function fixture() {
  const writes = [];
  const persistence = { fail: false };
  const state = new JsonState({
    initial: {
      units: { A: { waliKelas: managerA, siswa: {} }, B: { waliKelas: managerB, siswa: {} } },
      roles: { [admin]: "admin", [managerA]: "wali_kelas", [managerB]: "wali_kelas" },
      location: legacyPoint,
      adminUnits: {},
    },
    writeBatch: async (draft) => {
      if (persistence.fail) throw new Error("storage unavailable");
      writes.push(structuredClone(draft));
    },
  });
  let listener;
  const pending = new Map();
  const context = {
    Date, safeAsyncListener, resolveLocationUnit, validateLocationMessage, locationRejectionMessage,
    adminUnitContext, assertAdminUnitScope,
    KONTAK_PATH: "contacts", ROLE_PATH: "roles", KELAS_PATH: "units", LOKASI_PATH: "location", JAM_PATH: "time", ADMIN_UNITS_PATH: "adminUnits",
    LOCATION_REQUEST_TTL_MS: 5 * 60 * 1000,
    loadJSON: (key) => state.read(key), loadKelas: () => state.read("units"),
    loadAdminUnitSettings: () => state.read("adminUnits"),
    scopeFor: (user) => adminUnitContext(user, state.read("units"), state.read("adminUnits")),
    updateJSON: (keys, mutate) => state.update(keys, mutate),
    getWaktu: () => ({ tanggal: "2026-11-07", jam: "07:00:00" }),
    sendWhatsappWithRetry: (send) => send(), toUniversalTerms: (text) => text,
    pendingLokasi: pending,
    whatsapp: { on: (_event, handler) => { listener = handler; } },
    console: { log() {}, error() {} },
    resolveUnitSchedule: () => ({}), findKelasSiswa: () => null,
    webSessions: new Map(), cameraSessions: new Map(), permissionSessions: new Map(),
  };
  vm.runInNewContext(source.slice(source.indexOf('whatsapp.on("message"'), source.indexOf("function parseCookies(")), context);
  vm.runInNewContext(source.slice(source.indexOf("function cleanupRuntimeState("), source.indexOf("const runtimeStateCleanup")), context);
  const send = async (body = "", { sender = admin, botKey = botA, ...message } = {}) => {
    const replies = [];
    await listener({ botKey, expectedNumber: botKey.split(":")[1], classNames: [], message: {
      from: sender, body, type: "chat", ...message, reply: async (text) => replies.push(text),
    } });
    return replies.join("\n");
  };
  const locate = (point, options = {}) => send("", { type: "location", location: point, ...options });
  return { state, pending, writes, send, locate, persistence, context };
}

test("titik unit berbeda dan unit tanpa konfigurasi tetap memakai titik lama", () => {
  const custom = resolveUnitLocation(legacyPoint, { lokasi: pointA });
  assert.deepEqual(custom, pointA);
  custom.latitude = 1;
  assert.equal(pointA.latitude, -6.2);
  assert.deepEqual(resolveUnitLocation(legacyPoint, {}), legacyPoint);
  assert.deepEqual(resolveUnitLocation(legacyPoint, { lokasi: null }), legacyPoint);
  assert.deepEqual(resolveUnitLocation(legacyPoint, { lokasi: { latitude: 0, longitude: 0 } }), { latitude: 0, longitude: 0 });
  for (const point of [{}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: "0", longitude: 0 }]) {
    assert.throws(() => resolveUnitLocation(legacyPoint, { lokasi: point }), /Titik lokasi unit belum valid/);
  }
});

test("!lokasi dua bot menyimpan titik masing-masing tanpa mengubah titik global", async () => {
  const { send, locate, state, pending } = fixture();
  assert.match(await send("!lokasi"), /untuk unit A/);
  assert.match(await send("!setlokasi", { botKey: botB }), /untuk unit B/);
  await Promise.all([locate(pointA), locate(pointB, { botKey: botB })]);
  assert.deepEqual(state.read("units").A.lokasi, pointA);
  assert.deepEqual(state.read("units").B.lokasi, pointB);
  assert.deepEqual(state.read("location"), legacyPoint);
  assert.equal(pending.size, 0);
});

test("anggota, pengelola, dan target pada bot lain tidak dapat mengatur lokasi", async () => {
  const { send, pending, writes } = fixture();
  for (const sender of ["member@c.us", managerA, managerB]) {
    assert.match(await send("!lokasi", { sender }), /Hanya administrator/);
  }
  assert.match(await send("!lokasi B"), /Unit tidak ditemukan pada bot ini/);
  assert.match(await send("!lokasi", { botKey: "wali:unknown" }), /belum melayani unit/);
  assert.equal(pending.size, 0);
  assert.equal(writes.length, 0);
});

test("bot bersama meminta nama unit dan hanya menyimpan unit yang dipilih", async () => {
  const { send, locate, state, pending } = fixture();
  await state.update("units", (draft) => { draft.units.B.waliKelas = managerA; });
  assert.match(await send("!lokasi"), /!lokasi NAMA UNIT/);
  assert.equal(pending.size, 0);
  assert.match(await send("!LoKaSi b"), /untuk unit B/);
  await locate(pointB);
  assert.equal(state.read("units").A.lokasi, undefined);
  assert.deepEqual(state.read("units").B.lokasi, pointB);
});

test("lokasi diteruskan, pin, dan koordinat tidak valid ditolak lalu dapat dicoba ulang", async () => {
  const { send, locate, state, writes, pending } = fixture();
  await send("!lokasi");
  assert.match(await locate(pointA, { isForwarded: true }), /diteruskan/);
  assert.match(await locate({ ...pointA, name: "Pin uji" }), /Pin atau lokasi tempat/);
  assert.match(await locate({ latitude: 91, longitude: 0 }), /Data lokasi tidak valid/);
  assert.equal(writes.length, 0);
  assert.equal(pending.size, 1);
  assert.match(await locate(pointA), /unit A disimpan/);
  assert.deepEqual(state.read("units").A.lokasi, pointA);
});

test("permintaan lokasi terikat pada pengirim, bot, dan batas waktu", async () => {
  const { send, locate, pending, writes, context } = fixture();
  await send("!lokasi");
  await locate(pointA, { botKey: botB });
  await locate(pointA, { sender: managerA });
  assert.equal(writes.length, 0);
  pending.get(`${botA}:${admin}`).expiresAt = Date.now() - 1;
  assert.match(await locate(pointA), /kedaluwarsa/);
  assert.equal(pending.size, 0);
  await send("!lokasi");
  pending.get(`${botA}:${admin}`).expiresAt = Date.now() - 1;
  context.cleanupRuntimeState();
  assert.equal(pending.size, 0);
  assert.equal(writes.length, 0);
});

test("hak admin dan unit diperiksa ulang saat koordinat diterima", async () => {
  for (const change of [
    (draft) => { draft.roles[admin] = "wali_kelas"; },
    (draft) => { delete draft.units.A; },
    (draft) => { draft.units.A.waliKelas = managerB; },
    (draft) => { draft.units.C = draft.units.A; delete draft.units.A; },
  ]) {
    const { send, locate, state, pending } = fixture();
    await send("!lokasi");
    await state.update(["roles", "units"], change);
    assert.doesNotMatch(await locate(pointA), /disimpan\.$/);
    assert.ok(Object.values(state.read("units")).every((unit) => !unit.lokasi));
    assert.equal(pending.size, 0);
  }
});

test("lokasi ganda tidak menimpa hasil simpan yang sedang diproses", async () => {
  const { send, locate, state, writes } = fixture();
  await send("!lokasi");
  const replies = await Promise.all([locate(pointA), locate(pointB)]);
  assert.equal(writes.length, 1);
  assert.deepEqual(state.read("units").A.lokasi, pointA);
  assert.match(replies[1], /sedang disimpan/);
});

test("gagal menulis tidak mengubah titik tersimpan dan dapat dicoba ulang", async () => {
  const { send, locate, state, persistence, pending } = fixture();
  await send("!lokasi");
  persistence.fail = true;
  assert.match(await locate(pointA), /gagal disimpan/);
  assert.equal(state.read("units").A.lokasi, undefined);
  assert.equal(pending.get(`${botA}:${admin}`).processing, false);
  persistence.fail = false;
  assert.match(await locate(pointA), /unit A disimpan/);
  assert.deepEqual(state.read("units").A.lokasi, pointA);
});
