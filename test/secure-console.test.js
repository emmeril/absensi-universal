const test = require("node:test");
const assert = require("node:assert/strict");
const { installLibsignalLogFilter } = require("../lib/secure-console");

test("filters libsignal session objects without hiding normal logs", () => {
  const logs = [];
  const fakeConsole = {
    info: (...args) => logs.push(["info", ...args]),
    warn: (...args) => logs.push(["warn", ...args]),
  };
  class SessionEntry {}
  const restore = installLibsignalLogFilter(fakeConsole);
  fakeConsole.info("Closing session:", new SessionEntry());
  fakeConsole.warn("Session already closed", new SessionEntry());
  fakeConsole.info("Server ready");
  restore();
  fakeConsole.info("Closing session:", new SessionEntry());

  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0], ["info", "Server ready"]);
  assert.equal(logs[1][0], "info");
  assert.equal(logs[1][1], "Closing session:");
});
