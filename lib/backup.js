const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3");

function privateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  fs.chmodSync(dirPath, 0o700);
}

function hardenTree(rootPath) {
  if (!fs.existsSync(rootPath)) return;
  const stat = fs.lstatSync(rootPath);
  if (stat.isDirectory()) {
    fs.chmodSync(rootPath, 0o700);
    for (const name of fs.readdirSync(rootPath)) hardenTree(path.join(rootPath, name));
  } else if (stat.isFile()) {
    fs.chmodSync(rootPath, 0o600);
  }
}

function backupSqlite(sourcePath, destinationPath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) return reject(openError);
      const backup = database.backup(destinationPath);
      backup.step(-1, (stepError) => {
        backup.finish((finishError) => close(stepError || finishError));
      });

      function close(error) {
        database.close((closeError) => {
          if (error || closeError) reject(error || closeError);
          else resolve();
        });
      }
    });
  });
}

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function removeExpiredBackups(backupRoot, cutoff) {
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".pending-")) continue;
    const entryPath = path.join(backupRoot, entry.name);
    if (fs.statSync(entryPath).mtimeMs < cutoff) fs.rmSync(entryPath, { recursive: true });
  }
}

async function createBackup({
  databasePath,
  sourceDirectories = [],
  backupRoot,
  retentionDays = 14,
  now = new Date(),
}) {
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw new Error("Database sumber backup tidak ditemukan.");
  }
  privateDirectory(backupRoot);

  const name = timestamp(now);
  const pendingPath = path.join(backupRoot, `.pending-${name}-${process.pid}`);
  const finalPath = path.join(backupRoot, name);
  if (fs.existsSync(finalPath)) throw new Error(`Backup ${name} sudah ada.`);
  privateDirectory(pendingPath);

  try {
    await backupSqlite(databasePath, path.join(pendingPath, "absensi.sqlite"));
    for (const sourcePath of sourceDirectories) {
      if (!fs.existsSync(sourcePath)) continue;
      const destination = path.join(pendingPath, path.basename(sourcePath));
      fs.cpSync(sourcePath, destination, { recursive: true, errorOnExist: true });
    }
    fs.writeFileSync(
      path.join(pendingPath, "manifest.json"),
      `${JSON.stringify({ createdAt: now.toISOString(), database: path.resolve(databasePath) }, null, 2)}\n`,
      { mode: 0o600 }
    );
    hardenTree(pendingPath);
    fs.renameSync(pendingPath, finalPath);
  } catch (error) {
    fs.rmSync(pendingPath, { recursive: true, force: true });
    throw error;
  }

  const days = Math.max(1, Number(retentionDays) || 14);
  removeExpiredBackups(backupRoot, now.getTime() - days * 24 * 60 * 60 * 1000);
  return finalPath;
}

module.exports = { backupSqlite, createBackup };
