const { unitBotKey } = require("./unit-bot");

function resolveUnitLocation(organizationLocation, unit) {
  const location = unit?.lokasi ?? organizationLocation;
  if (
    !Number.isFinite(location?.latitude) ||
    !Number.isFinite(location?.longitude) ||
    location.latitude < -90 || location.latitude > 90 ||
    location.longitude < -180 || location.longitude > 180
  ) {
    throw new Error("Titik lokasi unit belum valid. Hubungi administrator untuk mengatur ulang !lokasi.");
  }
  return { latitude: location.latitude, longitude: location.longitude };
}

function locationAccessError(message) {
  const error = new Error(message);
  error.code = "UNIT_LOCATION_ACCESS";
  return error;
}

function resolveLocationUnit(units, { botKey, role, name = "" }) {
  if (role !== "admin") {
    throw locationAccessError("Hanya administrator yang dapat mengatur lokasi unit.");
  }
  const served = Object.entries(units).filter(([, unit]) => {
    try {
      return unitBotKey(unit) === botKey;
    } catch {
      return false;
    }
  });
  const unitName = String(name).trim().toUpperCase();
  let selected;
  if (unitName) {
    selected = served.find(([candidate]) => candidate === unitName);
    if (!selected) {
      throw locationAccessError("Unit tidak ditemukan pada bot ini. Kirim !lokasi melalui bot milik unit yang ingin diatur.");
    }
  } else {
    if (!served.length) throw locationAccessError("Bot ini belum melayani unit yang aktif.");
    if (served.length > 1) {
      throw locationAccessError(`Bot ini melayani beberapa unit. Ketik !lokasi NAMA UNIT. Unit tersedia: ${served.map(([name]) => name).join(", ")}.`);
    }
    selected = served[0];
  }
  return selected[0];
}

module.exports = { resolveUnitLocation, resolveLocationUnit };
