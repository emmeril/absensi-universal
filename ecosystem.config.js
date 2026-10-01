const path = require("node:path");
const runtimeDir = __dirname;

module.exports = {
  apps: [
    {
      name: "absensi-universal",
      script: path.resolve(__dirname, "index.js"),
      cwd: runtimeDir,
      instances: 1,
      exec_mode: "fork",
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      restart_delay: 3000,
      // Chromium plus face verification uses native memory outside V8's heap.
      // Keep a safety restart threshold without restarting during normal load.
      max_memory_restart: "1536M",
      node_args: "--max-old-space-size=768",
      env: {
        TZ: "Asia/Jakarta",
        NODE_ENV: "production",
        PORT: "3201",
        PUBLIC_BASE_URL:
          process.env.UNIVERSAL_PUBLIC_BASE_URL || "https://hadir.moboakses.online",
        SESSION_COOKIE_SECURE: "true",
        TRUST_PROXY_HOPS: "1",
        DB_PATH: path.join(runtimeDir, "data", "absensi.sqlite"),
        FACE_WORKER_COUNT: "1",
        FACE_MODEL_PATH: path.join(runtimeDir, "models"),
        FACE_QUEUE_LIMIT: "100",
        FACE_ESTIMATED_JOB_MS: "2500",
        FACE_TIMEOUT_MS: "60000",
        FACE_SLOW_LOG_MS: "10000",
        FACE_REFERENCE_CACHE_LIMIT: "500",
        FACE_TINY_INPUT_SIZE: "320",
        FACE_TINY_SCORE_THRESHOLD: "0.45",
        NOTIFICATION_OUTBOX_CONCURRENCY: "4",
        NOTIFICATION_OUTBOX_POLL_MS: "2000",
        NOTIFICATION_RETRY_BASE_DELAY_MS: "15000",
        NOTIFICATION_RETRY_MAX_DELAY_MS: "900000",
        NOTIFICATION_MAX_ATTEMPTS: "12",
        NOTIFICATION_SENT_RETENTION_MS: "604800000",
        WA_SEND_SAFETY_MODE: "automatic",
        WA_SEND_MAX_RETRIES: "3",
        WA_SEND_RETRY_BASE_DELAY_MS: "5000",
        WA_SEND_RETRY_MAX_DELAY_MS: "60000",
        WA_SEND_RETRY_JITTER_RATIO: "0.35",
        BAILEYS_AUTH_DATA_PATH: path.join(runtimeDir, ".baileys_auth"),
        WA_LOG_LEVEL: "silent",
      },
    },
  ],
};
