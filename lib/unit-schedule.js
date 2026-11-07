const DEFAULT_SCHEDULE = Object.freeze({
  masuk: "09:00:00",
  pulang: "16:00:00",
  toleransi: 0,
  mulaiMasuk: "00:00:00",
  selesaiMasuk: "23:59:59",
  mulaiPulang: "00:00:00",
  selesaiPulang: "23:59:59",
});

function resolveUnitSchedule(organizationSchedule = {}, unit = null) {
  const schedule = { ...DEFAULT_SCHEDULE };
  for (const source of [organizationSchedule, unit?.jadwal]) {
    for (const key of Object.keys(DEFAULT_SCHEDULE)) {
      if (source?.[key] !== undefined && source[key] !== null) {
        schedule[key] = source[key];
      }
    }
  }
  return schedule;
}

function assertScheduleAccess(user, units, unitName) {
  let error;
  if (!["admin", "wali_kelas"].includes(user?.role)) {
    error = new Error("Pengaturan jadwal hanya tersedia untuk administrator atau pengelola unit.");
  } else if (!unitName) {
    if (user.role === "admin") return;
    error = new Error("Hanya administrator yang dapat mengubah jadwal organisasi.");
  } else if (!Object.hasOwn(units, unitName)) {
    error = new Error("Unit tidak ditemukan. Muat ulang daftar unit.");
    error.status = 404;
  } else if (user.role === "admin" || units[unitName].waliKelas === user.id) {
    return;
  } else {
    error = new Error("Pengelola unit hanya dapat mengubah jadwal unitnya sendiri.");
  }
  error.status ||= 403;
  throw error;
}

module.exports = { DEFAULT_SCHEDULE, resolveUnitSchedule, assertScheduleAccess };
