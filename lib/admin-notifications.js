const VALID_NOTIFICATION_MODES = new Set(["all", "selected", "none"]);

function normalizeNotificationPreference(raw, availableUnits = []) {
  if (!raw || typeof raw !== "object") return { mode: "all", units: [] };
  const mode = VALID_NOTIFICATION_MODES.has(raw.mode) ? raw.mode : "all";
  if (mode !== "selected") return { mode, units: [] };

  const available = new Set(availableUnits);
  const units = [...new Set(Array.isArray(raw.units) ? raw.units : [])]
    .filter((unit) => typeof unit === "string" && available.has(unit));
  return { mode, units };
}

function receivesUnit(preference, unitName) {
  if (preference.mode === "all") return true;
  return preference.mode === "selected" && preference.units.includes(unitName);
}

function notificationPolicyError({ adminIds, preferences, unitNames }) {
  if (!adminIds.length) return "Minimal satu Administrator harus tersedia.";

  const normalized = Object.fromEntries(
    adminIds.map((id) => [
      id,
      normalizeNotificationPreference(preferences[id], unitNames),
    ])
  );

  if (adminIds.length === 1 && normalized[adminIds[0]].mode === "none") {
    return "Administrator satu-satunya tidak boleh menonaktifkan notifikasi.";
  }

  const uncovered = unitNames.filter(
    (unitName) => !adminIds.some((id) => receivesUnit(normalized[id], unitName))
  );
  if (uncovered.length) {
    return `Setiap unit harus memiliki penerima notifikasi Administrator. Belum tercakup: ${uncovered.join(", ")}.`;
  }
  return "";
}

module.exports = {
  VALID_NOTIFICATION_MODES,
  normalizeNotificationPreference,
  notificationPolicyError,
  receivesUnit,
};
