const test = require("node:test");
const assert = require("node:assert/strict");
const {
  adminUnitContext,
  assertOperatorManagementAccess,
  adminUnitPolicyInput,
  assertAdminUnitScope,
  renameAdminUnitSettings,
  setActiveAdminUnit,
} = require("../lib/admin-unit-scope");
const { resolveLocationUnit } = require("../lib/unit-location");

const admin = { id: "admin@c.us", role: "admin" };
const managerA = "628111111111@c.us";
const managerB = "628222222222@c.us";
const units = {
  GUDANG: { waliKelas: managerA, siswa: {} },
  KANTOR: { waliKelas: managerB, siswa: {} },
  TOKO: { waliKelas: managerB, siswa: {} },
};
const scoped = () => ({
  [admin.id]: { mode: "selected", units: ["GUDANG"], activeUnit: "GUDANG" },
});

test("administrator lama tetap global tanpa policy migrasi", () => {
  const scope = adminUnitContext(admin, units, {});
  assert.equal(scope.globalMode, true);
  assert.deepEqual(scope.allowedUnits.sort(), Object.keys(units).sort());
});

test("administrator terbatas hanya melihat unit yang diberikan", () => {
  const scope = adminUnitContext(admin, units, scoped());
  assert.equal(scope.restricted, true);
  assert.equal(scope.activeUnit, "GUDANG");
  assert.deepEqual(scope.allowedUnits, ["GUDANG"]);
});

test("akses data unit tidak bisa dilewati hanya dengan mengganti parameter", () => {
  const settings = scoped();
  assert.doesNotThrow(() => assertAdminUnitScope(admin, units, settings, "GUDANG"));
  assert.throws(() => assertAdminUnitScope(admin, units, settings, "KANTOR"), { status: 403 });
  assert.throws(() => assertAdminUnitScope(admin, units, settings, "TOKO"), { status: 403 });
  assert.throws(() => assertAdminUnitScope(admin, units, settings, "", { global: true }), { status: 403 });
});

test("administrator unit tertentu tidak dapat berpindah ke unit lain", () => {
  const settings = scoped();
  assert.throws(() => setActiveAdminUnit(settings, admin.id, units, "KANTOR"), { status: 403 });
  assert.equal(setActiveAdminUnit(settings, admin.id, units, "GUDANG"), "GUDANG");
  assert.throws(() => setActiveAdminUnit(settings, admin.id, units, ""), { status: 403 });
  assert.deepEqual(settings[admin.id].units, ["GUDANG"]);
});

test("administrator global dapat kembali ke seluruh unit", () => {
  const settings = {};
  setActiveAdminUnit(settings, admin.id, units, "GUDANG");
  assert.throws(() => assertAdminUnitScope(admin, units, settings, "KANTOR"), { status: 403 });
  setActiveAdminUnit(settings, admin.id, units, "");
  assert.doesNotThrow(() => assertAdminUnitScope(admin, units, settings, "", { global: true }));
});

test("cakupan akses admin divalidasi saat menyimpan akun", () => {
  assert.throws(() => adminUnitPolicyInput({ accessMode: "selected", accessUnits: [] }, units), { status: 400 });
  assert.throws(() => adminUnitPolicyInput({ accessMode: "selected", accessUnits: ["LAIN"] }, units), { status: 400 });
  assert.throws(() => adminUnitPolicyInput({
    accessMode: "selected", accessUnits: ["GUDANG", "KANTOR"],
  }, units), { status: 400 });
  assert.throws(() => adminUnitPolicyInput({
    accessMode: "selected", accessUnits: ["GUDANG", "GUDANG"],
  }, units), { status: 400 });
  assert.deepEqual(adminUnitPolicyInput({
    accessMode: "selected", accessUnits: ["GUDANG"],
  }, units), { mode: "selected", units: ["GUDANG"], activeUnit: "GUDANG" });
});

test("ganti nama dan hapus unit memperbaiki daftar akses administrator", () => {
  const settings = scoped();
  renameAdminUnitSettings(settings, "GUDANG", "LOGISTIK");
  assert.deepEqual(settings[admin.id], {
    mode: "selected", units: ["LOGISTIK"], activeUnit: "LOGISTIK",
  });
  renameAdminUnitSettings(settings, "LOGISTIK");
  assert.deepEqual(settings[admin.id].units, []);
  assert.equal(settings[admin.id].activeUnit, "");
});

test("perintah lokasi dibatasi ke bot unit aktif", () => {
  assert.equal(resolveLocationUnit(units, {
    botKey: "wali:628111111111", role: "admin", selectedUnit: "GUDANG",
  }), "GUDANG");
  assert.throws(() => resolveLocationUnit(units, {
    botKey: "wali:628222222222", role: "admin", selectedUnit: "GUDANG",
  }), /bukan bot unit aktif/);
  assert.throws(() => resolveLocationUnit(units, {
    botKey: "wali:628222222222", role: "admin", selectedUnit: "KANTOR", name: "TOKO",
  }), /Pilih unit yang sesuai/);
});

test("Administrator unit aktif dapat mengelola Operator Bot unit sendiri", () => {
  const settings = scoped();
  assert.doesNotThrow(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "GUDANG", operatorId: "628300000000@c.us",
  }));
  assert.doesNotThrow(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "GUDANG", operatorId: managerA, editing: true,
  }));
});

test("Administrator unit aktif tidak dapat membuat atau mengubah Administrator", () => {
  assert.throws(() => assertOperatorManagementAccess(admin, units, scoped(), {
    role: "admin", unit: "GUDANG", operatorId: "628300000000@c.us",
  }), { status: 403 });
});

test("Administrator unit aktif tidak dapat mengelola operator unit lain", () => {
  const settings = scoped();
  assert.throws(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "KANTOR", operatorId: managerB, editing: true,
  }), { status: 403 });
  assert.throws(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "GUDANG", operatorId: managerB, editing: true,
  }), { status: 403 });
  assert.throws(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "GUDANG", operatorId: "628400000000@c.us", editing: true,
  }), { status: 403 });
});

test("akun operator bersama hanya boleh diatur dari mode global", () => {
  const settings = scoped();
  settings[admin.id].activeUnit = "KANTOR";
  assert.throws(() => assertOperatorManagementAccess(admin, units, settings, {
    role: "wali_kelas", unit: "KANTOR", operatorId: managerB, editing: true,
  }), { status: 403 });
  assert.doesNotThrow(() => assertOperatorManagementAccess(admin, units, {}, {
    role: "wali_kelas", unit: "KANTOR", operatorId: managerB, editing: true,
  }));
});

test("kebijakan lama beberapa unit dikunci ke satu unit aktif", () => {
  const legacy = { [admin.id]: { mode: "selected", units: ["GUDANG", "KANTOR"], activeUnit: "KANTOR" } };
  const scope = adminUnitContext(admin, units, legacy);
  assert.deepEqual(scope.allowedUnits, ["KANTOR"]);
  assert.equal(scope.activeUnit, "KANTOR");
  assert.throws(() => assertAdminUnitScope(admin, units, legacy, "GUDANG"), { status: 403 });
  assert.throws(() => setActiveAdminUnit(legacy, admin.id, units, "GUDANG"), { status: 403 });
  setActiveAdminUnit(legacy, admin.id, units, "KANTOR");
  assert.deepEqual(legacy[admin.id].units, ["KANTOR"]);
});

test("kebijakan lama tanpa unit aktif memilih unit pertama yang valid secara deterministik", () => {
  const legacy = { [admin.id]: { mode: "selected", units: ["LAIN", "GUDANG", "KANTOR"], activeUnit: "" } };
  const scope = adminUnitContext(admin, units, legacy);
  assert.deepEqual(scope.allowedUnits, ["GUDANG"]);
  assert.equal(scope.activeUnit, "GUDANG");
});
