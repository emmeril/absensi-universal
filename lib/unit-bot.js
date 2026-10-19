function normalizeNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  return number.startsWith("0") ? `62${number.slice(1)}` : number;
}

function unitBotKey(unit) {
  if (!unit) {
    const error = new Error("Anggota belum ditempatkan pada unit.");
    error.code = "UNIT_BOT_UNAVAILABLE";
    throw error;
  }
  const managerNumber = normalizeNumber(unit.waliKelas);
  if (!managerNumber) {
    const error = new Error(
      "Unit belum memiliki Pengelola Unit untuk mengirim notifikasi WhatsApp."
    );
    error.code = "UNIT_BOT_UNAVAILABLE";
    throw error;
  }
  return `wali:${managerNumber}`;
}

module.exports = { unitBotKey };
