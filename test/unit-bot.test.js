const test = require("node:test");
const assert = require("node:assert/strict");
const { unitBotKey } = require("../lib/unit-bot");

test("permission notifications require a unit and its manager bot", () => {
  assert.throws(() => unitBotKey(null), { code: "UNIT_BOT_UNAVAILABLE" });
  assert.throws(() => unitBotKey({ namaKelas: "Operasional" }), {
    code: "UNIT_BOT_UNAVAILABLE",
  });
  assert.equal(unitBotKey({ waliKelas: "0812-3456-7890@c.us" }), "wali:6281234567890");
});
