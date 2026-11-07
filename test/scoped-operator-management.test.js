const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  adminUnitContext, adminUnitPolicyInput, assertOperatorManagementAccess,
  operatorUnitsForUser,
} = require("../lib/admin-unit-scope");

const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const actor = { id: "6289000000001@c.us", role: "admin", nomor: "6289000000001" };
const owner = { id: "6289000000002@c.us", role: "admin", nomor: "6289000000002" };
const unitA = "ALFA";
const unitB = "BETA";
const otherOperator = "6289000000003@c.us";
const sharedOperator = "6289000000004@c.us";

function makeFixture() {
  let state = {
    roles: { [actor.id]: "admin", [owner.id]: "admin", [otherOperator]: "wali_kelas", [sharedOperator]: "wali_kelas" },
    names: { [otherOperator]: "Operator Beta", [sharedOperator]: "Operator Bersama" },
    accounts: {
      owner: { userId: owner.id, passwordHash: "hash" },
      actor: { userId: actor.id, passwordHash: "hash" },
      beta: { userId: otherOperator, passwordHash: "hash" },
      shared: { userId: sharedOperator, passwordHash: "hash" },
    },
    units: {
      [unitA]: { waliKelas: "", siswa: {} },
      [unitB]: { waliKelas: otherOperator, siswa: {} },
    },
    contacts: {},
    notifications: {},
    adminUnits: { [actor.id]: { mode: "selected", units: [unitA], activeUnit: unitA } },
  };
  const routes = {};
  const paths = {
    ROLE_PATH: "roles",
    USER_NAMES_PATH: "names",
    DASHBOARD_ACCOUNTS_PATH: "accounts",
    KELAS_PATH: "units",
    KONTAK_PATH: "contacts",
    ADMIN_NOTIFICATIONS_PATH: "notifications",
    ADMIN_UNITS_PATH: "adminUnits",
  };
  const context = {
    ...paths,
    app: {
      post(path, ...handlers) { routes["POST " + path] = handlers.at(-1); },
      delete(path, ...handlers) { routes["DELETE " + path] = handlers.at(-1); },
    },
    requireWebAdmin() {},
    adminUnitContext, adminUnitPolicyInput, assertOperatorManagementAccess, operatorUnitsForUser,
    normalizeNomor: (v) => String(v || "").replace(/\D/g, ""),
    normalizeUsername: (v) => String(v || "").trim().toLowerCase(),
    toTitleCase: (v) => v,
    isValidUsername: (v) => /^[a-z0-9._-]{3,32}$/.test(v),
    isValidPassword: (v) => v.length >= 10 && v.length <= 128,
    hashPassword: async (v) => "hash:" + v,
    loadDashboardAccounts: () => state.accounts,
    loadRoles: () => state.roles,
    dashboardAccountForUser: (accounts, id) => {
      const match = Object.entries(accounts).find(([, a]) => a.userId === id);
      return match ? { ...match[1], username: match[0] } : null;
    },
    setDashboardAccount(accounts, account) {
      for (const [username, value] of Object.entries(accounts)) {
        if (value.userId === account.userId) delete accounts[username];
      }
      accounts[account.username] = { userId: account.userId, passwordHash: account.passwordHash };
    },
    removeDashboardAccount(accounts, id) {
      for (const [username, value] of Object.entries(accounts)) {
        if (value.userId === id) delete accounts[username];
      }
    },
    updateJSON: async (_paths, mutate) => {
      const draft = structuredClone(state);
      const result = await mutate(draft);
      state = draft;
      return result;
    },
    requestedAdminNotificationPreference: () => ({ mode: "all", units: [] }),
    assertAdminNotificationPolicy() {},
    assertGlobalAdminExists() {},
    whatsapp: { sync: async () => {} },
    loadKelas: () => state.units,
    console: { error() {} },
  };
  vm.runInNewContext(source.slice(
    source.indexOf('app.post("/api/admins"'),
    source.indexOf('app.post("/api/classes"')
  ), context);

  async function call(user, method, endpoint, body = {}) {
    let status = 200, output;
    const res = {
      status(value) { status = value; return this; },
      json(value) { output = value; return this; },
    };
    const handler = routes[method + " " + endpoint];
    assert.ok(handler, endpoint + " route missing");
    await handler({
      webUser: user, body,
      params: { number: body.paramsNumber },
    }, res);
    return { status, body: output };
  }

  return { call, get state() { return state; } };
}
const operatorForm = (nomor, unit) => ({
  originalNomor: "", nomor, nama: "Operator Unit", username: "operator." + nomor.slice(-6),
  password: "password-12345", role: "wali_kelas", className: unit,
});

test("unit admin can create bot operator for active unit only", async () => {
  const f = makeFixture();
  const number = "6289000000051";
  const result = await f.call(actor, "POST", "/api/admins", operatorForm(number, unitA));
  assert.equal(result.status, 201);
  assert.equal(f.state.units[unitA].waliKelas, number + "@c.us");
  assert.equal(f.state.roles[number + "@c.us"], "wali_kelas");
  assert.equal(f.state.units[unitB].waliKelas, otherOperator);
});

test("unit admin cannot create operator for another unit", async () => {
  const f = makeFixture();
  const number = "6289000000052";
  const result = await f.call(actor, "POST", "/api/admins", operatorForm(number, unitB));
  assert.equal(result.status, 403);
  assert.equal(f.state.roles[number + "@c.us"], undefined);
  assert.equal(f.state.units[unitB].waliKelas, otherOperator);
});

test("unit admin cannot create an administrator account", async () => {
  const f = makeFixture();
  const number = "6289000000053";
  const result = await f.call(actor, "POST", "/api/admins", {
    ...operatorForm(number, unitA), role: "admin",
  });
  assert.equal(result.status, 403);
  assert.equal(f.state.roles[number + "@c.us"], undefined);
});

test("unit admin cannot edit or delete operator of another unit", async () => {
  const f = makeFixture();
  const edit = await f.call(actor, "POST", "/api/admins", {
    ...operatorForm(otherOperator.replace("@c.us", ""), unitA),
    originalNomor: otherOperator.replace("@c.us", ""), username: "beta",
    password: "", nama: "Tidak Boleh Diganti",
  });
  assert.equal(edit.status, 403);
  assert.equal(f.state.names[otherOperator], "Operator Beta");

  const remove = await f.call(actor, "DELETE", "/api/admins/:number", {
    paramsNumber: otherOperator.replace("@c.us", ""),
  });
  assert.equal(remove.status, 403);
  assert.equal(f.state.roles[otherOperator], "wali_kelas");
});

test("unit admin can delete operator assigned solely to its active unit", async () => {
  const f = makeFixture();
  const number = "6289000000054";
  assert.equal((await f.call(actor, "POST", "/api/admins", operatorForm(number, unitA))).status, 201);
  const removed = await f.call(actor, "DELETE", "/api/admins/:number", { paramsNumber: number });
  assert.equal(removed.status, 200);
  assert.equal(f.state.units[unitA].waliKelas, "");
  assert.equal(f.state.roles[number + "@c.us"], undefined);
});

test("operator account shared by multiple units cannot be modified by local admin", async () => {
  const f = makeFixture();
  f.state.units[unitA].waliKelas = sharedOperator;
  f.state.units[unitB].waliKelas = sharedOperator;
  const remove = await f.call(actor, "DELETE", "/api/admins/:number", {
    paramsNumber: sharedOperator.replace("@c.us", ""),
  });
  assert.equal(remove.status, 403);
  assert.equal(f.state.roles[sharedOperator], "wali_kelas");
});

test("unit admin can edit existing bot operator account within active unit", async () => {
  const f = makeFixture();
  const number = "6289000000055";
  assert.equal((await f.call(actor, "POST", "/api/admins", operatorForm(number, unitA))).status, 201);
  const edited = await f.call(actor, "POST", "/api/admins", {
    ...operatorForm(number, unitA),
    originalNomor: number,
    username: "operator.alfa",
    nama: "Operator Alfa Baru",
    password: "",
  });
  assert.equal(edited.status, 200);
  assert.equal(f.state.names[number + "@c.us"], "Operator Alfa Baru");
  assert.equal(f.state.accounts["operator.alfa"].userId, number + "@c.us");
  assert.equal(f.state.units[unitA].waliKelas, number + "@c.us");
});

test("global administrator retains control over administrator accounts", async () => {
  const f = makeFixture();
  const number = "6289000000056";
  const added = await f.call(owner, "POST", "/api/admins", {
    ...operatorForm(number, unitA),
    role: "admin",
    accessMode: "all",
    notificationMode: "all",
  });
  assert.equal(added.status, 201);
  assert.equal(f.state.roles[number + "@c.us"], "admin");
  assert.equal(f.state.adminUnits[number + "@c.us"].mode, "all");
});
