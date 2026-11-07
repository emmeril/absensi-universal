function unitName(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function scopeError(message, status = 403) {
  return Object.assign(new Error(message), { status, code: "ADMIN_UNIT_SCOPE" });
}

function adminUnitContext(user, units = {}, settings = {}) {
  const policy = settings?.[user?.id] || {};
  const restricted = policy.mode === "selected";
  const knownUnits = Object.keys(units);
  const configuredUnit = unitName(policy.activeUnit);
  const policyUnits = [...new Set(
    (Array.isArray(policy.units) ? policy.units : []).map(unitName)
  )].filter((name) => Object.hasOwn(units, name));
  const lockedUnit = policyUnits.includes(configuredUnit)
    ? configuredUnit : policyUnits[0] || "";
  const allowedUnits = restricted ? (lockedUnit ? [lockedUnit] : []) : knownUnits;
  const activeUnit = restricted ? lockedUnit
    : (knownUnits.includes(configuredUnit) ? configuredUnit : "");

  return {
    restricted,
    allowedUnits,
    activeUnit,
    globalMode: !restricted && !activeUnit,
  };
}

function assertAdminUnitScope(user, units, settings, name, { global = false } = {}) {
  if (user?.role !== "admin") {
    throw scopeError("Hanya Administrator yang dapat mengelola data ini.");
  }
  const scope = adminUnitContext(user, units, settings);
  if (global) {
    if (!scope.globalMode) {
      throw scopeError("Pilih Semua unit untuk mengelola pengaturan pusat.");
    }
    return;
  }
  const target = unitName(name);
  if (!target || !Object.hasOwn(units, target)) {
    throw scopeError("Unit tidak ditemukan. Muat ulang daftar unit.", 404);
  }
  if (!scope.allowedUnits.includes(target) || (scope.activeUnit && scope.activeUnit !== target)) {
    throw scopeError("Unit ini bukan unit aktif Anda. Pilih unit yang sesuai terlebih dahulu.");
  }
  if (!scope.activeUnit && !scope.globalMode) {
    throw scopeError("Administrator tidak memiliki unit yang dapat dikelola.");
  }
}

function operatorUnitsForUser(units = {}, userId) {
  return Object.entries(units)
    .filter(([, unit]) => unit?.waliKelas === userId)
    .map(([name]) => name);
}

function assertOperatorManagementAccess(user, units, settings, {
  role, unit, operatorId, editing = false,
} = {}) {
  if (user?.role !== "admin") {
    throw scopeError("Hanya Administrator yang dapat mengelola akun operator.");
  }
  const scope = adminUnitContext(user, units, settings);
  if (scope.globalMode) return;
  if (role !== "wali_kelas") {
    throw scopeError("Administrator unit hanya dapat mengelola akun Operator Bot.");
  }
  assertAdminUnitScope(user, units, settings, unit);
  const target = unitName(unit);
  const assignments = operatorUnitsForUser(units, operatorId);
  if (
    assignments.some((name) => name !== target) ||
    (editing && (assignments.length !== 1 || assignments[0] !== target))
  ) {
    throw scopeError("Operator Bot dipakai unit lain atau bukan milik unit aktif. Hubungi Administrator pusat.");
  }
}

function setActiveAdminUnit(settings, userId, units, requested) {
  const name = unitName(requested);
  const scope = adminUnitContext({ id: userId }, units, settings);
  if (scope.restricted && name !== scope.activeUnit) {
    throw scopeError("Administrator unit tertentu hanya boleh menggunakan unit yang ditetapkan.");
  }
  if (name && !Object.hasOwn(units, name)) {
    throw scopeError("Unit tidak ditemukan. Muat ulang daftar unit.", 404);
  }
  if (name && !scope.allowedUnits.includes(name)) {
    throw scopeError("Anda tidak mempunyai akses ke unit tersebut.");
  }
  const current = settings[userId] || {};
  settings[userId] = {
    mode: scope.restricted ? "selected" : "all",
    units: scope.restricted ? scope.allowedUnits : [],
    activeUnit: name,
    ...("notificationMode" in current ? { notificationMode: current.notificationMode } : {}),
  };
  return name;
}

function adminUnitPolicyInput(body, units, current = {}) {
  const mode = body.accessMode === undefined
    ? (current.mode === "selected" ? "selected" : "all")
    : body.accessMode;
  if (!["all", "selected"].includes(mode)) {
    throw scopeError("Cakupan akses Administrator tidak valid.", 400);
  }
  if (mode === "all") {
    return { mode, units: [], activeUnit: current.mode === "all" ? unitName(current.activeUnit) : "" };
  }
  if (!Array.isArray(body.accessUnits) || body.accessUnits.length !== 1) {
    throw scopeError("Administrator unit tertentu harus memiliki tepat satu unit.", 400);
  }
  const allowedUnits = body.accessUnits.map(unitName);
  if (allowedUnits.some((name) => !name || !Object.hasOwn(units, name))) {
    throw scopeError("Daftar unit Administrator tidak valid.", 400);
  }
  return {
    mode,
    units: allowedUnits,
    activeUnit: allowedUnits.includes(unitName(current.activeUnit))
      ? unitName(current.activeUnit) : allowedUnits[0],
  };
}

function renameAdminUnitSettings(settings, previous, next = "") {
  for (const policy of Object.values(settings)) {
    if (!policy || typeof policy !== "object") continue;
    if (Array.isArray(policy.units)) {
      policy.units = [...new Set(policy.units.map(unitName)
        .map((name) => name === previous ? next : name).filter(Boolean))];
    }
    if (unitName(policy.activeUnit) === previous) {
      policy.activeUnit = next;
    }
  }
}

module.exports = {
  adminUnitContext,
  assertOperatorManagementAccess,
  operatorUnitsForUser,
  adminUnitPolicyInput,
  assertAdminUnitScope,
  renameAdminUnitSettings,
  scopeError,
  setActiveAdminUnit,
  unitName,
};
