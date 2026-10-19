const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeNotificationPreference,
  notificationPolicyError,
  receivesUnit,
} = require("../lib/admin-notifications");

test("Administrator lama tetap menerima notifikasi semua Unit", () => {
  const preference = normalizeNotificationPreference(undefined, ["UNIT A", "UNIT B"]);
  assert.deepEqual(preference, { mode: "all", units: [] });
  assert.equal(receivesUnit(preference, "UNIT A"), true);
});

test("Administrator dapat memilih Unit tertentu", () => {
  const preference = normalizeNotificationPreference(
    { mode: "selected", units: ["UNIT A", "UNIT A", "UNIT LAMA"] },
    ["UNIT A", "UNIT B"]
  );
  assert.deepEqual(preference, { mode: "selected", units: ["UNIT A"] });
  assert.equal(receivesUnit(preference, "UNIT A"), true);
  assert.equal(receivesUnit(preference, "UNIT B"), false);
});

test("Administrator satu-satunya tidak dapat mematikan notifikasi", () => {
  assert.match(
    notificationPolicyError({
      adminIds: ["admin-1"],
      preferences: { "admin-1": { mode: "none", units: [] } },
      unitNames: ["UNIT A"],
    }),
    /satu-satunya/
  );
});

test("satu dari beberapa Administrator boleh tidak menerima notifikasi", () => {
  assert.equal(
    notificationPolicyError({
      adminIds: ["admin-1", "admin-2"],
      preferences: {
        "admin-1": { mode: "none", units: [] },
        "admin-2": { mode: "all", units: [] },
      },
      unitNames: ["UNIT A", "UNIT B"],
    }),
    ""
  );
});

test("setiap Unit wajib memiliki penerima notifikasi Administrator", () => {
  assert.match(
    notificationPolicyError({
      adminIds: ["admin-1", "admin-2"],
      preferences: {
        "admin-1": { mode: "selected", units: ["UNIT A"] },
        "admin-2": { mode: "none", units: [] },
      },
      unitNames: ["UNIT A", "UNIT B"],
    }),
    /UNIT B/
  );
});
