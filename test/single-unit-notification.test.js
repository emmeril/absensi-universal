const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const { VALID_NOTIFICATION_MODES, notificationPolicyError } = require("../lib/admin-notifications");

function requested(body, units = { GUDANG: {}, KANTOR: {} }) {
  const context = { VALID_NOTIFICATION_MODES };
  vm.runInNewContext(source.slice(
    source.indexOf("function requestedAdminNotificationPreference("),
    source.indexOf("function assertAdminNotificationPolicy(")
  ), context);
  return structuredClone(context.requestedAdminNotificationPreference(body, units));
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
