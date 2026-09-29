require("dotenv").config();
process.env.TZ = process.env.TZ || "Asia/Jakarta";
process.umask(0o077);

const fs = require("fs");
const path = require("path");
const moment = require("moment");
const haversine = require("haversine-distance");
const ExcelJS = require("exceljs");
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const crypto = require("crypto");
const { loadImage } = require("canvas");
const {
  DB_PATH,
  attendanceForDate,
  attendanceStatus,
  cancelNotificationsForMediaPaths,
  claimNextNotification,
  closeDatabase,
  compactDatabase,
  createAttendance,
  enqueueNotifications,
  fillAttendanceSnapshot,
  initJsonStore,
  markNotificationSent,
  migrateLegacyAttendance,
  notificationOutboxStats,
  purgeSentNotifications,
  recoverNotificationOutbox,
  renameAttendanceStudent,
  renamePendingNotificationRecipient,
  rescheduleNotification,
  saveJsonBatch,
  withDatabaseTransaction,
} = require("./models/database");
const { BaileysManager } = require("./lib/baileys-manager");
const { TEACHERS_PATH, TEACHER_RECORDS_PATH, EMPTY_TEACHERS, createTeacherAttendance } = require("./lib/teacher-attendance");
const { qrToSvg } = require("./lib/qr-svg");
const {
  validateLocationMessage,
  locationRejectionMessage,
} = require("./lib/location-message");
const { FaceWorkerPool } = require("./services/face-worker-pool");
const {
  NotificationOutboxProcessor,
  mediaForOutboxJob,
} = require("./services/notification-outbox");
const { JsonState } = require("./lib/json-state");
const { safeAsyncListener } = require("./lib/safe-async-listener");
const {
  createWhatsappSender,
  isRetryableWhatsappError,
} = require("./lib/whatsapp-send");
const {
  hashPassword,
  hashPasswordSync,
  isValidPassword,
  isValidUsername,
  normalizeUsername,
  verifyPassword,
} = require("./lib/dashboard-auth");
const {
  createRateLimiter,
  serializeSessionCookie,
} = require("./lib/web-security");
const {
  deleteManagedFile,
  ensurePrivateDir,
  hardenPrivateTree,
  isManagedPath,
  moveManagedFile,
  writePrivateFile,
} = require("./lib/private-files");
const {
  getArrivalStatus,
  isWithinAttendanceWindow,
  validateAttendance,
  validatePermission,
} = require("./lib/attendance-rules");
const app = express();
const PORT = 3200;
const CAMERA_SESSION_TTL_MS = 2 * 60 * 1000;
const PERMISSION_SESSION_TTL_MS = 5 * 60 * 1000;
const LOCATION_REQUEST_TTL_MS = 5 * 60 * 1000;
const STATE_CLEANUP_INTERVAL_MS = 60 * 1000;
const ATTENDANCE_RADIUS_METERS = 100;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const webSessions = new Map();
const cameraSessions = new Map();
const permissionSessions = new Map();
const loginLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  limit: 10,
  message: "Terlalu banyak percobaan login dari koneksi ini. Coba lagi nanti.",
});
const cameraRequestLimiter = createRateLimiter({
  windowMs: 5 * 60_000,
  limit: 40,
  message: "Terlalu banyak permintaan kamera dari koneksi ini. Coba lagi nanti.",
});

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
app.use("/api/auth/login", loginLimiter);
app.use("/api/attendance-camera", cameraRequestLimiter);
app.use("/api/permission-camera", cameraRequestLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));
app.get("/vendor/alpine.min.js", (_req, res) =>
  res.sendFile(require.resolve("alpinejs/dist/cdn.min.js"))
);
app.get("/vendor/bootstrap.min.css", (_req, res) =>
  res.sendFile(require.resolve("bootstrap/dist/css/bootstrap.min.css"))
);
app.use(
  "/vendor/fontawesome",
  express.static(path.resolve(path.dirname(require.resolve("@fortawesome/fontawesome-free/css/all.min.css")), ".."))
);

const STORAGE_PATH = "./storage.json";
const KONTAK_PATH = "./kontak.json";
const ROLE_PATH = "./roles.json";
const LOKASI_PATH = "./lokasi.json";
const JAM_PATH = "./jam.json";
const FACE_DB = "./face_db";
const FACE_REC = "./face_rec";
const IZIN_BUKTI_DIR = "./izin_bukti";
const ATTENDANCE_PHOTO_DIR = "./attendance_photos";
const IZIN_PATH = "./izin.json";
const KELAS_PATH = "./kelas.json";
const USER_NAMES_PATH = "./user_names.json";
const DASHBOARD_ACCOUNTS_PATH = "./dashboard_accounts.json";
const BRAND_PATH = "./brand.json";
const BRAND_LOGO_DIR = "./brand";
const DEFAULT_BRAND = {
  name: "Ruang Hadir",
  logoFile: "",
  logoMimeType: "",
};
const initialAdminNumber = String(process.env.INITIAL_ADMIN_NUMBER || "").replace(/\D/g, "");
const INITIAL_ROLES = /^62\d{8,14}$/.test(initialAdminNumber)
  ? { [`${initialAdminNumber}@c.us`]: "admin" }
  : {};
const initialAdminUsername = normalizeUsername(process.env.INITIAL_ADMIN_USERNAME);
const initialAdminPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "");
const INITIAL_DASHBOARD_ACCOUNTS =
  /^62\d{8,14}$/.test(initialAdminNumber) &&
  isValidUsername(initialAdminUsername) &&
  isValidPassword(initialAdminPassword)
    ? {
        [initialAdminUsername]: {
          userId: `${initialAdminNumber}@c.us`,
          passwordHash: hashPasswordSync(initialAdminPassword),
        },
      }
    : {};
const DUMMY_PASSWORD_HASH = hashPasswordSync("dummy-login-password");

const JSON_STORES = {
  [TEACHERS_PATH]: { path: TEACHERS_PATH, fallback: EMPTY_TEACHERS },
  [TEACHER_RECORDS_PATH]: { path: TEACHER_RECORDS_PATH, fallback: { records: {}, tokens: {} } },
  [STORAGE_PATH]: { path: STORAGE_PATH, fallback: {} },
  [KONTAK_PATH]: { path: KONTAK_PATH, fallback: {} },
  [ROLE_PATH]: { path: ROLE_PATH, fallback: INITIAL_ROLES },
  [LOKASI_PATH]: {
    path: LOKASI_PATH,
    fallback: { latitude: -6.7329, longitude: 108.5522 },
  },
  [JAM_PATH]: {
    path: JAM_PATH,
    fallback: {
      masuk: "09:00:00",
      pulang: "16:00:00",
      toleransi: 0,
      mulaiMasuk: "00:00:00",
      selesaiMasuk: "23:59:59",
      mulaiPulang: "00:00:00",
      selesaiPulang: "23:59:59",
    },
  },
  [IZIN_PATH]: { path: IZIN_PATH, fallback: {} },
  [KELAS_PATH]: { path: KELAS_PATH, fallback: {} },
  [USER_NAMES_PATH]: { path: USER_NAMES_PATH, fallback: {} },
  [DASHBOARD_ACCOUNTS_PATH]: {
    path: DASHBOARD_ACCOUNTS_PATH,
    fallback: INITIAL_DASHBOARD_ACCOUNTS,
  },
  [BRAND_PATH]: { path: BRAND_PATH, fallback: DEFAULT_BRAND },
};

const jsonState = new JsonState({ writeBatch: saveJsonBatch });

const facePool = new FaceWorkerPool({
  size: Number(process.env.FACE_WORKER_COUNT) || 1,
  maxQueue: Number(process.env.FACE_QUEUE_LIMIT) || 100,
  timeoutMs: Number(process.env.FACE_TIMEOUT_MS) || 60000,
  estimatedJobMs: Number(process.env.FACE_ESTIMATED_JOB_MS) || 2500,
});
const whatsappSenders = new Map();

function sendWhatsappWithRetry(send, metadata = {}) {
  const senderKey = metadata.senderKey || "main";
  if (!whatsappSenders.has(senderKey)) {
    whatsappSenders.set(senderKey, createWhatsappSender({
      shouldRetry: isRetryableWhatsappError,
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(
          `[WhatsApp Retry ${senderKey}] Percobaan ulang ${attempt} dalam ${delayMs} ms:`,
          error.message
        );
      },
      onThrottle: ({ delayMs, queueSize }) => {
        if (delayMs >= 10_000) {
          console.log(
            `[WhatsApp Safety ${senderKey}] Menunggu ${delayMs} ms (antrean: ${queueSize}).`
          );
        }
      },
    }));
  }
  return whatsappSenders.get(senderKey)(send, metadata);
}
const activeFaceJobs = new Set();
let notificationOutboxProcessor = null;

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function loadJSON(path, fallback = {}) {
  return jsonState.read(path, fallback);
}
function loadJSONSelected(path, select, fallback = {}) {
  return jsonState.readSelected(path, select, fallback);
}
async function saveJSON(path, data) {
  return jsonState.update(path, (draft) => {
    draft[path] = cloneData(data);
  });
}

function normalizeBrandName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
    return "";
  }
  return name;
}

function loadBrandSettings() {
  const stored = loadJSON(BRAND_PATH, DEFAULT_BRAND);
  return {
    name: normalizeBrandName(stored?.name) || DEFAULT_BRAND.name,
    logoFile: /^logo-[a-f0-9]{16}\.(?:png|jpg)$/.test(stored?.logoFile || "")
      ? stored.logoFile
      : "",
    logoMimeType: ["image/png", "image/jpeg"].includes(stored?.logoMimeType)
      ? stored.logoMimeType
      : "",
  };
}

function brandLogoPath(brand = loadBrandSettings()) {
  return brand.logoFile ? path.join(BRAND_LOGO_DIR, brand.logoFile) : "";
}

function publicBrandSettings() {
  const brand = loadBrandSettings();
  const logoPath = brandLogoPath(brand);
  const hasLogo = Boolean(logoPath && fs.existsSync(logoPath));
  return {
    name: brand.name,
    hasLogo,
    logoUrl: hasLogo ? `/api/brand/logo?v=${path.parse(brand.logoFile).name}` : "",
  };
}

async function updateJSON(paths, mutate) {
  return jsonState.update(paths, mutate);
}
async function updateJSONAtomic(paths, mutate, databaseMutate) {
  return jsonState.transact(paths, mutate, (draft, result) =>
    withDatabaseTransaction(async (transaction) => {
      await saveJsonBatch(draft, { transaction });
      await databaseMutate({ draft, result, transaction });
    })
  );
}
function getWaktu() {
  const now = moment();
  return {
    tanggal: now.format("YYYY-MM-DD"),
    jam: now.format("HH:mm:ss"),
  };
}
async function exportExcel(data) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Rekap");
  const headers = data.length ? Object.keys(data[0]) : ["Tanggal"];
  worksheet.columns = headers.map((header) => ({ header, key: header }));
  worksheet.addRows(data);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true };
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function ensureDir(dirPath) {
  ensurePrivateDir(dirPath);
}

function deletePrivateFileSafely(filePath, rootPath, context = "file privat") {
  try {
    return deleteManagedFile(filePath, rootPath);
  } catch (error) {
    console.error(`[Cleanup ERROR] ${context}:`, error.message);
    return false;
  }
}

function normalizeJam(jam) {
  if (typeof jam !== "string") return jam;
  if (/^\d{2}:\d{2}$/.test(jam)) return `${jam}:00`;
  return jam;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function isValidDate(value) {
  const input = String(value || "");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(input) &&
    moment(input, "YYYY-MM-DD", true).isValid()
  );
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(
    /\/$/,
    ""
  );
}

function sessionCookieIsSecure(req) {
  const configured = process.env.SESSION_COOKIE_SECURE;
  if (configured !== undefined && configured !== "") {
    return ["1", "true", "yes", "on"].includes(configured.toLowerCase());
  }
  return req.secure || publicBaseUrl().startsWith("https://");
}

function createCameraSession(userId, tipe, botKey) {
  for (const [token, session] of cameraSessions) {
    if (session.userId === userId) cameraSessions.delete(token);
  }

  const token = crypto.randomBytes(32).toString("hex");
  cameraSessions.set(token, {
    userId,
    tipe,
    botKey,
    expiresAt: Date.now() + CAMERA_SESSION_TTL_MS,
    processing: false,
  });
  return token;
}

function getCameraSession(token) {
  const session = cameraSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    cameraSessions.delete(token);
    return null;
  }
  return session;
}

function createPermissionSession(userId, alasan, tanggal, botKey) {
  for (const [token, session] of permissionSessions) {
    if (session.userId === userId) permissionSessions.delete(token);
  }

  const token = crypto.randomBytes(32).toString("hex");
  permissionSessions.set(token, {
    userId,
    alasan,
    tanggal,
    botKey,
    expiresAt: Date.now() + PERMISSION_SESSION_TTL_MS,
    verified: false,
    processing: false,
  });
  return token;
}

function getPermissionSession(token) {
  const session = permissionSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    permissionSessions.delete(token);
    return null;
  }
  return session;
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match || match[2].length > 8 * 1024 * 1024) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) return null;
  return { mimetype: match[1], data: match[2], buffer };
}

function imageMetadata(buffer) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(pngSignature)) {
    return {
      mimetype: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const sizeMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (sizeMarkers.has(marker) && segmentLength >= 7) {
        return {
          mimetype: "image/jpeg",
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
  }
  return null;
}

function validateImageMetadata(buffer) {
  const metadata = imageMetadata(buffer);
  if (
    !metadata ||
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width > MAX_IMAGE_DIMENSION ||
    metadata.height > MAX_IMAGE_DIMENSION ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error("Format atau dimensi gambar tidak valid.");
  }
  return metadata;
}

async function validateImageBuffer(buffer) {
  const metadata = validateImageMetadata(buffer);
  await loadImage(buffer);
  return metadata;
}

async function validateImagePayload(image, { decode = true } = {}) {
  const metadata = decode
    ? await validateImageBuffer(image.buffer)
    : validateImageMetadata(image.buffer);
  image.mimetype = metadata.mimetype;
  return image;
}

function imageExtension(mimetype) {
  return mimetype === "image/png" ? "png" : "jpg";
}

function attendancePhotoPath(tanggal, userId, tipe, foto) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? tanggal : "legacy";
  const safeUser = String(userId || "").replace(/\D/g, "") || "unknown";
  const safeType = tipe === "pulang" ? "pulang" : "masuk";
  const digest = crypto.createHash("sha256").update(foto.buffer).digest("hex").slice(0, 16);
  return path.join(
    ATTENDANCE_PHOTO_DIR,
    safeDate,
    `${safeUser}-${safeType}-${digest}.${imageExtension(foto.mimetype)}`
  );
}

async function migrateEmbeddedAttendancePhotos() {
  const storage = loadJSON(STORAGE_PATH);
  let migrated = 0;
  for (const [tanggal, students] of Object.entries(storage)) {
    for (const [userId, attendance] of Object.entries(students || {})) {
      for (const tipe of ["masuk", "pulang"]) {
        const record = attendance?.[tipe];
        const legacyPhoto = record?.foto;
        if (!legacyPhoto?.data) continue;
        const parsed = parseImageDataUrl(
          `data:${legacyPhoto.mimetype || "image/jpeg"};base64,${legacyPhoto.data}`
        );
        if (!parsed) {
          console.warn(`[Migrasi Foto] Foto ${tanggal}/${userId}/${tipe} tidak valid; data lama dipertahankan.`);
          continue;
        }
        try {
          const metadata = validateImageMetadata(parsed.buffer);
          parsed.mimetype = metadata.mimetype;
          const photoPath = attendancePhotoPath(tanggal, userId, tipe, parsed);
          if (!fs.existsSync(photoPath)) writePrivateFile(photoPath, parsed.buffer);
          record.fotoPath = photoPath;
          record.fotoMimeType = parsed.mimetype;
          record.fotoSize = parsed.buffer.length;
          delete record.foto;
          migrated += 1;
        } catch (error) {
          console.warn(`[Migrasi Foto] Foto ${tanggal}/${userId}/${tipe} gagal dipindahkan:`, error.message);
        }
      }
    }
  }
  if (migrated) {
    await saveJSON(STORAGE_PATH, storage);
    console.log(`[Migrasi Foto] ${migrated} foto absensi dipindahkan dari JSON ke penyimpanan privat.`);
  }
  return migrated;
}

function cleanupOrphanedFaceFiles() {
  const kontak = loadJSON(KONTAK_PATH);
  const teachers = loadJSON(TEACHERS_PATH, EMPTY_TEACHERS).teachers;
  let removed = 0;
  for (const root of [FACE_DB, FACE_REC]) {
    if (!fs.existsSync(root)) continue;
    for (const fileName of fs.readdirSync(root)) {
      const studentId = `${path.parse(fileName).name}@c.us`;
      const teacher = teachers[path.parse(fileName).name];
      if (!kontak[studentId] && !teacher && deleteManagedFile(path.join(root, fileName), root)) removed += 1;
    }
  }
  if (fs.existsSync(FACE_DB)) {
    for (const fileName of fs.readdirSync(FACE_DB)) {
      const legacyPath = path.join(FACE_DB, fileName);
      const activePath = path.join(FACE_REC, fileName);
      if (
        fs.existsSync(activePath) &&
        fs.statSync(legacyPath).size === fs.statSync(activePath).size &&
        fs.readFileSync(legacyPath).equals(fs.readFileSync(activePath)) &&
        deleteManagedFile(legacyPath, FACE_DB)
      ) {
        removed += 1;
      }
    }
  }
  if (removed) console.log(`[Cleanup Privasi] ${removed} foto wajah orphan/duplikat dihapus.`);
}

function hardenSensitiveStorage() {
  for (const root of [FACE_DB, FACE_REC, IZIN_BUKTI_DIR, ATTENDANCE_PHOTO_DIR, BRAND_LOGO_DIR]) {
    hardenPrivateTree(root);
  }
}

function antreVerifikasiWajah(userId, fotoBuffer) {
  if (activeFaceJobs.has(userId)) {
    const error = new Error("Verifikasi wajah untuk pengguna ini masih berjalan");
    error.code = "FACE_JOB_ACTIVE";
    throw error;
  }

  activeFaceJobs.add(userId);
  try {
    const startedAt = Date.now();
    const queued = facePool.verify(userId.replace("@c.us", ""), fotoBuffer);
    queued.promise = queued.promise
      .then((result) => {
        const durationMs = Date.now() - startedAt;
        const slowLogMs = Number(process.env.FACE_SLOW_LOG_MS) || 10000;
        if (durationMs >= slowLogMs) {
          console.log(
            `[Face Performance SLOW] ${userId}: ${durationMs}ms ` +
              `(posisi antrean ${queued.position})`
          );
        }
        return result.match === true;
      })
      .finally(() => activeFaceJobs.delete(userId));
    return queued;
  } catch (e) {
    activeFaceJobs.delete(userId);
    throw e;
  }
}

function logVerificationFailure(context, userId, error) {
  const expected =
    error.code === "FACE_JOB_ACTIVE" ||
    (error.code === "FACE_NOT_DETECTED" && /foto selfie/i.test(error.message)) ||
    /^(?:Kamu berada di luar area sekolah|Wajah tidak (?:dikenali|ditemukan))/.test(
      error.message
    );
  const label = expected ? "DITOLAK" : "ERROR";
  if (expected) console.log(`[${context} ${label}] ${userId}:`, error.message);
  else console.error(`[${context} ${label}] ${userId}:`, error.message);
}

function faceFailureResponse(error, fallback) {
  if (["QUEUE_FULL", "FACE_QUEUE_DEADLINE"].includes(error?.code)) {
    return {
      status: 503,
      message: "Antrean verifikasi wajah sedang penuh. Tunggu sebentar lalu kirim perintah lagi.",
    };
  }
  if (error?.code === "FACE_DEADLINE_EXCEEDED") {
    return {
      status: 504,
      message: "Verifikasi wajah melewati batas waktu. Kirim perintah lagi untuk mencoba ulang.",
    };
  }
  return { status: 400, message: fallback };
}

function loadRoles() {
  return loadJSON(ROLE_PATH, {});
}

function loadDashboardAccounts() {
  return loadJSON(DASHBOARD_ACCOUNTS_PATH, {});
}

function dashboardAccountForUser(accounts, userId) {
  for (const [username, account] of Object.entries(accounts || {})) {
    if (account?.userId === userId) return { username, ...account };
  }
  return null;
}

function setDashboardAccount(accounts, { username, userId, passwordHash }) {
  const existing = accounts[username];
  if (existing && existing.userId !== userId) {
    const error = new Error("Username sudah digunakan akun lain.");
    error.code = "USERNAME_EXISTS";
    throw error;
  }
  for (const [savedUsername, account] of Object.entries(accounts)) {
    if (account?.userId === userId && savedUsername !== username) {
      delete accounts[savedUsername];
    }
  }
  accounts[username] = { userId, passwordHash };
}

function removeDashboardAccount(accounts, userId) {
  for (const [username, account] of Object.entries(accounts || {})) {
    if (account?.userId === userId) delete accounts[username];
  }
}

function dashboardUserName(id, role) {
  const savedName = loadJSON(USER_NAMES_PATH, {})[id];
  if (savedName) return savedName;

  if (role === "wali_kelas") {
    const wali = Object.values(loadKelas()).find((data) => data.waliKelas === id);
    if (wali?.namaWali) return wali.namaWali;
  }

  return ({ admin: "Administrator", tu: "Tata Usaha", wali_kelas: "Wali Kelas" })[role] || "Pengguna";
}

async function syncWaliKelasToTeachers() {
  const roles = loadRoles();
  const names = loadJSON(USER_NAMES_PATH, {});
  const kelas = loadKelas();
  let synced = 0;
  await updateJSON([TEACHERS_PATH], (draft) => {
    const teacherConfig = draft[TEACHERS_PATH];
    teacherConfig.teachers ||= {};
    for (const [id, role] of Object.entries(roles)) {
      if (role !== "wali_kelas") continue;
      const nomor = id.replace("@c.us", "");
      if (teacherConfig.number === nomor) continue;
      const name = names[id] || Object.values(kelas).find((data) => data.waliKelas === id)?.namaWali;
      if (!name) continue;
      const current = teacherConfig.teachers[nomor];
      if (!current || current.name !== name) {
        teacherConfig.teachers[nomor] = { ...(current || {}), name, active: current?.active !== false };
        synced += 1;
      }
    }
  });
  return synced;
}

async function syncClassCatalogs() {
  await updateJSON([KELAS_PATH, TEACHERS_PATH], (draft) => {
    const studentClasses = draft[KELAS_PATH];
    const teacherConfig = draft[TEACHERS_PATH];
    const names = new Set([
      ...Object.keys(studentClasses),
      ...(teacherConfig.classes || []),
      ...Object.values(teacherConfig.schedules || {}).map((schedule) => schedule.className),
    ].filter(Boolean).map((name) => String(name).trim().toUpperCase()));
    for (const name of names) studentClasses[name] ||= { siswa: {}, waliKelas: "", namaWali: "" };
    teacherConfig.classes = [...names].sort((left, right) => left.localeCompare(right, "id", { numeric: true }));
    for (const schedule of Object.values(teacherConfig.schedules || {})) schedule.className = String(schedule.className).trim().toUpperCase();
  });
}

async function syncStudentClassCatalog(change) {
  const name = String(change.name || "").trim().toUpperCase();
  const originalName = String(change.originalName || "").trim().toUpperCase();
  await updateJSON([KELAS_PATH], (draft) => {
    const kelas = draft[KELAS_PATH];
    if (change.type === "add") {
      kelas[name] ||= { siswa: {}, waliKelas: "", namaWali: "" };
      return;
    }
    if (change.type === "rename" && kelas[originalName] && originalName !== name) {
      if (kelas[name]) throw new Error("Nama kelas sudah digunakan pada data siswa.");
      kelas[name] = kelas[originalName];
      delete kelas[originalName];
      return;
    }
    if (change.type === "delete" && kelas[name]) {
      if (Object.keys(kelas[name].siswa || {}).length) throw new Error("Pindahkan siswa sebelum menghapus kelas.");
      delete kelas[name];
    }
  });
}

function ensureStudentClassCanRename(originalName, name) {
  const kelas = loadKelas();
  const original = String(originalName || "").trim().toUpperCase();
  const next = String(name || "").trim().toUpperCase();
  if (original !== next && kelas[original] && kelas[next]) {
    throw new Error("Nama kelas sudah digunakan pada data siswa.");
  }
}

function ensureStudentClassCanDelete(name) {
  const kelas = loadKelas();
  const current = kelas[String(name || "").trim().toUpperCase()];
  if (current && Object.keys(current.siswa || {}).length) {
    throw new Error("Pindahkan siswa sebelum menghapus kelas.");
  }
}

function teksBantuan(role, terdaftar) {
  const lines = [`*Perintah WhatsApp ${loadBrandSettings().name}*`];

  if (role === "admin") {
    lines.push(
      "",
      "Akses: Administrator",
      "• *!lokasi* - Mengatur titik lokasi sekolah melalui salah satu bot wali kelas. Setelah perintah ini, bagikan lokasi sekolah melalui fitur Lokasi WhatsApp.",
      "• *!bantuan* - Menampilkan daftar perintah yang tersedia untuk role kamu.",
      "",
      `Pengelolaan siswa, kelas, jadwal, izin, admin, dan laporan tersedia di dashboard: ${publicBaseUrl()}`
    );
    return lines.join("\n");
  }

  if (role === "wali_kelas") {
    lines.push(
      "",
      "Akses: Wali Kelas",
      "• *!bantuan* - Menampilkan daftar perintah yang tersedia untuk role kamu.",
      "",
      `Data siswa dan foto referensi kelas dikelola melalui dashboard: ${publicBaseUrl()}`
    );
    return lines.join("\n");
  }

  if (role === "tu") {
    lines.push(
      "",
      "Akses: Tata Usaha",
      "• *!lokasi* - Mengatur titik lokasi sekolah melalui Bot Guru. Setelah perintah ini, bagikan lokasi sekolah melalui fitur Lokasi WhatsApp.",
      "• *!bantuan* - Menampilkan daftar perintah yang tersedia untuk role kamu.",
      "",
      `Absensi guru dan Bot Guru dikelola melalui dashboard: ${publicBaseUrl()}`
    );
    return lines.join("\n");
  }

  if (terdaftar) {
    lines.push(
      "",
      "Akses: Siswa Terdaftar",
      "• *!masuk* - Memulai absensi masuk dan menerima tautan kamera sekali pakai.",
      "• *!pulang* - Memulai absensi pulang dan menerima tautan kamera sekali pakai.",
      "• *!izin alasan* - Mengajukan izin melalui tautan verifikasi dan unggah bukti.",
      "• *!bantuan* - Menampilkan daftar perintah yang tersedia untuk role kamu."
    );
    return lines.join("\n");
  }

  lines.push(
    "",
    "Akses: Belum Terdaftar",
    "• *!bantuan* - Menampilkan bantuan dasar.",
    "",
    "Nomor kamu belum terdaftar untuk absensi. Hubungi admin sekolah agar dapat menggunakan perintah absensi."
  );
  return lines.join("\n");
}

async function resolveDashboardUserName(id, role) {
  return dashboardUserName(id, role);
}

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeNomor(rawNomor) {
  const nomor = String(rawNomor || "").replace(/\D/g, "");
  if (nomor.startsWith("0")) return `62${nomor.slice(1)}`;
  return nomor;
}

function loadIzin() {
  return loadJSON(IZIN_PATH, {});
}

function loadKelas() {
  return loadJSON(KELAS_PATH, {});
}

async function loadDailyStudentStatus(tanggal, studentId) {
  const attendance = await attendanceStatus(tanggal, studentId);
  const permission = loadJSONSelected(
    IZIN_PATH,
    (permissions) => permissions[tanggal]?.[studentId] || null
  );
  return {
    masuk: Boolean(attendance.masuk),
    pulang: Boolean(attendance.pulang),
    izin: Boolean(permission),
  };
}

function findKelasSiswa(dataKelas, siswaId) {
  for (const [namaKelas, data] of Object.entries(dataKelas)) {
    if (data.siswa?.[siswaId]) return { namaKelas, ...data };
  }
  return null;
}

function textNotification(botKey, recipientId, text, options = {}) {
  return {
    botKey,
    recipientId,
    kind: "text",
    text,
    priority: options.priority || 0,
    dedupeKey: options.dedupeKey || null,
  };
}

function imageNotification(botKey, recipientId, mediaPath, text, options = {}) {
  return {
    botKey,
    recipientId,
    kind: "image",
    text,
    mediaPath,
    mimetype: options.mimetype || "image/jpeg",
    filename: options.filename || "image.jpg",
    priority: options.priority || 0,
    dedupeKey: options.dedupeKey || null,
  };
}

function getAttendanceWindow(jamResmi, tipe) {
  return tipe === "masuk"
    ? { mulai: jamResmi.mulaiMasuk, selesai: jamResmi.selesaiMasuk }
    : { mulai: jamResmi.mulaiPulang, selesai: jamResmi.selesaiPulang };
}

function getAttendanceStatus(waktu, jamResmi, tipe) {
  if (tipe === "masuk") {
    return getArrivalStatus(
      waktu,
      normalizeJam(jamResmi.masuk),
      jamResmi.toleransi
    );
  }

  return waktu >= normalizeJam(jamResmi.pulang)
    ? "Sesuai Waktu"
    : "Pulang Cepat";
}

function getStudentNotificationRecipients(studentId, kelasSiswa) {
  const recipients = new Set(
    Object.entries(loadRoles())
      .filter(([, role]) => role === "admin")
      .map(([id]) => id)
  );
  if (kelasSiswa?.waliKelas) recipients.add(kelasSiswa.waliKelas);
  if (kelasSiswa?.siswa[studentId]?.orangTua) {
    recipients.add(kelasSiswa.siswa[studentId].orangTua);
  }
  recipients.delete(studentId);
  return recipients;
}

async function catatAbsensiKamera(userId, tipe, lokasi, foto, botKey) {
  const waktu = getWaktu();
  const photoPath = attendancePhotoPath(waktu.tanggal, userId, tipe, foto);
  const photoAlreadyExists = fs.existsSync(photoPath);
  if (!photoAlreadyExists) writePrivateFile(photoPath, foto.buffer);
  let status;
  try {
    await jsonState.exclusive(async () => {
      const kontak = loadJSON(KONTAK_PATH);
      const kelasSiswa = findKelasSiswa(loadKelas(), userId);
      const jamResmi = loadJSON(JAM_PATH, {
        masuk: "09:00:00",
        pulang: "16:00:00",
        toleransi: 0,
        mulaiMasuk: "00:00:00",
        selesaiMasuk: "23:59:59",
        mulaiPulang: "00:00:00",
        selesaiPulang: "23:59:59",
      });
      const lokasiKantor = loadJSON(LOKASI_PATH, {
        latitude: -6.7329,
        longitude: 108.5522,
      });
      if (haversine(lokasi, lokasiKantor) > ATTENDANCE_RADIUS_METERS) {
        throw new Error("Kamu berada di luar area sekolah.");
      }
      if (!kontak[userId]) throw new Error("Siswa sudah tidak terdaftar.");

      const normalizedStatus = await attendanceStatus(waktu.tanggal, userId);
      const permission = loadJSONSelected(
        IZIN_PATH,
        (izin) => izin[waktu.tanggal]?.[userId] || null
      );
      const attendanceError = validateAttendance(
        { ...normalizedStatus, izin: Boolean(permission) },
        tipe
      );
      if (attendanceError) throw new Error(attendanceError);

      const { mulai: mulaiAbsen, selesai: selesaiAbsen } = getAttendanceWindow(
        jamResmi,
        tipe
      );
      if (!isWithinAttendanceWindow(waktu.jam, mulaiAbsen, selesaiAbsen)) {
        throw new Error(
          `Absen ${tipe} hanya dapat dilakukan pukul ${String(
            mulaiAbsen || "00:00"
          ).slice(0, 5)}-${String(selesaiAbsen || "23:59").slice(0, 5)}.`
        );
      }

      status = getAttendanceStatus(waktu.jam, jamResmi, tipe);
      const caption =
        `*${kontak[userId]}* telah absen *${tipe}*\n` +
        `Status: *${status}*\n` +
        `Jam: ${waktu.jam}`;
      const jobs = [
        ...getStudentNotificationRecipients(userId, kelasSiswa),
      ].map((id) =>
          imageNotification(botKey, id, photoPath, caption, {
            mimetype: foto.mimetype,
            filename: `${userId.replace("@c.us", "")}.jpg`,
            dedupeKey: `attendance:${waktu.tanggal}:${userId}:${tipe}:media:${id}`,
          })
        );
      jobs.push(
        textNotification(
          botKey,
          userId,
          `✅ Absen ${tipe} dicatat (${status}) pada ${waktu.jam}.`,
          {
            priority: 10,
            dedupeKey: `attendance:${waktu.tanggal}:${userId}:${tipe}:confirmation`,
          }
        )
      );

      await withDatabaseTransaction(async (transaction) => {
        await createAttendance(
          {
            tanggal: waktu.tanggal,
            siswaId: userId,
            tipe,
            waktu: waktu.jam,
            lokasi,
            status,
            fotoPath: photoPath,
            fotoMimeType: foto.mimetype,
            fotoSize: foto.buffer.length,
            nama: kontak[userId],
            kelas: kelasSiswa?.namaKelas || "",
            waliKelas: kelasSiswa?.waliKelas || "",
          },
          { transaction }
        );
        await enqueueNotifications(jobs, { transaction });
      });
    });
  } catch (error) {
    if (!photoAlreadyExists) {
      deletePrivateFileSafely(photoPath, ATTENDANCE_PHOTO_DIR, `foto absensi ${userId}`);
    }
    if (error.name === "SequelizeUniqueConstraintError") {
      throw new Error(`Absen ${tipe} hanya dapat dilakukan satu kali per hari.`);
    }
    throw error;
  }

  notificationOutboxProcessor?.wake();

  return { status, waktu: waktu.jam, tanggal: waktu.tanggal };
}

const whatsapp = new BaileysManager({
  authRoot: process.env.BAILEYS_AUTH_DATA_PATH || "./.baileys_auth",
});

notificationOutboxProcessor = new NotificationOutboxProcessor({
  store: {
    recover: recoverNotificationOutbox,
    claim: claimNextNotification,
    markSent: markNotificationSent,
    reschedule: rescheduleNotification,
    purgeSent: purgeSentNotifications,
  },
  deliver: async (job) => {
    const media = await mediaForOutboxJob(job);
    return sendWhatsappWithRetry(
      () =>
        media
          ? whatsapp.sendImage(job.botKey, job.recipientId, media, job.text)
          : whatsapp.sendText(job.botKey, job.recipientId, job.text),
      {
        recipientId: `${job.botKey}:${job.recipientId}`,
        priority: job.priority > 0 ? "high" : "normal",
        senderKey: job.botKey,
      }
    );
  },
  isRetryable: (error) =>
    error?.code === "WA_SESSION_NOT_READY" ||
    (error?.code !== "OUTBOX_MEDIA_MISSING" && isRetryableWhatsappError(error)),
  concurrency: Number(process.env.NOTIFICATION_OUTBOX_CONCURRENCY) || 4,
  pollIntervalMs: Number(process.env.NOTIFICATION_OUTBOX_POLL_MS) || 2000,
  retryBaseDelayMs: Number(process.env.NOTIFICATION_RETRY_BASE_DELAY_MS) || 15000,
  retryMaxDelayMs: Number(process.env.NOTIFICATION_RETRY_MAX_DELAY_MS) || 15 * 60_000,
  maxAttempts: Number(process.env.NOTIFICATION_MAX_ATTEMPTS) || 12,
  retentionMs: Number(process.env.NOTIFICATION_SENT_RETENTION_MS) || 7 * 24 * 60 * 60_000,
  onError: ({ job, error, failed, delayMs }) => {
    const action = failed ? "dihentikan" : `diulang dalam ${delayMs} ms`;
    console.error(
      `[Notification Outbox] ${job?.id || "processor"} ke ${job?.recipientId || "-"} ${action}:`,
      error.message
    );
  },
});

const pendingLokasi = new Map();

function cleanupRuntimeState() {
  const now = Date.now();
  for (const [token, session] of webSessions) {
    if (session.expiresAt <= now) webSessions.delete(token);
  }
  for (const [token, session] of cameraSessions) {
    if (session.expiresAt <= now) cameraSessions.delete(token);
  }
  for (const [token, session] of permissionSessions) {
    if (session.expiresAt <= now) permissionSessions.delete(token);
  }
  for (const [id, expiresAt] of pendingLokasi) {
    if (expiresAt <= now) pendingLokasi.delete(id);
  }
}

const runtimeStateCleanup = setInterval(cleanupRuntimeState, STATE_CLEANUP_INTERVAL_MS);
runtimeStateCleanup.unref();

whatsapp.on("status", (status) => {
  if (status.state === "qr") {
    console.log(`[Baileys ${status.key}] QR tersedia di menu WhatsApp dashboard.`);
  } else if (status.ready) {
    console.log(`[Baileys ${status.key}] Terhubung sebagai ${status.connectedNumber}.`);
  } else if (status.state === "mismatch") {
    console.error(`[Baileys ${status.key}] ${status.error}`);
  } else if (["closed", "logged_out", "error"].includes(status.state)) {
    console.warn(`[Baileys ${status.key}] ${status.error || "Koneksi terputus."}`);
  }
});

whatsapp.on("message", safeAsyncListener(async ({
  botKey,
  expectedNumber,
  classNames,
  message: msg,
}) => {
  const commandStartedAt = Date.now();
  const sender = msg.author || msg.from;
  const body = String(msg.body || "").trim().toLowerCase();
  const kontak = loadJSON(KONTAK_PATH);
  const roles = loadJSON(ROLE_PATH);
  const jamResmi = loadJSON(JAM_PATH, {
    masuk: "09:00:00",
    pulang: "16:00:00",
    toleransi: 0,
    mulaiMasuk: "00:00:00",
    selesaiMasuk: "23:59:59",
    mulaiPulang: "00:00:00",
    selesaiPulang: "23:59:59",
  });
  const waktu = getWaktu();
  const role = roles[sender] || "user";
  const terdaftar = Boolean(kontak[sender]);

  async function replyCommand(message) {
    const replyStartedAt = Date.now();
    try {
      return await sendWhatsappWithRetry(() => msg.reply(message), {
        recipientId: `${botKey}:${sender}`,
        priority: "high",
        senderKey: botKey,
      });
    } finally {
      if (body.startsWith("!")) {
        console.log(
          `[Command Performance] ${body.split(/\s+/)[0]} ${sender}: ` +
            `handler=${replyStartedAt - commandStartedAt}ms reply=${Date.now() - replyStartedAt}ms ` +
            `total=${Date.now() - commandStartedAt}ms`
        );
      }
    }
  }

  const pendingLocationKey = `${botKey}:${sender}`;
  if (msg.type === "location" && pendingLokasi.get(pendingLocationKey) > Date.now()) {
    const validation = validateLocationMessage(msg);
    if (!validation.valid) {
      return replyCommand(locationRejectionMessage(validation.reason));
    }
    await saveJSON(LOKASI_PATH, validation.location);
    pendingLokasi.delete(pendingLocationKey);
    return replyCommand("✅ Lokasi sekolah disimpan.");
  }
  if (body === "!lokasi" || body === "!setlokasi") {
    const tuCanSetLocation = role === "tu" && botKey === `tu:${teacherAttendance.config().number}`;
    if (role !== "admin" && !tuCanSetLocation) return replyCommand("❌ Hanya admin atau Tata Usaha melalui Bot Guru.");
    pendingLokasi.set(pendingLocationKey, Date.now() + LOCATION_REQUEST_TTL_MS);
    return replyCommand("📍 Bagikan lokasi sekolah sekarang melalui fitur Lokasi WhatsApp.");
  }

  if (await teacherAttendance.command({ botKey, sender, body, reply: replyCommand })) return;

  const kelasSiswa = findKelasSiswa(loadKelas(), sender);
  const beradaDiBotWali =
    terdaftar &&
    kelasSiswa?.waliKelas === `${expectedNumber}@c.us` &&
    classNames.includes(kelasSiswa.namaKelas);

  if (body === "!bantuan") {
    if (["admin", "tu", "wali_kelas"].includes(role)) {
      return replyCommand(teksBantuan(role, beradaDiBotWali));
    }
    return replyCommand(
      beradaDiBotWali
        ? teksBantuan("user", true)
        : "Nomor ini adalah bot absensi wali kelas. Kamu belum terdaftar pada kelas yang dilayani bot ini."
    );
  }
  if (!beradaDiBotWali && body.startsWith("!")) {
    return replyCommand(
      "❌ Kamu tidak terdaftar di kelas yang dilayani nomor wali ini. Hubungi admin sekolah."
    );
  }
  if (!body.startsWith("!")) return;
  if (
    body !== "!masuk" &&
    body !== "!pulang" &&
    body !== "!izin" &&
    !body.startsWith("!izin ")
  ) {
    return replyCommand(
      "❌ Perintah tidak dikenali. Gunakan *!masuk*, *!pulang*, *!izin alasan*, atau *!bantuan*."
    );
  }

  // Absen masuk/pulang
  if (body.startsWith("!masuk") || body.startsWith("!pulang")) {
    const tipe = body.startsWith("!masuk") ? "masuk" : "pulang";
    const nomor = sender.replace("@c.us", "");
    const attendanceError = validateAttendance(
      await loadDailyStudentStatus(waktu.tanggal, sender),
      tipe
    );
    if (attendanceError) return replyCommand(`❌ ${attendanceError}`);
    const { mulai: mulaiAbsen, selesai: selesaiAbsen } = getAttendanceWindow(
      jamResmi,
      tipe
    );
    if (!isWithinAttendanceWindow(waktu.jam, mulaiAbsen, selesaiAbsen)) {
      return replyCommand(
        `❌ Absen ${tipe} hanya dapat dilakukan pukul ${String(
          mulaiAbsen || "00:00"
        ).slice(0, 5)}–${String(selesaiAbsen || "23:59").slice(0, 5)}.`
      );
    }

    if (!fs.existsSync(`${FACE_REC}/${nomor}.jpg`)) {
      return replyCommand(
        "⚠️ Foto referensi wajah belum ada. Hubungi admin atau wali kelas untuk mengunggah foto melalui dashboard."
      );
    }

    const token = createCameraSession(sender, tipe, botKey);
    const cameraUrl = `${publicBaseUrl()}/camera.html?token=${token}`;

    return replyCommand(
      `Buka tautan berikut untuk absen *${tipe}*:\n${cameraUrl}\n\n` +
        "Ambil selfie langsung dari kamera dan izinkan akses lokasi. " +
        "Tautan hanya berlaku selama 2 menit dan hanya bisa digunakan sekali."
    );
  }

  // Pengajuan izin wajib dilengkapi foto bukti.
  if (body === "!izin") {
    return replyCommand("⚠️ Format: *!izin alasan*\nContoh: *!izin sakit demam*");
  }

  if (body.startsWith("!izin ")) {
    const alasan = msg.body.trim().slice(6).trim();
    if (alasan.length < 3) return replyCommand("⚠️ Alasan izin terlalu singkat.");
    const permissionError = validatePermission(
      await loadDailyStudentStatus(waktu.tanggal, sender)
    );
    if (permissionError) return replyCommand(`❌ ${permissionError}`);

    const token = createPermissionSession(sender, alasan, waktu.tanggal, botKey);
    const permissionUrl = `${publicBaseUrl()}/permission.html?token=${token}`;
    return replyCommand(
      `Buka tautan berikut untuk mengajukan izin:\n${permissionUrl}\n\n` +
        "Tahap 1: ambil selfie langsung dan izinkan GPS.\n" +
        "Tahap 2: unggah foto surat atau bukti izin secara terpisah.\n" +
        "Tautan berlaku selama 5 menit."
    );
  }

}, (error) => {
  console.error("[WhatsApp Message ERROR]", error.message);
}));

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        if (separator < 1) return null;
        const key = cookie.slice(0, separator).trim();
        const value = cookie.slice(separator + 1);
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function webUser(req) {
  const token = parseCookies(req).absensi_session;
  const session = token ? webSessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) webSessions.delete(token);
    return null;
  }
  const currentRole = loadRoles()[session.id];
  const currentAccount = loadDashboardAccounts()[session.username];
  if (
    currentRole !== session.role ||
    !["admin", "tu", "wali_kelas"].includes(currentRole) ||
    currentAccount?.userId !== session.id
  ) {
    webSessions.delete(token);
    return null;
  }
  return session;
}

function requireWebAuth(req, res, next) {
  const user = webUser(req);
  if (!user) return res.status(401).json({ error: "Silakan login terlebih dahulu." });
  req.webUser = user;
  next();
}

function requireWebAdmin(req, res, next) {
  if (req.webUser?.role !== "admin") {
    return res.status(403).json({ error: "Fitur ini hanya tersedia untuk admin." });
  }
  next();
}

function requireWebTeacherManager(req, res, next) {
  if (!["admin", "tu"].includes(req.webUser?.role)) {
    return res.status(403).json({ error: "Fitur ini hanya tersedia untuk admin atau Tata Usaha." });
  }
  next();
}

function requireWhatsappBotAccess(req, res, next) {
  const bot = whatsapp.statuses().find((status) => status.key === req.params.key);
  if (!bot) {
    return res.status(404).json({ error: "Sesi WhatsApp tidak ditemukan." });
  }
  const ownsBot =
    req.webUser?.role === "wali_kelas" &&
    bot.expectedNumber === req.webUser.nomor;
  const managesTeacherBot = req.webUser?.role === "tu" && bot.role === "tu";
  if (req.webUser?.role !== "admin" && !ownsBot && !managesTeacherBot) {
    return res.status(403).json({
      error: "Wali kelas hanya dapat mengelola sesi WhatsApp miliknya.",
    });
  }
  req.whatsappBot = bot;
  next();
}

function requireWebPhotoManager(req, res, next) {
  if (req.webUser?.role === "admin") return next();

  const siswaId = `${normalizeNomor(req.params.number)}@c.us`;
  const kelasWali = kelasUntukWali(loadKelas(), req.webUser?.id);
  if (req.webUser?.role === "wali_kelas" && findKelasSiswa(kelasWali, siswaId)) {
    return next();
  }

  return res.status(403).json({
    error: "Wali kelas hanya dapat mengunggah foto siswa di kelasnya.",
  });
}

function kelasUntukWali(kelas, userId) {
  return Object.fromEntries(
    Object.entries(kelas).filter(([, data]) => data.waliKelas === userId)
  );
}

function removeUnusedWaliRole(userId, kelas, roles) {
  if (!userId || roles[userId] !== "wali_kelas") return;
  const masihMenjadiWali = Object.values(kelas).some(
    (data) => data.waliKelas === userId
  );
  if (!masihMenjadiWali) delete roles[userId];
}

const teacherAttendance = createTeacherAttendance({
  loadJSON, updateJSON, parseImageDataUrl, validateImagePayload, validateImageBuffer,
  verifyFace: (userId, buffer) => antreVerifikasiWajah(userId, buffer).promise,
  writePrivateFile, requireWebAuth, requireWebAdmin, requireWebTeacherManager, upload, publicBaseUrl,
  getClasses: loadKelas, getStudents: () => loadJSON(KONTAK_PATH),
  syncStudentClassCatalog, ensureStudentClassCanRename, ensureStudentClassCanDelete,
  syncBots: () => whatsapp.sync(loadKelas()),
  notifyTeacherAttendance: async (record) => {
    const botNumber = teacherAttendance.config().number;
    if (!botNumber) return;
    const recipients = Object.entries(loadRoles())
      .filter(([, role]) => ["admin", "tu"].includes(role))
      .map(([id]) => id);
    if (!recipients.length) return;
    const time = new Date(record.arrival).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
    const status = record.lateMinutes ? `Terlambat ${record.lateMinutes} menit` : "Tepat waktu";
    await enqueueNotifications(recipients.map((recipientId) => textNotification(
      `tu:${botNumber}`,
      recipientId,
      `*${record.name}* telah absen mengajar.\nJadwal: ${record.schedule.start}–${record.schedule.end} · ${record.schedule.className} · ${record.schedule.subject}\nJam: ${time}\nStatus: ${status}`,
      { priority: 10, dedupeKey: `teacher-attendance:${record.key}:${recipientId}` }
    )));
    notificationOutboxProcessor?.wake();
  },
});
whatsapp.getTuConfig = () => {
  const config = teacherAttendance.config();
  return { number: config.number, teacherNumbers: Object.keys(config.teachers) };
};
teacherAttendance.registerCamera(app, cameraRequestLimiter);
teacherAttendance.registerAdmin(app);

app.get("/api/permission-camera/:token", (req, res) => {
  const session = getPermissionSession(req.params.token);
  if (!session) {
    return res.status(410).json({ error: "Tautan izin sudah tidak berlaku." });
  }
  const kontak = loadJSON(KONTAK_PATH);
  res.json({
    nama: kontak[session.userId] || "Siswa",
    alasan: session.alasan,
    expiresAt: session.expiresAt,
    verified: session.verified,
  });
});

app.post("/api/permission-camera/:token/verify", async (req, res) => {
  const session = getPermissionSession(req.params.token);
  if (!session || session.processing || session.verified) {
    return res.status(410).json({ error: "Tahap verifikasi sudah tidak berlaku." });
  }
  const foto = parseImageDataUrl(req.body.image);
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  if (!foto) return res.status(400).json({ error: "Selfie kamera tidak valid." });
  try {
    await validateImagePayload(foto, { decode: false });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return res.status(400).json({ error: "Lokasi GPS tidak valid." });
  }

  session.processing = true;
  try {
    const queued = antreVerifikasiWajah(session.userId, foto.buffer);
    const cocok = await queued.promise;
    if (!cocok) {
      permissionSessions.delete(req.params.token);
      return res.status(400).json({
        error: "Wajah tidak dikenali. Kirim perintah izin lagi untuk mencoba ulang.",
      });
    }
    session.verified = true;
    session.processing = false;
    session.selfie = foto;
    session.lokasi = { latitude, longitude, accuracy };
    session.expiresAt = Date.now() + PERMISSION_SESSION_TTL_MS;
    res.json({ ok: true, expiresAt: session.expiresAt });
  } catch (error) {
    permissionSessions.delete(req.params.token);
    logVerificationFailure("Verifikasi Izin", session.userId, error);
    const failure = faceFailureResponse(
      error,
      "Selfie gagal diverifikasi. Kirim perintah izin lagi."
    );
    res.status(failure.status).json({ error: failure.message });
  }
});

app.post("/api/permission-camera/:token/evidence", async (req, res) => {
  const token = req.params.token;
  const session = getPermissionSession(token);
  if (!session || !session.verified || session.processing) {
    return res.status(410).json({ error: "Sesi unggah bukti sudah tidak berlaku." });
  }
  const bukti = parseImageDataUrl(req.body.image);
  if (!bukti) return res.status(400).json({ error: "Foto bukti tidak valid." });
  try {
    await validateImagePayload(bukti);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  session.processing = true;
  const writtenFiles = [];
  let saved = false;
  try {
    ensureDir(IZIN_BUKTI_DIR);
    const requestId = crypto.randomUUID();
    const buktiPath = `${IZIN_BUKTI_DIR}/${requestId}-bukti.${imageExtension(bukti.mimetype)}`;
    const selfiePath = `${IZIN_BUKTI_DIR}/${requestId}-selfie.${imageExtension(session.selfie.mimetype)}`;
    writePrivateFile(buktiPath, bukti.buffer);
    writtenFiles.push(buktiPath);
    writePrivateFile(selfiePath, session.selfie.buffer);
    writtenFiles.push(selfiePath);

    const jobs = await updateJSONAtomic(
      [IZIN_PATH, KONTAK_PATH],
      async (draft) => {
        if (!draft[KONTAK_PATH][session.userId]) {
          throw new Error("Siswa sudah tidak terdaftar.");
        }
        if (session.tanggal !== getWaktu().tanggal) {
          throw new Error("Tautan sudah melewati tanggal pengajuan.");
        }
        const attendance = await attendanceStatus(session.tanggal, session.userId);
        const permissionError = validatePermission({
          ...attendance,
          izin: Boolean(draft[IZIN_PATH][session.tanggal]?.[session.userId]),
        });
        if (permissionError) throw new Error(permissionError);

        const kontak = draft[KONTAK_PATH];
        const kelasSiswa = findKelasSiswa(loadKelas(), session.userId);
        draft[IZIN_PATH][session.tanggal] ||= {};
        draft[IZIN_PATH][session.tanggal][session.userId] = {
          alasan: session.alasan,
          nama: kontak[session.userId] || session.userId,
          bukti: buktiPath,
          selfie: selfiePath,
          lokasi: session.lokasi,
          terverifikasiWajah: true,
          kelas: kelasSiswa?.namaKelas || "",
          waliKelas: kelasSiswa?.waliKelas || "",
        };
        const caption =
          `📩 *Pengajuan Izin Siswa*\n` +
          `👤 Nama: *${kontak[session.userId] || session.userId}*\n` +
          `🏫 Kelas: ${kelasSiswa?.namaKelas || "-"}\n` +
          `📅 Tanggal: ${session.tanggal}\n` +
          `📌 Alasan: ${session.alasan}\n` +
          `✅ Wajah terverifikasi dan lokasi tercatat`;
        const pending = [
          ...getStudentNotificationRecipients(session.userId, kelasSiswa),
        ].map((id) =>
          imageNotification(session.botKey, id, buktiPath, caption, {
            mimetype: bukti.mimetype,
            filename: "bukti-izin.jpg",
            dedupeKey: `permission:${session.tanggal}:${session.userId}:media:${id}`,
          })
        );
        pending.push(
          textNotification(
            session.botKey,
            session.userId,
            `✅ Izin hari ini berhasil dicatat.\nAlasan: ${session.alasan}`,
            {
              priority: 10,
              dedupeKey: `permission:${session.tanggal}:${session.userId}:confirmation`,
            }
          )
        );
        return pending;
      },
      ({ result, transaction }) => enqueueNotifications(result, { transaction })
    );
    saved = true;
    permissionSessions.delete(token);
    if (jobs.length) notificationOutboxProcessor?.wake();
    res.json({ ok: true, tanggal: session.tanggal });
  } catch (error) {
    if (!saved) {
      for (const file of writtenFiles) {
        try {
          deletePrivateFileSafely(file, IZIN_BUKTI_DIR, `bukti izin ${session.userId}`);
        } catch (cleanupError) {
          console.error("[Bukti Cleanup ERROR]", cleanupError.message);
        }
      }
    }
    permissionSessions.delete(token);
    console.error(`[Bukti Izin ERROR] ${session.userId}:`, error.message);
    res.status(400).json({ error: error.message || "Bukti izin gagal disimpan." });
  }
});

app.get("/api/attendance-camera/:token", (req, res) => {
  const session = getCameraSession(req.params.token);
  if (!session || session.processing) {
    return res.status(410).json({ error: "Tautan absensi sudah tidak berlaku." });
  }

  const kontak = loadJSON(KONTAK_PATH);
  res.json({
    tipe: session.tipe,
    nama: kontak[session.userId] || "Siswa",
    expiresAt: session.expiresAt,
  });
});

app.post("/api/attendance-camera/:token", async (req, res) => {
  const token = req.params.token;
  const session = getCameraSession(token);
  if (!session || session.processing) {
    return res.status(410).json({ error: "Tautan absensi sudah tidak berlaku." });
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  const foto = parseImageDataUrl(req.body.image);
  if (!foto) {
    return res.status(400).json({ error: "Hasil foto kamera tidak valid." });
  }
  try {
    await validateImagePayload(foto, { decode: false });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({ error: "Lokasi GPS tidak valid." });
  }
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 100) {
    return res.status(400).json({
      error: "Akurasi GPS harus 100 meter atau lebih baik. Coba di area terbuka.",
    });
  }

  session.processing = true;
  cameraSessions.delete(token);
  try {
    const queued = antreVerifikasiWajah(session.userId, foto.buffer);
    const cocok = await queued.promise;
    if (!cocok) {
      throw new Error(
        "Wajah tidak dikenali. Kirim perintah absensi lagi untuk mengambil selfie baru."
      );
    }

    const result = await catatAbsensiKamera(
      session.userId,
      session.tipe,
      { latitude, longitude, accuracy },
      foto,
      session.botKey
    );
    res.json({ ok: true, tipe: session.tipe, ...result });
  } catch (error) {
    logVerificationFailure("Kamera Absensi", session.userId, error);
    const failure = faceFailureResponse(
      error,
      error.message || "Absensi gagal diproses."
    );
    res.status(failure.status).json({ error: failure.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const accounts = loadDashboardAccounts();
  const account = accounts[username];
  const passwordValid = await verifyPassword(
    req.body.password,
    account?.passwordHash || DUMMY_PASSWORD_HASH
  );
  const id = account?.userId;
  const role = id ? loadRoles()[id] : null;
  if (!account || !passwordValid || !["admin", "tu", "wali_kelas"].includes(role)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const nama = await resolveDashboardUserName(id, role);
  const nomor = id.replace("@c.us", "");
  webSessions.set(token, {
    id,
    nomor,
    username,
    nama,
    role,
    expiresAt: Date.now() + 8 * 60 * 60_000,
  });
  res.setHeader(
    "Set-Cookie",
    serializeSessionCookie(token, { secure: sessionCookieIsSecure(req) })
  );
  res.json({ ok: true, user: { nomor, username, nama, role } });
});

app.get("/api/auth/me", (req, res) => {
  const user = webUser(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  res.json({
    nomor: user.nomor,
    username: user.username,
    nama: dashboardUserName(user.id, user.role),
    role: user.role,
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).absensi_session;
  if (token) webSessions.delete(token);
  res.setHeader(
    "Set-Cookie",
    serializeSessionCookie("", { secure: sessionCookieIsSecure(req), maxAge: 0 })
  );
  res.json({ ok: true });
});

app.get("/api/brand", (_req, res) => {
  res.json(publicBrandSettings());
});

app.get("/api/brand/logo", (_req, res) => {
  const brand = loadBrandSettings();
  const logoPath = brandLogoPath(brand);
  if (!logoPath || !fs.existsSync(logoPath)) {
    return res.status(404).json({ error: "Logo brand belum tersedia." });
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type(brand.logoMimeType).sendFile(path.resolve(logoPath));
});

app.use("/api", requireWebAuth);

async function dashboardData(user) {
  const kontak = loadJSON(KONTAK_PATH);
  const semuaKelas = loadKelas();
  const kelas =
    user.role === "admin" ? semuaKelas : kelasUntukWali(semuaKelas, user.id);
  const roles = loadRoles();
  const accounts = loadDashboardAccounts();
  const jam = loadJSON(JAM_PATH, {
    masuk: "07:00:00",
    pulang: "14:00:00",
    toleransi: 0,
    mulaiMasuk: "00:00:00",
    selesaiMasuk: "23:59:59",
    mulaiPulang: "00:00:00",
    selesaiPulang: "23:59:59",
  });
  const today = getWaktu().tanggal;
  const absensiHariIni = await attendanceForDate(today);
  const izinHariIni = loadJSONSelected(IZIN_PATH, (permissions) => permissions[today] || {});
  const outbox = await notificationOutboxStats();

  const siswaIds = new Set(
    Object.values(kelas).flatMap((data) => Object.keys(data.siswa || {}))
  );
  const siswa = Object.entries(kontak)
    .filter(([id]) => user.role === "admin" || siswaIds.has(id))
    .map(([id, nama]) => {
    const relasi = findKelasSiswa(kelas, id);
    return {
      id,
      nomor: id.replace("@c.us", ""),
      nama,
      kelas: relasi?.namaKelas || "",
      orangTua: relasi?.siswa[id]?.orangTua?.replace("@c.us", "") || "",
      punyaFoto: fs.existsSync(`${FACE_REC}/${id.replace("@c.us", "")}.jpg`),
      masuk: absensiHariIni[id]?.masuk || null,
      pulang: absensiHariIni[id]?.pulang || null,
      izin: izinHariIni[id] || null,
    };
  });
  const whatsappBots = whatsapp.statuses().filter(
    (bot) => user.role === "admin" || (user.role === "tu" && bot.role === "tu") || bot.expectedNumber === user.nomor
  );

  return {
    tanggal: today,
    botReady: whatsappBots.length > 0 && whatsappBots.every((bot) => bot.ready),
    whatsappBots: whatsappBots.map(({ qr, ...status }) => ({
      ...status,
      hasQr: Boolean(qr),
    })),
    jam,
    siswa,
    kelas: Object.entries(kelas).map(([nama, data]) => ({
      nama,
      waliKelas: data.waliKelas?.replace("@c.us", "") || "",
      namaWali: data.namaWali || "",
      username: dashboardAccountForUser(accounts, data.waliKelas)?.username || "",
      jumlahSiswa: Object.keys(data.siswa || {}).length,
    })),
    admins: user.role === "admin" ? Object.entries(roles)
      .filter(([, role]) => ["admin", "tu", "wali_kelas"].includes(role))
      .map(([id, role]) => ({
        nomor: id.replace("@c.us", ""),
        nama: dashboardUserName(id, role),
        username: dashboardAccountForUser(accounts, id)?.username || "",
        role,
        className: Object.entries(kelas).find(([, data]) => data.waliKelas === id)?.[0] || "",
      })) : [],
    currentUser: {
      nomor: user.nomor,
      username: user.username,
      nama: dashboardUserName(user.id, user.role),
      role: user.role,
    },
    faceService: facePool.status(),
    notificationOutbox: outbox,
  };
}

app.get("/api/dashboard", async (req, res) => {
  res.json(await dashboardData(req.webUser));
});

app.post("/api/admins", requireWebAdmin, async (req, res) => {
  const nomor = normalizeNomor(req.body.nomor);
  const originalNomor = normalizeNomor(req.body.originalNomor);
  const nama = toTitleCase(String(req.body.nama || "").trim());
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const role = req.body.role;
  const className = String(req.body.className || "").trim().toUpperCase();
  const editing = Boolean(originalNomor);
  if (!/^62\d{8,14}$/.test(nomor)) {
    return res.status(400).json({ error: "Nomor WhatsApp pengguna belum valid." });
  }
  if (editing && originalNomor !== nomor) {
    return res.status(400).json({ error: "Nomor pengguna tidak dapat diubah dari form akun." });
  }
  if (nama.length < 3) {
    return res.status(400).json({ error: "Nama pengguna minimal 3 karakter." });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({
      error: "Username harus 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.",
    });
  }
  if (!["admin", "tu", "wali_kelas"].includes(role)) {
    return res.status(400).json({ error: "Role pengguna tidak valid." });
  }

  const id = `${nomor}@c.us`;
  const currentAccount = dashboardAccountForUser(loadDashboardAccounts(), id);
  if (!password && !currentAccount) {
    return res.status(400).json({ error: "Password wajib diisi untuk akun baru." });
  }
  if (password && !isValidPassword(password)) {
    return res.status(400).json({ error: "Password harus 10-128 karakter." });
  }
  const passwordHash = password
    ? await hashPassword(password)
    : currentAccount.passwordHash;
  try {
    await updateJSON([ROLE_PATH, USER_NAMES_PATH, DASHBOARD_ACCOUNTS_PATH, KELAS_PATH, KONTAK_PATH, TEACHERS_PATH], (draft) => {
      const currentRole = draft[ROLE_PATH][id];
      if (!editing && currentRole) {
        const error = new Error("Nomor tersebut sudah terdaftar sebagai pengguna.");
        error.code = "ALREADY_EXISTS";
        throw error;
      }
      if (editing && !["admin", "tu", "wali_kelas"].includes(currentRole)) {
        const error = new Error("Pengguna yang diedit tidak ditemukan.");
        error.code = "NOT_FOUND";
        throw error;
      }
      if (editing && currentRole !== role) {
        const error = new Error("Role pengguna tidak dapat diubah. Buat pengguna baru untuk role lain.");
        error.code = "ROLE_CHANGE";
        throw error;
      }
      if (role === "wali_kelas") {
        const assignedClass = draft[KELAS_PATH][className];
        if (!className || !assignedClass) {
          const error = new Error("Pilih kelas yang akan diampu wali kelas.");
          error.code = "CLASS_REQUIRED";
          throw error;
        }
        if (assignedClass.waliKelas && assignedClass.waliKelas !== id) {
          const error = new Error("Kelas tersebut sudah memiliki wali kelas.");
          error.code = "CLASS_ASSIGNED";
          throw error;
        }
        const teacherConfig = draft[TEACHERS_PATH];
        if (teacherConfig.number === nomor || draft[KONTAK_PATH][id]) {
          const error = new Error("Nomor wali kelas tidak boleh sama dengan nomor Bot Guru atau siswa.");
          error.code = "TEACHER_NUMBER_UNAVAILABLE";
          throw error;
        }
        for (const data of Object.values(draft[KELAS_PATH])) {
          if (data.waliKelas === id) { data.waliKelas = ""; data.namaWali = ""; }
        }
        assignedClass.waliKelas = id;
        assignedClass.namaWali = nama;
        teacherConfig.teachers ||= {};
        teacherConfig.teachers[nomor] = { ...teacherConfig.teachers[nomor], name: nama, active: true };
      }
      draft[ROLE_PATH][id] = role;
      draft[USER_NAMES_PATH][id] = nama;
      setDashboardAccount(draft[DASHBOARD_ACCOUNTS_PATH], {
        username,
        userId: id,
        passwordHash,
      });
    });
  } catch (error) {
    if (error.code === "ALREADY_EXISTS") return res.status(409).json({ error: error.message });
    if (error.code === "USERNAME_EXISTS") return res.status(409).json({ error: error.message });
    if (error.code === "NOT_FOUND") return res.status(404).json({ error: error.message });
    if (["ROLE_CHANGE", "CLASS_REQUIRED", "CLASS_ASSIGNED", "TEACHER_NUMBER_UNAVAILABLE"].includes(error.code)) return res.status(400).json({ error: error.message });
    throw error;
  }
  if (id === req.webUser.id) req.webUser.username = username;
  if (role === "wali_kelas") void whatsapp.sync(loadKelas()).catch((error) => console.error("[Baileys] Gagal menyelaraskan bot wali:", error.message));
  res.status(editing ? 200 : 201).json({ ok: true, nomor, nama, username, role, className });
});

app.delete("/api/admins/:number", requireWebAdmin, async (req, res) => {
  const nomor = normalizeNomor(req.params.number);
  if (!/^62\d{8,14}$/.test(nomor)) {
    return res.status(400).json({ error: "Nomor WhatsApp admin belum valid." });
  }

  const id = `${nomor}@c.us`;
  if (id === req.webUser.id && loadRoles()[id] === "admin") {
    return res.status(400).json({ error: "Anda tidak dapat menghapus akun admin sendiri." });
  }

  let found = false;
  await updateJSON([ROLE_PATH, USER_NAMES_PATH, DASHBOARD_ACCOUNTS_PATH, KELAS_PATH], (draft) => {
    if (["admin", "tu", "wali_kelas"].includes(draft[ROLE_PATH][id])) {
      found = true;
      for (const data of Object.values(draft[KELAS_PATH])) if (data.waliKelas === id) { data.waliKelas = ""; data.namaWali = ""; }
      delete draft[ROLE_PATH][id]; delete draft[USER_NAMES_PATH][id]; removeDashboardAccount(draft[DASHBOARD_ACCOUNTS_PATH], id);
    }
  });
  if (!found) return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  void whatsapp.sync(loadKelas()).catch((error) => console.error("[Baileys] Gagal menyelaraskan bot wali:", error.message));
  res.json({ ok: true, nomor });
});

app.post("/api/classes", requireWebAdmin, async (req, res) => {
  const nama = String(req.body.nama || "").trim().toUpperCase();
  const originalNama = String(req.body.originalNama || "").trim().toUpperCase();
  if (!nama) return res.status(400).json({ error: "Nama kelas belum valid." });
  try {
    await updateJSON([KELAS_PATH, TEACHERS_PATH], (draft) => {
      const kelas = draft[KELAS_PATH];
      const teacherConfig = draft[TEACHERS_PATH];
      if (originalNama) {
        if (!kelas[originalNama]) {
          const error = new Error("Kelas yang diedit tidak ditemukan.");
          error.code = "NOT_FOUND";
          throw error;
        }
        if (originalNama !== nama && kelas[nama]) {
          const error = new Error("Nama kelas baru sudah digunakan.");
          error.code = "ALREADY_EXISTS";
          throw error;
        }
        if (originalNama !== nama) {
          kelas[nama] = kelas[originalNama];
          delete kelas[originalNama];
        }
      } else if (kelas[nama]) {
        const error = new Error("Kelas tersebut sudah tersedia.");
        error.code = "ALREADY_EXISTS";
        throw error;
      }

      kelas[nama] ||= { siswa: {}, waliKelas: "", namaWali: "" };
      const teacherClasses = new Set((teacherConfig.classes || []).map((name) => String(name).trim().toUpperCase()));
      if (originalNama && originalNama !== nama) {
        teacherClasses.delete(originalNama);
        for (const schedule of Object.values(teacherConfig.schedules || {})) {
          if (String(schedule.className).trim().toUpperCase() === originalNama) schedule.className = nama;
        }
      }
      teacherClasses.add(nama);
      teacherConfig.classes = [...teacherClasses].sort((left, right) => left.localeCompare(right, "id", { numeric: true }));
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") return res.status(404).json({ error: error.message });
    if (error.code === "ALREADY_EXISTS") return res.status(409).json({ error: error.message });
    if (error.code === "USERNAME_EXISTS") return res.status(409).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true });
});

app.delete("/api/classes/:name", requireWebAdmin, async (req, res) => {
  const nama = String(req.params.name || "").toUpperCase();
  try {
    await updateJSON([KELAS_PATH, TEACHERS_PATH], (draft) => {
      const kelas = draft[KELAS_PATH];
      const teacherConfig = draft[TEACHERS_PATH];
      if (!kelas[nama]) {
        const error = new Error("Kelas tidak ditemukan.");
        error.code = "NOT_FOUND";
        throw error;
      }
      if (Object.keys(kelas[nama].siswa || {}).length) {
        const error = new Error("Pindahkan siswa sebelum menghapus kelas.");
        error.code = "NOT_EMPTY";
        throw error;
      }
      if (Object.values(teacherConfig.schedules || {}).some((schedule) => String(schedule.className).trim().toUpperCase() === nama)) {
        const error = new Error("Kelas masih digunakan pada jadwal mengajar.");
        error.code = "SCHEDULED";
        throw error;
      }
      delete kelas[nama];
      teacherConfig.classes = (teacherConfig.classes || []).filter((className) => String(className).trim().toUpperCase() !== nama);
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") return res.status(404).json({ error: error.message });
    if (error.code === "NOT_EMPTY") return res.status(400).json({ error: error.message });
    if (error.code === "SCHEDULED") return res.status(400).json({ error: error.message });
    throw error;
  }
  void whatsapp.sync(loadKelas()).catch((error) => {
    console.error("[Baileys] Gagal menyelaraskan bot wali:", error.message);
  });
  res.json({ ok: true });
});

app.post("/api/students", requireWebAdmin, async (req, res) => {
  const nomor = normalizeNomor(req.body.nomor);
  if (teacherAttendance.config().teachers[nomor]) {
    return res.status(400).json({ error: "Nomor sudah terdaftar sebagai guru." });
  }
  const originalNomor = normalizeNomor(req.body.originalNomor);
  const nama = toTitleCase(String(req.body.nama || "").trim());
  const namaKelas = String(req.body.kelas || "").trim().toUpperCase();
  const orangTua = normalizeNomor(req.body.orangTua);
  if (!/^62\d{8,14}$/.test(nomor) || nama.length < 3) {
    return res.status(400).json({ error: "Nomor atau nama siswa belum valid." });
  }
  if (originalNomor && !/^62\d{8,14}$/.test(originalNomor)) {
    return res.status(400).json({ error: "Nomor siswa sebelumnya tidak valid." });
  }

  const siswaId = `${nomor}@c.us`;
  const originalSiswaId = originalNomor ? `${originalNomor}@c.us` : "";
  if (namaKelas && !loadKelas()[namaKelas]) {
    return res.status(400).json({ error: "Kelas belum tersedia." });
  }
  if (namaKelas && !/^62\d{8,14}$/.test(orangTua)) {
    return res.status(400).json({ error: "Nomor orang tua belum valid." });
  }

  try {
    await updateJSONAtomic(
      [KONTAK_PATH, KELAS_PATH, IZIN_PATH],
      (draft) => {
        if (teacherAttendance.config().teachers[nomor]) throw new Error("Nomor sudah terdaftar sebagai guru.");
        const kontak = draft[KONTAK_PATH];
        const kelas = draft[KELAS_PATH];
        if (namaKelas && !kelas[namaKelas]) {
          throw new Error("Kelas tidak lagi tersedia.");
        }
        if (originalSiswaId) {
          if (!kontak[originalSiswaId]) {
            const error = new Error("Siswa yang diedit tidak ditemukan.");
            error.code = "NOT_FOUND";
            throw error;
          }
          if (originalSiswaId !== siswaId && kontak[siswaId]) {
            const error = new Error("Nomor WhatsApp baru sudah digunakan siswa lain.");
            error.code = "ALREADY_EXISTS";
            throw error;
          }
        } else if (kontak[siswaId]) {
          const error = new Error("Nomor WhatsApp tersebut sudah terdaftar.");
          error.code = "ALREADY_EXISTS";
          throw error;
        }

        if (originalSiswaId && originalSiswaId !== siswaId) {
          delete kontak[originalSiswaId];
          for (const records of Object.values(draft[IZIN_PATH])) {
            if (!records?.[originalSiswaId]) continue;
            if (records[siswaId]) {
              const error = new Error("Riwayat izin nomor baru sudah tersedia.");
              error.code = "ALREADY_EXISTS";
              throw error;
            }
            records[siswaId] = records[originalSiswaId];
            delete records[originalSiswaId];
          }
        }

        kontak[siswaId] = nama;
        for (const data of Object.values(kelas)) {
          if (!data.siswa) continue;
          delete data.siswa[siswaId];
          if (originalSiswaId) delete data.siswa[originalSiswaId];
        }
        if (namaKelas) {
          kelas[namaKelas].siswa ||= {};
          kelas[namaKelas].siswa[siswaId] = {
            nama,
            orangTua: `${orangTua}@c.us`,
          };
        }
      },
      async ({ transaction }) => {
        if (originalSiswaId && originalSiswaId !== siswaId) {
          await renameAttendanceStudent(originalSiswaId, siswaId, { transaction });
          await renamePendingNotificationRecipient(originalSiswaId, siswaId, {
            transaction,
          });
        }
      }
    );
  } catch (error) {
    if (error.code === "NOT_FOUND") return res.status(404).json({ error: error.message });
    if (error.code === "ALREADY_EXISTS") return res.status(409).json({ error: error.message });
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Riwayat nomor baru sudah tersedia." });
    }
    throw error;
  }

  if (originalNomor && originalNomor !== nomor) {
    for (const root of [FACE_DB, FACE_REC]) {
      moveManagedFile(
        path.join(root, `${originalNomor}.jpg`),
        path.join(root, `${nomor}.jpg`),
        root
      );
    }
  }
  void whatsapp.sync(loadKelas()).catch((error) => {
    console.error("[Baileys] Gagal memperbarui daftar siswa bot wali:", error.message);
  });
  res.json({ ok: true });
});

app.delete("/api/students/:number", requireWebAdmin, async (req, res) => {
  const nomor = normalizeNomor(req.params.number);
  const siswaId = `${nomor}@c.us`;
  let foundStudent = false;
  await updateJSONAtomic([KONTAK_PATH, KELAS_PATH, IZIN_PATH], (draft) => {
    const kontak = draft[KONTAK_PATH];
    if (!kontak[siswaId]) return;
    foundStudent = true;
    const studentName = kontak[siswaId];
    const classSnapshot = findKelasSiswa(draft[KELAS_PATH], siswaId);
    for (const records of Object.values(draft[IZIN_PATH])) {
      const permission = records?.[siswaId];
      if (!permission) continue;
      permission.nama ||= studentName;
      permission.kelas ||= classSnapshot?.namaKelas || "";
      permission.waliKelas ||= classSnapshot?.waliKelas || "";
    }
    delete kontak[siswaId];
    for (const data of Object.values(draft[KELAS_PATH])) {
      if (data.siswa) delete data.siswa[siswaId];
    }
    return {
      nama: studentName,
      kelas: classSnapshot?.namaKelas || "",
      waliKelas: classSnapshot?.waliKelas || "",
    };
  }, async ({ result, transaction }) => {
    if (result) await fillAttendanceSnapshot(siswaId, result, { transaction });
  });
  if (!foundStudent) return res.status(404).json({ error: "Siswa tidak ditemukan." });
  for (const root of [FACE_DB, FACE_REC]) {
    deletePrivateFileSafely(path.join(root, `${nomor}.jpg`), root, `foto siswa ${nomor}`);
  }
  for (const [token, session] of [...cameraSessions, ...permissionSessions]) {
    if (session.userId === siswaId) {
      cameraSessions.delete(token);
      permissionSessions.delete(token);
    }
  }
  void whatsapp.sync(loadKelas()).catch((error) => {
    console.error("[Baileys] Gagal memperbarui daftar siswa bot wali:", error.message);
  });
  res.json({ ok: true });
});

app.post(
  "/api/students/:number/photo",
  requireWebPhotoManager,
  upload.single("photo"),
  async (req, res) => {
    const nomor = normalizeNomor(req.params.number);
    const siswaId = `${nomor}@c.us`;
    if (!loadJSON(KONTAK_PATH)[siswaId]) {
      return res.status(404).json({ error: "Siswa tidak ditemukan." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Pilih file foto yang valid." });
    }
    try {
      await validateImageBuffer(req.file.buffer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    writePrivateFile(path.join(FACE_REC, `${nomor}.jpg`), req.file.buffer);
    deletePrivateFileSafely(
      path.join(FACE_DB, `${nomor}.jpg`),
      FACE_DB,
      `foto duplikat ${nomor}`
    );
    res.json({ ok: true });
  }
);

app.post(
  "/api/settings/brand",
  requireWebAdmin,
  upload.single("logo"),
  async (req, res) => {
    const name = normalizeBrandName(req.body.name);
    if (!name) {
      return res.status(400).json({
        error: "Nama aplikasi harus terdiri dari 2-60 karakter.",
      });
    }

    const current = loadBrandSettings();
    const next = { ...current, name };
    let newLogoPath = "";
    if (req.file) {
      if (req.file.size > 2 * 1024 * 1024) {
        return res.status(413).json({ error: "Ukuran logo maksimal 2 MB." });
      }
      let metadata;
      try {
        metadata = await validateImageBuffer(req.file.buffer);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const digest = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex")
        .slice(0, 16);
      next.logoFile = `logo-${digest}.${imageExtension(metadata.mimetype)}`;
      next.logoMimeType = metadata.mimetype;
      newLogoPath = brandLogoPath(next);
      writePrivateFile(newLogoPath, req.file.buffer);
    }

    try {
      await saveJSON(BRAND_PATH, next);
    } catch (error) {
      if (newLogoPath && newLogoPath !== brandLogoPath(current)) {
        deletePrivateFileSafely(newLogoPath, BRAND_LOGO_DIR, "logo brand baru");
      }
      throw error;
    }

    const previousLogoPath = brandLogoPath(current);
    if (previousLogoPath && previousLogoPath !== newLogoPath && req.file) {
      deletePrivateFileSafely(previousLogoPath, BRAND_LOGO_DIR, "logo brand lama");
    }
    res.json({ ok: true, brand: publicBrandSettings() });
  }
);

app.delete("/api/settings/brand/logo", requireWebAdmin, async (_req, res) => {
  const current = loadBrandSettings();
  await saveJSON(BRAND_PATH, {
    ...current,
    logoFile: "",
    logoMimeType: "",
  });
  const logoPath = brandLogoPath(current);
  if (logoPath) {
    deletePrivateFileSafely(logoPath, BRAND_LOGO_DIR, "logo brand");
  }
  res.json({ ok: true, brand: publicBrandSettings() });
});

app.post("/api/settings/time", requireWebAdmin, async (req, res) => {
  const masuk = String(req.body.masuk || "");
  const pulang = String(req.body.pulang || "");
  const toleransi = Number(req.body.toleransi);
  const mulaiMasuk = String(req.body.mulaiMasuk || "");
  const selesaiMasuk = String(req.body.selesaiMasuk || "");
  const mulaiPulang = String(req.body.mulaiPulang || "");
  const selesaiPulang = String(req.body.selesaiPulang || "");
  if (
    !isValidTime(masuk) ||
    !isValidTime(pulang) ||
    !Number.isInteger(toleransi) ||
    toleransi < 0 ||
    toleransi > 180 ||
    !isValidTime(mulaiMasuk) ||
    !isValidTime(selesaiMasuk) ||
    !isValidTime(mulaiPulang) ||
    !isValidTime(selesaiPulang) ||
    mulaiMasuk >= selesaiMasuk ||
    mulaiPulang >= selesaiPulang
  ) {
    return res.status(400).json({
      error: "Jam harus berformat HH:MM, jam selesai harus setelah jam mulai, dan toleransi harus 0-180 menit.",
    });
  }
  await saveJSON(JAM_PATH, {
    masuk: `${masuk}:00`,
    pulang: `${pulang}:00`,
    toleransi,
    mulaiMasuk: `${mulaiMasuk}:00`,
    selesaiMasuk: `${selesaiMasuk}:00`,
    mulaiPulang: `${mulaiPulang}:00`,
    selesaiPulang: `${selesaiPulang}:00`,
  });
  res.json({ ok: true });
});

app.post("/api/permissions", requireWebAdmin, async (req, res) => {
  const nomor = normalizeNomor(req.body.nomor);
  const tanggal = String(req.body.tanggal || "");
  const alasan = String(req.body.alasan || "").trim();
  const siswaId = `${nomor}@c.us`;
  if (!loadJSON(KONTAK_PATH)[siswaId] || !isValidDate(tanggal) || alasan.length < 3) {
    return res.status(400).json({ error: "Data izin belum lengkap atau tidak valid." });
  }
  try {
    const jobs = await updateJSONAtomic(
      [IZIN_PATH, KONTAK_PATH, KELAS_PATH],
      async (draft) => {
        const kontak = draft[KONTAK_PATH];
        const kelasSiswa = findKelasSiswa(draft[KELAS_PATH], siswaId);
        if (!kontak[siswaId]) throw new Error("Siswa sudah tidak terdaftar.");
        const attendance = await attendanceStatus(tanggal, siswaId);
        const permissionError = validatePermission({
          ...attendance,
          izin: Boolean(draft[IZIN_PATH][tanggal]?.[siswaId]),
        });
        if (permissionError) {
          const error = new Error(permissionError);
          error.code = "ATTENDANCE_CONFLICT";
          throw error;
        }
        const izin = draft[IZIN_PATH];
        izin[tanggal] ||= {};
        izin[tanggal][siswaId] = {
          nama: kontak[siswaId],
          alasan,
          kelas: kelasSiswa?.namaKelas || "",
          waliKelas: kelasSiswa?.waliKelas || "",
        };
        if (!kelasSiswa) return [];
        const pesan =
          `📩 *Izin Siswa*\n` +
          `👤 Nama: *${kontak[siswaId]}*\n` +
          `🏫 Kelas: ${kelasSiswa.namaKelas}\n` +
          `📅 Tanggal: ${tanggal}\n` +
          `📌 Alasan: ${alasan}`;
        const botKey = `wali:${normalizeNomor(kelasSiswa.waliKelas)}`;
        return [kelasSiswa.siswa[siswaId].orangTua, kelasSiswa.waliKelas]
          .filter(Boolean)
          .map((id) => textNotification(botKey, id, pesan, {
            dedupeKey: `permission-admin:${tanggal}:${siswaId}:${id}`,
          }));
      },
      ({ result, transaction }) => enqueueNotifications(result, { transaction })
    );
    if (jobs.length) notificationOutboxProcessor?.wake();
  } catch (error) {
    if (error.code === "ATTENDANCE_CONFLICT") {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  }

  res.json({ ok: true });
});

app.delete("/api/permissions/:date/:number", requireWebAdmin, async (req, res) => {
  if (!isValidDate(req.params.date)) {
    return res.status(400).json({ error: "Tanggal izin tidak valid." });
  }
  const siswaId = `${normalizeNomor(req.params.number)}@c.us`;
  const filesToDelete = [];
  let found = false;
  await updateJSONAtomic(IZIN_PATH, (draft) => {
    const izin = draft[IZIN_PATH];
    const record = izin[req.params.date]?.[siswaId];
    if (!record) return;
    found = true;
    if (record.bukti) filesToDelete.push(record.bukti);
    if (record.selfie) filesToDelete.push(record.selfie);
    delete izin[req.params.date][siswaId];
    if (!Object.keys(izin[req.params.date]).length) delete izin[req.params.date];
  }, ({ transaction }) => cancelNotificationsForMediaPaths(filesToDelete, { transaction }));
  if (!found) return res.status(404).json({ error: "Izin tidak ditemukan." });
  for (const file of filesToDelete) {
    deletePrivateFileSafely(file, IZIN_BUKTI_DIR, `bukti izin ${siswaId}`);
  }
  res.json({ ok: true });
});

app.get("/api/permissions/:date/:number/evidence", (req, res) => {
  const siswaId = `${normalizeNomor(req.params.number)}@c.us`;
  const permission = loadIzin()[req.params.date]?.[siswaId];
  if (
    req.webUser.role === "wali_kelas" &&
    permission?.waliKelas !== req.webUser.id &&
    !findKelasSiswa(kelasUntukWali(loadKelas(), req.webUser.id), siswaId)
  ) {
    return res.status(403).json({ error: "Siswa bukan anggota kelas kamu." });
  }
  const bukti = permission?.bukti;
  if (!isManagedPath(bukti, IZIN_BUKTI_DIR) || !fs.existsSync(bukti)) {
    return res.status(404).json({ error: "Foto bukti tidak ditemukan." });
  }
  res.sendFile(path.resolve(bukti));
});

async function buildReportRows(user, tanggal) {
  const kontak = loadJSON(KONTAK_PATH);
  const storage = await attendanceForDate(tanggal);
  const izin = loadJSONSelected(IZIN_PATH, (records) => records[tanggal] || {});
  const kelas = loadKelas();
  const kelasWali = kelasUntukWali(kelas, user.id);
  const studentIds = new Set([
    ...Object.keys(kontak),
    ...Object.keys(storage),
    ...Object.keys(izin),
  ]);
  return [...studentIds]
    .filter((id) => {
      if (user.role === "admin") return true;
      if (findKelasSiswa(kelasWali, id)) return true;
      const snapshot = storage[id]?.masuk || storage[id]?.pulang || izin[id];
      return snapshot?.waliKelas === user.id;
    })
    .map((id) => {
      const attendance = storage[id] || {};
      const permission = izin[id];
      const snapshot = attendance.masuk || attendance.pulang || permission || {};
      return {
        nomor: id.replace("@c.us", ""),
        nama: kontak[id] || snapshot.nama || "Siswa tidak aktif",
        kelas: findKelasSiswa(kelas, id)?.namaKelas || snapshot.kelas || "-",
        masuk: attendance.masuk?.waktu || "-",
        statusMasuk: attendance.masuk?.status || "-",
        pulang: attendance.pulang?.waktu || "-",
        statusPulang: attendance.pulang?.status || "-",
        izin: permission?.alasan || "",
        buktiIzin: Boolean(permission?.bukti),
        aktif: Boolean(kontak[id]),
      };
    });
}

function exportDateRange(query, fallbackDate) {
  const startDate = query.startDate || query.date || fallbackDate;
  const endDate = query.endDate || query.date || startDate;
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw Object.assign(new Error("Tanggal awal atau akhir tidak valid."), { status: 400 });
  }
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days < 1) {
    throw Object.assign(new Error("Tanggal akhir tidak boleh sebelum tanggal awal."), { status: 400 });
  }
  if (days > 366) {
    throw Object.assign(new Error("Rentang export maksimal 366 hari."), { status: 400 });
  }
  return {
    startDate,
    endDate,
    dates: Array.from({ length: days }, (_value, index) =>
      new Date(start + index * 86400000).toISOString().slice(0, 10)
    ),
  };
}

app.get("/api/report", async (req, res) => {
  const tanggal = isValidDate(req.query.date) ? req.query.date : getWaktu().tanggal;
  const rows = await buildReportRows(req.webUser, tanggal);
  res.json({ tanggal, rows });
});

app.get("/api/export", async (req, res) => {
  try {
    if (!["admin", "wali_kelas"].includes(req.webUser.role)) {
      return res.status(403).json({ error: "Export absensi siswa hanya tersedia untuk admin atau wali kelas." });
    }
    const range = exportDateRange(req.query, getWaktu().tanggal);
    const rows = [];
    for (const tanggal of range.dates) {
      const dailyRows = await buildReportRows(req.webUser, tanggal);
      rows.push(...dailyRows.map((row) => ({
        Tanggal: tanggal,
        Nama: row.nama,
        Kelas: row.kelas === "-" ? "" : row.kelas,
        Masuk: row.masuk === "-" ? (row.izin ? "IZIN" : "") : row.masuk,
        StatusMasuk: row.statusMasuk === "-" ? row.izin : row.statusMasuk,
        Pulang: row.pulang === "-" ? "" : row.pulang,
        StatusPulang: row.statusPulang === "-" ? "" : row.statusPulang,
      })));
    }
    const buffer = await exportExcel(rows);
    const label = range.startDate === range.endDate
      ? range.startDate
      : `${range.startDate}-sampai-${range.endDate}`;
    res.attachment(`Rekap-${label}.xlsx`);
    res.send(buffer);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Export laporan gagal." });
  }
});

app.get("/api/whatsapp/:key/qr.svg", requireWhatsappBotAccess, (req, res) => {
  if (!req.whatsappBot.qr) {
    return res.status(404).json({ error: "QR bot belum tersedia." });
  }
  res.type("image/svg+xml").send(qrToSvg(req.whatsappBot.qr));
});

app.post("/api/whatsapp/:key/reset", requireWhatsappBotAccess, async (req, res) => {
  try {
    await whatsapp.reset(req.params.key);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: `Sesi tidak dapat diatur ulang: ${String(error.message || error)}`,
    });
  }
});

app.get("/qr", (_req, res) => res.redirect("/#whatsapp"));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: "Unggahan tidak valid atau terlalu besar." });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Ukuran permintaan terlalu besar." });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: "Format JSON tidak valid." });
  }
  console.error(`[HTTP ERROR] ${req.method} ${req.path}:`, error);
  return res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

let httpServer = null;

function startHttpServer() {
  httpServer = app.listen(PORT, () => {
    console.log(`🌐 Dashboard: ${publicBaseUrl()}`);
    if (!process.env.PUBLIC_BASE_URL) {
      console.warn(
        "⚠️ PUBLIC_BASE_URL belum diatur. Tautan kamera hanya akan memakai localhost dan tidak dapat dibuka dari ponsel lain."
      );
    } else if (!publicBaseUrl().startsWith("https://")) {
      console.warn(
        "⚠️ PUBLIC_BASE_URL sebaiknya memakai HTTPS agar kamera dan GPS diizinkan browser ponsel."
      );
    }
  });
}

async function startBot() {
  try {
    jsonState.replace(await initJsonStore(JSON_STORES));
    console.log(`Database Sequelize siap: ${DB_PATH}`);
    const syncedWaliTeachers = await syncWaliKelasToTeachers();
    if (syncedWaliTeachers) console.log(`[Sinkronisasi Guru] ${syncedWaliTeachers} wali kelas ditambahkan atau diperbarui.`);
    await syncClassCatalogs();
    if (!Object.keys(loadDashboardAccounts()).length) {
      console.warn(
        "⚠️ Belum ada akun dashboard. Atur INITIAL_ADMIN_USERNAME dan INITIAL_ADMIN_PASSWORD, lalu gunakan database baru atau buat akun melalui data akun."
      );
    }
    hardenSensitiveStorage();
    cleanupOrphanedFaceFiles();
    const migratedPhotos = await migrateEmbeddedAttendancePhotos();
    const legacyAttendance = loadJSON(STORAGE_PATH);
    let legacyAttendanceRecords = 0;
    for (const students of Object.values(legacyAttendance)) {
      for (const attendance of Object.values(students || {})) {
        for (const tipe of ["masuk", "pulang"]) {
          if (attendance?.[tipe]) legacyAttendanceRecords += 1;
        }
      }
    }
    const migratedAttendance = await migrateLegacyAttendance(legacyAttendance);
    if (migratedAttendance !== legacyAttendanceRecords) {
      throw new Error(
        `Migrasi absensi tidak lengkap: ${migratedAttendance}/${legacyAttendanceRecords} catatan.`
      );
    }
    if (Object.keys(legacyAttendance).length) await saveJSON(STORAGE_PATH, {});
    if (migratedAttendance) {
      console.log(
        `[Migrasi Absensi] ${migratedAttendance} catatan dipindahkan ke tabel terstruktur.`
      );
    }
    if (migratedPhotos || migratedAttendance) await compactDatabase();
  } catch (error) {
    console.error("Gagal inisialisasi database:", error);
    await shutdown("DATABASE_INIT_FAILED", 1);
    return;
  }
  startHttpServer();
  try {
    await whatsapp.start(loadKelas());
    await notificationOutboxProcessor.start();
  } catch (error) {
    console.error("Gagal inisialisasi WhatsApp:", error);
    await shutdown("WA_INIT_FAILED", 1);
  }
}

let isShuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Menutup aplikasi (${signal})...`);
  try {
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
    await notificationOutboxProcessor?.stop();
    await facePool.close();
    await whatsapp.close();
  } catch (error) {
    console.error("Gagal menutup layanan:", error);
  } finally {
    clearInterval(runtimeStateCleanup);
    try {
      await closeDatabase();
    } catch (error) {
      console.error("Gagal menutup database:", error);
    }
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

startBot();
