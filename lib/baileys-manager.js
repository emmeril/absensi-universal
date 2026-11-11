const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { installLibsignalLogFilter } = require("./secure-console");

function digits(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function toAppUserId(jid) {
  const value = String(jid || "");
  if (value.endsWith("@lid")) return value;
  const number = digits(value);
  return number ? `${number}@c.us` : value;
}

function toBaileysJid(id) {
  const value = String(id || "");
  if (value.endsWith("@lid") || value.endsWith("@g.us")) return value;
  const number = digits(value);
  return number ? `${number}@s.whatsapp.net` : value;
}

function validWaVersion(version) {
  return Array.isArray(version) &&
    version.length === 3 &&
    version.every((part) => Number.isSafeInteger(part) && part >= 0);
}

async function resolveWaVersion(library, { timeoutMs = 10_000 } = {}) {
  const configured = String(process.env.WA_WEB_VERSION || "").trim();
  if (configured) {
    const version = configured.split(".").map(Number);
    if (!validWaVersion(version)) {
      throw new Error("WA_WEB_VERSION harus berformat angka.angka.angka.");
    }
    return { version, source: "konfigurasi" };
  }

  const fallback = library.DEFAULT_CONNECTION_CONFIG?.version;
  try {
    const result = await library.fetchLatestWaWebVersion({
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!result?.isLatest || !validWaVersion(result.version)) {
      throw result?.error || new Error("Versi WhatsApp Web terbaru tidak tersedia.");
    }
    return { version: [...result.version], source: "web.whatsapp.com" };
  } catch (error) {
    if (!validWaVersion(fallback)) throw error;
    console.warn(
      `[Baileys] Gagal mengambil versi WhatsApp Web terbaru; memakai versi bawaan ${fallback.join(".")}:`,
      error.message
    );
    return { version: [...fallback], source: "bawaan Baileys" };
  }
}

function unwrapMessage(content) {
  let current = content || {};
  for (let depth = 0; depth < 8; depth += 1) {
    const nested = [
      "ephemeralMessage",
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
      "documentWithCaptionMessage",
      "editedMessage",
    ].map((key) => current[key]?.message).find(Boolean);
    if (!nested) break;
    current = nested;
  }
  return current;
}

function messageBody(content) {
  return String(
    content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.listResponseMessage?.title ||
      content.templateButtonReplyMessage?.selectedDisplayText ||
      ""
  );
}

class RecentMessageStore {
  constructor({ maxEntries = 256, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 256);
    this.ttlMs = Math.max(1, Number(ttlMs) || 60 * 60 * 1000);
    this.now = now;
    this.messages = new Map();
  }

  set(key, message) {
    const id = String(key?.id || "");
    if (!id || !message) return;
    this.messages.delete(id);
    this.messages.set(id, { message, expiresAt: this.now() + this.ttlMs });
    this.prune();
  }

  get(key) {
    const id = String(key?.id || "");
    const entry = this.messages.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.messages.delete(id);
      return undefined;
    }
    return entry.message;
  }

  prune() {
    const now = this.now();
    for (const [id, entry] of this.messages) {
      if (entry.expiresAt <= now) this.messages.delete(id);
    }
    while (this.messages.size > this.maxEntries) {
      this.messages.delete(this.messages.keys().next().value);
    }
  }

  clear() {
    this.messages.clear();
  }
}

function adaptIncomingMessage(raw, socket, lidMap) {
  const content = unwrapMessage(raw.message);
  const location = content.locationMessage;
  const contextInfo =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    location?.contextInfo ||
    {};
  const rawSender = raw.key.participant || raw.key.remoteJid || "";
  const alternateSender = raw.key.participantAlt || raw.key.remoteJidAlt || "";
  if (String(rawSender).endsWith("@lid") && alternateSender) {
    lidMap.set(rawSender, alternateSender);
  } else if (String(alternateSender).endsWith("@lid") && rawSender) {
    lidMap.set(alternateSender, rawSender);
  }
  const phoneJid = lidMap.get(rawSender) ||
    (String(alternateSender).endsWith("@s.whatsapp.net") ? alternateSender : rawSender);
  const sender = toAppUserId(phoneJid);

  return {
    body: messageBody(content),
    from: sender,
    author: raw.key.participant ? sender : undefined,
    type: location ? "location" : "chat",
    location: location
      ? {
          latitude: Number(location.degreesLatitude),
          longitude: Number(location.degreesLongitude),
          name: location.name || "",
          address: location.address || "",
        }
      : null,
    isForwarded: Boolean(contextInfo.isForwarded),
    forwardingScore: Number(contextInfo.forwardingScore || 0),
    pushName: raw.pushName || "",
    // Keep the reply on the exact PN/LID conversation selected by WhatsApp.
    // Baileys v7 then migrates Signal sessions without mixing addressing modes.
    reply: (text) => socket.sendMessage(raw.key.remoteJid || rawSender, { text: String(text) }),
  };
}

function sessionDefinitions(classes) {
  const definitions = new Map();
  for (const [className, data] of Object.entries(classes || {})) {
    const number = digits(data.waliKelas);
    if (!number) continue;
    const key = `wali:${number}`;
    let definition = definitions.get(key);
    if (!definition) {
      definition = {
        key,
        role: "wali",
        label: data.namaWali ? `${data.namaWali} (${number})` : number,
        expectedNumber: number,
        classNames: [],
        studentNumbers: [],
      };
      definitions.set(key, definition);
    }
    definition.classNames.push(className);
    definition.studentNumbers.push(...Object.keys(data.siswa || {}).map(digits).filter(Boolean));
  }
  return definitions;
}

class BaileysManager extends EventEmitter {
  constructor({ authRoot = "./.baileys_auth" } = {}) {
    super();
    this.authRoot = path.resolve(authRoot);
    this.sessions = new Map();
    this.library = null;
    this.logger = null;
    this.waVersion = null;
    this.stopping = false;
  }

  async loadLibrary() {
    if (!this.library) {
      installLibsignalLogFilter();
      this.library = await import("@whiskeysockets/baileys");
      const pino = require("pino");
      this.logger = pino({ level: process.env.WA_LOG_LEVEL || "silent" });
    }
    if (!this.waVersion) {
      const resolved = await resolveWaVersion(this.library);
      this.waVersion = resolved.version;
      console.log(
        `[Baileys] Menggunakan WhatsApp Web ${this.waVersion.join(".")} dari ${resolved.source}.`
      );
    }
    return this.library;
  }

  async start(classes = {}) {
    fs.mkdirSync(this.authRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.authRoot, 0o700);
    await this.loadLibrary();
    await this.sync(classes);
  }

  async sync(classes = {}) {
    const wanted = sessionDefinitions(classes);
    for (const [key, session] of this.sessions) {
      if (wanted.has(key)) continue;
      this.stopSession(session);
      this.sessions.delete(key);
    }

    const starts = [];
    for (const [key, definition] of wanted) {
      const existing = this.sessions.get(key);
      if (existing) {
        existing.definition = definition;
        if (existing.ready) starts.push(this.mapKnownStudents(existing));
        continue;
      }
      const session = {
        definition,
        socket: null,
        qr: null,
        ready: false,
        state: "starting",
        connectedNumber: "",
        error: "",
        stopped: false,
        reconnectTimer: null,
        reconnectAttempts: 0,
        connectPromise: null,
        resetPromise: null,
        credsSavePromise: Promise.resolve(),
        disposeListeners: null,
        lastCommandAt: null,
        generation: 0,
        lidMap: new Map(),
        recentMessages: new RecentMessageStore(),
      };
      this.sessions.set(key, session);
      starts.push(this.connect(session).catch((error) => {
        console.warn("[Baileys] Koneksi awal gagal:", error.message);
      }));
    }
    await Promise.allSettled(starts);
  }

  async connect(session) {
    if (this.stopping || session.stopped) return;
    if (session.connectPromise) return session.connectPromise;
    const promise = this.openSocket(session);
    session.connectPromise = promise;
    try {
      await promise;
    } catch (error) {
      if (!this.stopping && !session.stopped &&
          this.sessions.get(session.definition.key) === session) {
        session.ready = false;
        session.state = "error";
        session.error = String(error?.message || error);
        this.emit("status", this.publicStatus(session));
        this.scheduleReconnect(session);
      }
      throw error;
    } finally {
      if (session.connectPromise === promise) session.connectPromise = null;
    }
  }

  scheduleReconnect(session) {
    if (this.stopping || session.stopped || ["logged_out", "mismatch"].includes(session.state)) return;
    clearTimeout(session.reconnectTimer);
    const delay = Math.min(60000, 3000 * 2 ** Math.min(session.reconnectAttempts++, 5));
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      void this.connect(session).catch((error) => {
        console.warn("[Baileys] Reconnect gagal:", error.message);
      });
    }, delay);
    session.reconnectTimer.unref?.();
  }

  disposeSocket(session) {
    const socket = session.socket;
    session.socket = null;
    session.disposeListeners?.();
    session.disposeListeners = null;
    if (socket) {
      try { socket.end(new Error("SOCKET_REPLACED")); }
      catch (error) { console.warn("[Baileys] Gagal menutup socket:", error.message); }
    }
  }

  async openSocket(session) {
    const generation = ++session.generation;
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    this.disposeSocket(session);
    session.ready = false;
    session.qr = null;
    const current = () => !this.stopping && !session.stopped &&
      session.generation === generation && this.sessions.get(session.definition.key) === session;
    const {
      default: makeWASocket,
      Browsers,
      DisconnectReason,
      makeCacheableSignalKeyStore,
      useMultiFileAuthState,
    } = await this.loadLibrary();
    if (!current()) return;
    const folder = this.sessionFolder(session.definition.key);
    const { state, saveCreds } = await useMultiFileAuthState(folder);
    if (!current()) return;
    const socket = makeWASocket({
      version: this.waVersion,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      logger: this.logger,
      browser: Browsers.ubuntu("Ruang Hadir"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => session.recentMessages.get(key),
    });
    session.socket = socket;
    session.state = "connecting";
    session.error = "";
    const listeners = [];
    const listen = (name, handler) => {
      socket.ev.on(name, handler);
      listeners.push([name, handler]);
    };
    session.disposeListeners = () => {
      for (const [name, handler] of listeners) socket.ev.off?.(name, handler);
    };
    listen("creds.update", () => {
      if (!current()) return;
      session.credsSavePromise = session.credsSavePromise
        .catch(() => {})
        .then(() => current() ? saveCreds() : undefined)
        .catch((error) => console.error("[Baileys] Gagal menyimpan kredensial:", error.message));
    });
    listen("chats.phoneNumberShare", ({ lid, jid }) => {
      if (current() && lid && jid) session.lidMap.set(lid, jid);
    });
    listen("contacts.upsert", (contacts) => { if (current()) this.rememberContacts(session, contacts); });
    listen("contacts.update", (contacts) => { if (current()) this.rememberContacts(session, contacts); });
    listen("connection.update", (update) => {
      if (!current()) return;
      if (update.qr) {
        session.qr = update.qr;
        session.ready = false;
        session.state = "qr";
        this.emit("status", this.publicStatus(session));
      }
      if (update.connection === "open") {
        const connectedNumber = digits(socket.user?.id);
        session.connectedNumber = connectedNumber;
        if (
          session.definition.expectedNumber &&
          connectedNumber !== session.definition.expectedNumber
        ) {
          session.ready = false;
          session.qr = null;
          session.state = "mismatch";
          session.error = `Nomor terhubung ${connectedNumber || "tidak diketahui"}; seharusnya ${session.definition.expectedNumber}.`;
          this.emit("status", this.publicStatus(session));
          socket.end(new Error("WA_ACCOUNT_MISMATCH"));
          return;
        }
        session.ready = true;
        session.qr = null;
        session.state = "open";
        session.error = "";
        session.reconnectAttempts = 0;
        this.emit("status", this.publicStatus(session));
        void this.mapKnownStudents(session);
      }
      if (update.connection === "close") {
        session.ready = false;
        session.qr = null;
        if (session.state === "mismatch") return;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        session.state = code === DisconnectReason.loggedOut ? "logged_out" : "closed";
        const detail = String(update.lastDisconnect?.error?.message || "Koneksi terputus.");
        session.error = code ? `${detail} (kode ${code})` : detail;
        this.emit("status", this.publicStatus(session));
        if (!this.stopping && !session.stopped && code !== DisconnectReason.loggedOut) {
          this.scheduleReconnect(session);
        }
      }
    });
    listen("messages.upsert", ({ messages, type }) => {
      if (!current() || !Array.isArray(messages)) return;
      for (const raw of messages) session.recentMessages.set(raw?.key, raw?.message);
      if (type !== "notify" || !session.ready) return;
      for (const raw of messages) {
        const jid = String(raw?.key?.remoteJid || "");
        if (!jid || !raw.message || raw.key.fromMe ||
            jid.endsWith("@g.us") || jid.endsWith("@broadcast") ||
            jid === "status@broadcast") continue;
        const message = adaptIncomingMessage(raw, socket, session.lidMap);
        message.reply = (text) => this.sendReply(session, jid, text);
        if (message.body.trim().startsWith("!")) {
          session.lastCommandAt = new Date().toISOString();
          console.log("[Baileys] Command diterima:", session.definition.key, message.body.trim().split(/\s+/)[0].slice(0, 32));
        }
        this.emit("message", {
          botKey: session.definition.key,
          botRole: session.definition.role,
          expectedNumber: session.definition.expectedNumber,
          classNames: [...session.definition.classNames],
          message,
        });
      }
    });
  }

  async sendReply(session, jid, text) {
    if (this.requireReady(session.definition.key) !== session) {
      const error = new Error("Sesi WhatsApp tidak lagi aktif.");
      error.code = "WA_SESSION_NOT_READY";
      throw error;
    }
    const sent = await session.socket.sendMessage(jid, { text: String(text) });
    session.recentMessages.set(sent?.key, sent?.message);
    return sent;
  }

  rememberContacts(session, contacts) {
    for (const contact of contacts || []) {
      const lid = contact.lid || (String(contact.id).endsWith("@lid") ? contact.id : "");
      const jid = contact.jid || (String(contact.id).endsWith("@s.whatsapp.net") ? contact.id : "");
      if (lid && jid) session.lidMap.set(lid, jid);
    }
  }

  async mapKnownStudents(session) {
    if (!session.ready || !session.definition.studentNumbers.length) return;
    const socket = session.socket;
    const generation = session.generation;
    try {
      const results = await socket.onWhatsApp(
        ...[...new Set(session.definition.studentNumbers)].map(toBaileysJid)
      );
      if (!session.ready || session.socket !== socket || session.generation !== generation) return;
      for (const result of results || []) {
        if (result.lid && result.jid) session.lidMap.set(result.lid, result.jid);
      }
    } catch (error) {
      console.warn(`[Baileys ${session.definition.key}] Pemetaan nomor anggota gagal:`, error.message);
    }
  }

  sessionFolder(key) {
    return path.join(this.authRoot, key.replace(":", "-"));
  }

  publicStatus(session) {
    return {
      key: session.definition.key,
      role: session.definition.role,
      label: session.definition.label,
      expectedNumber: session.definition.expectedNumber,
      connectedNumber: session.connectedNumber,
      classes: [...session.definition.classNames],
      ready: session.ready,
      state: session.state,
      lastCommandAt: session.lastCommandAt,
      qr: session.qr,
      error: session.error,
    };
  }

  statuses() {
    return [...this.sessions.values()].map((session) => this.publicStatus(session));
  }

  isReady(key = "main") {
    return Boolean(this.sessions.get(key)?.ready);
  }

  async sendText(key, recipientId, text) {
    const session = this.requireReady(key);
    const sent = await session.socket.sendMessage(toBaileysJid(recipientId), {
      text: String(text),
    });
    session.recentMessages.set(sent?.key, sent?.message);
    return sent;
  }

  async sendImage(key, recipientId, media, caption = "") {
    const session = this.requireReady(key);
    const image = Buffer.isBuffer(media.buffer)
      ? media.buffer
      : Buffer.from(String(media.data || ""), "base64");
    const sent = await session.socket.sendMessage(toBaileysJid(recipientId), {
      image,
      caption,
      mimetype: media.mimetype,
      fileName: media.filename || "image.jpg",
    });
    session.recentMessages.set(sent?.key, sent?.message);
    return sent;
  }

  requireReady(key) {
    const session = this.sessions.get(key);
    if (!session?.ready || !session.socket) {
      const error = new Error(`Sesi WhatsApp ${key} belum terhubung.`);
      error.code = "WA_SESSION_NOT_READY";
      throw error;
    }
    return session;
  }

  stopSession(session) {
    session.stopped = true;
    session.ready = false;
    session.generation++;
    clearTimeout(session.reconnectTimer);
    session.socket?.end(new Error("SESSION_REMOVED"));
  }

  async reset(key) {
    const session = this.sessions.get(key);
    if (!session) throw new Error("Sesi WhatsApp tidak ditemukan.");
    this.stopSession(session);
    const folder = path.resolve(this.sessionFolder(key));
    if (path.dirname(folder) !== this.authRoot) {
      throw new Error("Lokasi sesi WhatsApp tidak valid.");
    }
    await fs.promises.rm(folder, { recursive: true, force: true });
    session.stopped = false;
    session.state = "starting";
    session.connectedNumber = "";
    session.error = "";
    session.lidMap.clear();
    session.recentMessages.clear();
    await this.connect(session);
  }

  async close() {
    this.stopping = true;
    for (const session of this.sessions.values()) this.stopSession(session);
    this.sessions.clear();
  }
}

module.exports = {
  BaileysManager,
  RecentMessageStore,
  adaptIncomingMessage,
  resolveWaVersion,
  sessionDefinitions,
  toAppUserId,
  toBaileysJid,
};
