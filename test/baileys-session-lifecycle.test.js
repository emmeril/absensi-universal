const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BaileysManager } = require("../lib/baileys-manager");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "baileys-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sockets = [];
  const manager = new BaileysManager({ authRoot: root });
  manager.waVersion = [2, 3000, 1];
  manager.logger = { child: () => ({}) };
  manager.library = {
    default: () => {
      const socket = {
        ev: new EventEmitter(),
        user: { id: "628111@s.whatsapp.net" },
        ended: false,
        logoutCalls: 0,
        sends: [],
        end() { this.ended = true; },
        async logout() { this.logoutCalls += 1; },
        async sendMessage(jid, message) {
          this.sends.push({ jid, message });
          return { key: { id: String(this.sends.length) }, message };
        },
        async onWhatsApp() { return []; },
      };
      sockets.push(socket);
      return socket;
    },
    Browsers: { ubuntu: () => ["Ruang Hadir", "Chrome", "1"] },
    DisconnectReason: { loggedOut: 401 },
    makeCacheableSignalKeyStore: (keys) => keys,
    useMultiFileAuthState: async (folder) => {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "creds.json"), "session");
      return { state: { creds: {}, keys: {} }, saveCreds: async () => {} };
    },
  };
  const classes = { "UNIT A": { waliKelas: "628111@c.us", siswa: {} } };
  return { manager, sockets, classes, root, key: "wali:628111" };
}

test("connected session receives commands, ignores stale sockets after reconnect", async (t) => {
  const { manager, sockets, classes, key } = fixture(t);
  await manager.start(classes);
  const seen = [];
  manager.on("message", ({ message }) => seen.push(message));
  const first = sockets[0];
  first.ev.emit("connection.update", { connection: "open" });
  first.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      { key: { id: "1", remoteJid: "628222@s.whatsapp.net", fromMe: false }, message: { conversation: "!bantuan" } },
      { key: { id: "2", remoteJid: "628222@s.whatsapp.net", fromMe: false }, message: { ephemeralMessage: { message: { conversation: "!masuk" } } } },
    ],
  });
  assert.deepEqual(seen.map((entry) => entry.body), ["!bantuan", "!masuk"]);
  await seen[0].reply("Bantuan");
  assert.equal(first.sends[0].jid, "628222@s.whatsapp.net");
  assert.ok(manager.statuses()[0].lastCommandAt);

  first.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { message: "restart", output: { statusCode: 515 } } } });
  assert.equal(manager.statuses()[0].ready, false);
  await manager.connect(manager.sessions.get(key));
  assert.equal(first.ended, true);
  const second = sockets[1];
  second.ev.emit("connection.update", { connection: "open" });
  first.ev.emit("messages.upsert", { type: "notify", messages: [
    { key: { id: "3", remoteJid: "628222@s.whatsapp.net" }, message: { conversation: "!izin" } },
  ] });
  assert.equal(seen.length, 2, "socket lama tidak boleh memproses perintah");
  second.ev.emit("messages.upsert", { type: "notify", messages: [
    { key: { id: "4", remoteJid: "628222@s.whatsapp.net" }, message: { conversation: "!izin" } },
  ] });
  assert.equal(seen.length, 3);
  await manager.close();
});

test("reset active session logs out, removes credentials and creates new QR connection", async (t) => {
  const { manager, sockets, classes, key, root } = fixture(t);
  await manager.start(classes);
  const oldSocket = sockets[0];
  oldSocket.ev.emit("connection.update", { connection: "open" });
  const sessionFile = path.join(root, "wali-628111", "creds.json");
  assert.equal(fs.readFileSync(sessionFile, "utf8"), "session");

  await manager.reset(key);
  assert.equal(oldSocket.logoutCalls, 1);
  assert.equal(oldSocket.ended, true);
  assert.equal(sockets.length, 2);
  assert.equal(manager.statuses()[0].ready, false);
  assert.equal(manager.statuses()[0].connectedNumber, "");
  assert.equal(fs.readFileSync(sessionFile, "utf8"), "session", "kredensial baru ditulis setelah reset");
  const next = sockets[1];
  next.ev.emit("connection.update", { qr: "fresh-qr" });
  assert.equal(manager.statuses()[0].qr, "fresh-qr");
  next.ev.emit("connection.update", { connection: "open" });
  assert.equal(manager.statuses()[0].ready, true);
  await manager.close();
});

test("reset simultaneous requests are rejected safely", async (t) => {
  const { manager, sockets, classes, key } = fixture(t);
  await manager.start(classes);
  sockets[0].ev.emit("connection.update", { connection: "open" });
  let allowLogout;
  const gate = new Promise((resolve) => { allowLogout = resolve; });
  sockets[0].logout = () => gate;
  const first = manager.reset(key);
  await assert.rejects(manager.reset(key), { code: "WA_RESET_IN_PROGRESS" });
  allowLogout();
  await first;
  await manager.close();
});
