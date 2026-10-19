const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { createBackup } = require("../lib/backup");

function createDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath);
    database.exec("CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('aman')", (error) => {
      database.close((closeError) => error || closeError ? reject(error || closeError) : resolve());
    });
  });
}

test("backup creates a restorable private snapshot", async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "absensi-backup-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const databasePath = path.join(temporaryRoot, "source.sqlite");
  const photos = path.join(temporaryRoot, "photos");
  fs.mkdirSync(photos);
  fs.writeFileSync(path.join(photos, "member.jpg"), "image");
  await createDatabase(databasePath);

  const backupPath = await createBackup({
    databasePath,
    sourceDirectories: [photos],
    backupRoot: path.join(temporaryRoot, "backups"),
    now: new Date("2026-10-19T02:30:00.000Z"),
  });

  assert.equal(fs.readFileSync(path.join(backupPath, "photos", "member.jpg"), "utf8"), "image");
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(backupPath, "absensi.sqlite")).mode & 0o777, 0o600);
  const restored = new sqlite3.Database(path.join(backupPath, "absensi.sqlite"), sqlite3.OPEN_READONLY);
  const row = await new Promise((resolve, reject) => {
    restored.get("SELECT value FROM records", (error, value) => error ? reject(error) : resolve(value));
  });
  await new Promise((resolve, reject) => restored.close((error) => error ? reject(error) : resolve()));
  assert.equal(row.value, "aman");
});
