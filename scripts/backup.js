require("dotenv").config({ quiet: true });

const path = require("node:path");
const { createBackup } = require("../lib/backup");

const root = path.resolve(__dirname, "..");
const databasePath = path.resolve(process.env.DB_PATH || path.join(root, "data", "absensi.sqlite"));
const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(root, "data", "backups"));
const sourceDirectories = [
  ".baileys_auth",
  "face_db",
  "face_rec",
  "izin_bukti",
  "attendance_photos",
  "brand",
].map((name) => path.join(root, name));

createBackup({
  databasePath,
  sourceDirectories,
  backupRoot,
  retentionDays: process.env.BACKUP_RETENTION_DAYS,
})
  .then((backupPath) => console.log(`Backup selesai: ${backupPath}`))
  .catch((error) => {
    console.error(`Backup gagal: ${error.message}`);
    process.exitCode = 1;
  });
