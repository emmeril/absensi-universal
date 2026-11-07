const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  adminUnitContext,
  scopeError,
} = require("../lib/admin-unit-scope");

const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const id = "6289000000001@c.us";
const otherId = "6289000000002@c.us";
const actor = { id, nomor: "6289000000001", username: "admin.unit", role: "admin" };

function fixture({ restricted = true } = {}) {
  let state = {
    roles: { [id]: "admin", [otherId]: "admin" },
    names: { [id]: "Admin Unit" },
    accounts: {
      "admin.unit": { userId: id, passwordHash: "hash:password-lama" },
      "admin.pusat": { userId: otherId, passwordHash: "hash:password-pusat" },
    },
    notifications: {
      [id]: { mode: "selected", units: ["GUDANG"] },
      [otherId]: { mode: "all", units: [] },
    },
    settings: restricted
      ? { [id]: { mode: "selected", units: ["GUDANG"], activeUnit: "GUDANG" } } : {},
    units: { GUDANG: { siswa: {} }, KANTOR: { siswa: {} } },
    sessions: {
      current: { id, username: "admin.unit" },
      another: { id, username: "admin.unit" },
      unrelated: { id: otherId, username: "admin.pusat" },
    },
  };
  const webSessions = new Map(Object.entries(state.sessions));
  let handler;
  const context = {
    app: { post(path, ...callbacks) { assert.equal(path, "/api/admin/me"); handler = callbacks.at(-1); } },
    requireWebAdmin() {}, selfAccountLimiter() {},
    ROLE_PATH: "roles",
    USER_NAMES_PATH: "names",
    DASHBOARD_ACCOUNTS_PATH: "accounts",
    ADMIN_NOTIFICATIONS_PATH: "notifications",
    ADMIN_UNITS_PATH: "settings",
    KELAS_PATH: "units",
    WEB_SESSIONS_PATH: "sessions",
    adminUnitContext, scopeError, webSessions,
    loadDashboardAccounts: () => state.accounts,
    normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
    toTitleCase: (value) => String(value || "").trim(),
    isValidUsername: (value) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value),
    isValidPassword: (value) => value.length >= 10 && value.length <= 128,
    hashPassword: async (value) => "hash:" + value,
    verifyPassword: async (value, hash) => hash === "hash:" + value,
    dashboardAccountForUser(accounts, userId) {
      for (const [name, a] of Object.entries(accounts)) {
        if (a.userId === userId) return { username: name, ...a };
      }
      return null;
    },
    setDashboardAccount(accounts, { username, userId, passwordHash }) {
      if (accounts[username] && accounts[username].userId !== userId) {
        const error = Error("Username sudah digunakan akun lain.");
        error.code = "USERNAME_EXISTS";
        throw error;
      }
      for (const [savedName, a] of Object.entries(accounts)) {
        if (a.userId === userId && savedName !== username) delete accounts[savedName];
      }
      accounts[username] = { userId, passwordHash };
    },
    requestedAdminNotificationPreference(body, units) {
      if (!["all", "selected", "none"].includes(body.notificationMode)) {
        const error = Error("Pilihan notifikasi tidak valid.");
        error.code = "NOTIFICATION_PREFERENCE";
        throw error;
      }
      const allowed = Array.isArray(body.notificationUnits) ? body.notificationUnits : [];
      if (body.notificationMode === "selected" &&
          (allowed.length !== 1 || !Object.hasOwn(units, allowed[0]))) {
        const error = Error("Pilih tepat satu unit notifikasi.");
        error.code = "NOTIFICATION_PREFERENCE";
        throw error;
      }
      return { mode: body.notificationMode, units: body.notificationMode === "selected" ? allowed : [] };
    },
    assertAdminNotificationPolicy(_roles, preferences, units) {
      const { receivesUnit, normalizeNotificationPreference } = require("../lib/admin-notifications");
      const uncovered = Object.keys(units).filter((unit) =>
        !Object.keys(_roles).some((adminId) => _roles[adminId] === "admin" &&
          receivesUnit(normalizeNotificationPreference(preferences[adminId], Object.keys(units)), unit)));
      if (uncovered.length) {
        const error = Error("Unit tanpa penerima notifikasi");
        error.code = "NOTIFICATION_POLICY";
        throw error;
      }
    },
    adminIds: (roles) => Object.keys(roles).filter((userId) => roles[userId] === "admin"),
    notificationPolicyError: ({ adminIds, preferences, unitNames }) => {
      return adminIds.length === 1 && preferences[adminIds[0]]?.mode === "none"
        ? "No recipient" : "";
    },
    webSessionKey: () => "current",
    parseCookies: () => ({ absensi_session: "current" }),
    updateJSON: async (_paths, fn) => {
      const draft = structuredClone(state);
      await fn(draft);
      state = draft;
    },
  };
  vm.runInNewContext(source.slice(
    source.indexOf('app.post("/api/admin/me"'),
    source.indexOf("async function dashboardData")
  ), context);

  async function post(body, user = { ...actor }) {
    let status = 200;
    let payload;
    await handler({ webUser: user, body }, {
      status(code) { status = code; return this; },
      json(data) { payload = data; return this; },
    });
    return { status, body: payload };
  }
  return { post, get state() { return state; }, webSessions };
}

const baseForm = () => ({
  nama: "Admin Unit",
  username: "admin.unit",
  currentPassword: "",
  newPassword: "",
  notificationMode: "selected",
  notificationUnits: ["GUDANG"],
});

test("administrator unit tertentu dapat mengatur notifikasi untuk unitnya", async () => {
  const f = fixture();
  const result = await f.post({ ...baseForm(), notificationMode: "none" });
  assert.equal(result.status, 200);
  assert.equal(f.state.notifications[id].mode, "none");
  assert.equal(f.state.settings[id].mode, "selected");
});

test("admin terbatas tidak dapat mengambil notifikasi unit lain", async () => {
  const f = fixture();
  const result = await f.post({ ...baseForm(), notificationUnits: ["KANTOR"] });
  assert.equal(result.status, 403);
  assert.deepEqual(f.state.notifications[id], { mode: "selected", units: ["GUDANG"] });
});

test("mode semua unit tidak menambah akses notifikasi admin terbatas", async () => {
  const f = fixture();
  const result = await f.post({ ...baseForm(), notificationMode: "all" });
  assert.equal(result.status, 200);
  assert.equal(f.state.notifications[id].mode, "selected");
  assert.deepEqual(f.state.notifications[id].units, ["GUDANG"]);
});

test("username baru memerlukan password saat ini dan tidak boleh bentrok", async () => {
  const f = fixture();
  assert.equal((await f.post({ ...baseForm(), username: "baru.admin" })).status, 403);
  assert.equal((await f.post({ ...baseForm(), username: "admin.pusat", currentPassword: "password-lama" })).status, 409);
  const updated = await f.post({ ...baseForm(), username: "baru.admin", currentPassword: "password-lama" });
  assert.equal(updated.status, 200);
  assert.equal(f.state.accounts["admin.unit"], undefined);
  assert.equal(f.state.accounts["baru.admin"].userId, id);
  assert.equal(f.state.sessions.current.username, "baru.admin");
  assert.equal(f.state.sessions.another.username, "baru.admin");
});

test("ganti password mencabut sesi lain tanpa mengubah role dan unit", async () => {
  const f = fixture();
  const result = await f.post({
    ...baseForm(), currentPassword: "password-lama", newPassword: "password-baru123",
  });
  assert.equal(result.status, 200);
  assert.equal(f.state.accounts["admin.unit"].passwordHash, "hash:password-baru123");
  assert.equal(f.state.sessions.another, undefined);
  assert.equal(f.webSessions.has("another"), false);
  assert.ok(f.state.sessions.current);
  assert.equal(f.state.roles[id], "admin");
  assert.deepEqual(f.state.settings[id].units, ["GUDANG"]);
});

test("tidak boleh mengubah role, scope, nomor, atau akun orang lain melalui profil", async () => {
  const f = fixture();
  for (const field of ["role", "accessMode", "accessUnits", "nomor", "originalNomor"]) {
    const result = await f.post({ ...baseForm(), [field]: "admin" });
    assert.equal(result.status, 400);
  }
  assert.equal(f.state.roles[id], "admin");
  assert.equal(f.state.accounts["admin.pusat"].userId, otherId);
});

test("pengaturan notifikasi harus menyisakan penerima setiap unit", async () => {
  const f = fixture({ restricted: false });
  f.state.notifications[otherId] = { mode: "none", units: [] };
  const disabled = await f.post({ ...baseForm(), notificationMode: "none" });
  assert.equal(disabled.status, 400);
  assert.equal(f.state.notifications[id].mode, "selected");
});

test("akun sendiri menolak dua atau lebih unit notifikasi", async () => {
  const f = fixture({ restricted: false });
  const result = await f.post({
    ...baseForm(), notificationUnits: ["GUDANG", "KANTOR"],
  });
  assert.equal(result.status, 400);
  assert.deepEqual(f.state.notifications[id], { mode: "selected", units: ["GUDANG"] });
});
