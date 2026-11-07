const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const { VALID_NOTIFICATION_MODES, notificationPolicyError } = require("../lib/admin-notifications");
const { scopeError } = require("../lib/admin-unit-scope");

function requested(body, units = { GUDANG: {}, KANTOR: {} }, scope = null) {
  const context = { VALID_NOTIFICATION_MODES, scopeError };
  vm.runInNewContext(source.slice(
    source.indexOf("function requestedAdminNotificationPreference("),
    source.indexOf("function assertAdminNotificationPolicy(")
  ), context);
  return structuredClone(context.requestedAdminNotificationPreference(body, units, scope));
}

test("notifikasi unit tertentu wajib satu unit", () => {
  assert.deepEqual(requested({
    notificationMode: "selected", notificationUnits: ["GUDANG"],
  }), { mode: "selected", units: ["GUDANG"] });
  for (const value of [[], ["GUDANG", "KANTOR"], ["GUDANG", "GUDANG"]]) {
    assert.throws(() => requested({
      notificationMode: "selected", notificationUnits: value,
    }), { code: "NOTIFICATION_PREFERENCE" });
  }
  assert.throws(() => requested({
    notificationMode: "selected", notificationUnits: ["LAIN"],
  }), { code: "NOTIFICATION_PREFERENCE" });
});

test("mode Semua Unit dan Tidak Menerima tidak memerlukan daftar unit", () => {
  assert.deepEqual(requested({ notificationMode: "all" }), { mode: "all", units: [] });
  assert.deepEqual(requested({ notificationMode: "none" }), { mode: "none", units: [] });
});

test("perubahan tidak boleh membuat unit tanpa penerima notifikasi", () => {
  assert.match(notificationPolicyError({
    adminIds: ["pusat", "gudang"],
    preferences: {
      pusat: { mode: "selected", units: ["KANTOR"] },
      gudang: { mode: "none", units: [] },
    },
    unitNames: ["GUDANG", "KANTOR"],
  }), /GUDANG/);
  assert.equal(notificationPolicyError({
    adminIds: ["pusat", "gudang"],
    preferences: {
      pusat: { mode: "all", units: [] },
      gudang: { mode: "selected", units: ["GUDANG"] },
    },
    unitNames: ["GUDANG", "KANTOR"],
  }), "");
});

test("admin terbatas menerima notifikasi hanya dari unit yang ditetapkan", () => {
  const scope = { restricted: true, activeUnit: "GUDANG", allowedUnits: ["GUDANG"] };
  assert.deepEqual(requested({
    notificationMode: "selected",
  }, { GUDANG: {}, KANTOR: {} }, scope), { mode: "selected", units: ["GUDANG"] });
  assert.deepEqual(requested({
    notificationMode: "none",
  }, { GUDANG: {}, KANTOR: {} }, scope), { mode: "none", units: [] });
  assert.deepEqual(requested({
    notificationMode: "all",
  }, { GUDANG: {}, KANTOR: {} }, scope), { mode: "selected", units: ["GUDANG"] });
});

test("admin terbatas tidak dapat meminta notifikasi unit lain", () => {
  const scope = { restricted: true, activeUnit: "GUDANG", allowedUnits: ["GUDANG"] };
  assert.throws(() => requested({
    notificationMode: "selected", notificationUnits: ["KANTOR"],
  }, { GUDANG: {}, KANTOR: {} }, scope), { code: "ADMIN_UNIT_SCOPE" });
});

test("admin tanpa unit aktif tidak dapat mengaktifkan notifikasi", () => {
  assert.throws(() => requested({
    notificationMode: "selected",
  }, { GUDANG: {} }, { restricted: true, activeUnit: "", allowedUnits: [] }), {
    code: "NOTIFICATION_PREFERENCE",
  });
});
