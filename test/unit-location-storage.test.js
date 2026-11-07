const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonState } = require("../lib/json-state");
const { resolveUnitLocation } = require("../lib/unit-location");

process.env.DB_PATH = ":memory:";
const { initJsonStore, saveJsonBatch, closeDatabase } = require("../models/database");

test("lokasi per unit dibaca kembali dari SQLite tanpa menimpa titik global", async (t) => {
  t.after(closeDatabase);
  const globalLocation = { latitude: -6.7329, longitude: 108.5522 };
  const stores = {
    units: { path: "missing-unit-location-test.json", fallback: { A: {}, B: {} } },
    location: { path: "missing-global-location-test.json", fallback: globalLocation },
  };
  const state = new JsonState({ initial: await initJsonStore(stores), writeBatch: saveJsonBatch });
  await state.update("units", (draft) => {
    draft.units.A.lokasi = { latitude: -6.2, longitude: 106.8 };
    draft.units.B.lokasi = { latitude: -6.9, longitude: 107.6 };
  });
  const reloaded = await initJsonStore(stores);
  assert.deepEqual(resolveUnitLocation(reloaded.location, reloaded.units.A), { latitude: -6.2, longitude: 106.8 });
  assert.deepEqual(resolveUnitLocation(reloaded.location, reloaded.units.B), { latitude: -6.9, longitude: 107.6 });
  assert.deepEqual(reloaded.location, globalLocation);
});
