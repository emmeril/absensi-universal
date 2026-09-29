const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const moment = require("moment");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");
const { JsonState } = require("../lib/json-state");
const { writePrivateFile } = require("../lib/private-files");
const { sessionDefinitions } = require("../lib/baileys-manager");
const { TEACHERS_PATH, TEACHER_RECORDS_PATH, EMPTY_TEACHERS, createTeacherAttendance, scheduledSessions, windowFor, validateSchedule } = require("../lib/teacher-attendance");
const num = "6281234567890", tu = "6289876543210";
const id = "10000000-0000-4000-8000-000000000001";
const date = "2026-09-14";
const baseSchedule = { id, number: num, day: 1, start: "07:00", end: "08:20", subject: "Matematika", className: "VII A", tolerance: 5, from: "2026-09-01", until: "" };
function configuration() { return { ...structuredClone(EMPTY_TEACHERS), number: tu, teachers: { [num]: { name: "Bu Ani", active: true } }, schedules: { [id]: structuredClone(baseSchedule) } }; }
test("TU is a distinct session and maps all teachers without changing wali sessions", () => {
  const classes = { "VII A": { waliKelas: `${num}@c.us`, siswa: {} } };
  const defs = sessionDefinitions(classes, { number: tu, teacherNumbers: [num] });
  assert.equal(defs.size, 2); assert.equal(defs.get(`tu:${tu}`).role, "tu");
  assert.deepEqual(defs.get(`tu:${tu}`).studentNumbers, [num]);
  assert.throws(() => sessionDefinitions(classes, { number: num }), /berbeda/);
});
test("schedules honor weekdays, effective dates, holidays, and inactive teachers", () => {
  const c = configuration(); assert.equal(scheduledSessions(c, date, num).length, 1);
  assert.equal(scheduledSessions(c, "2026-09-15", num).length, 0);
  assert.equal(scheduledSessions(c, "2026-08-31", num).length, 0);
  assert.equal(scheduledSessions(c, "2026-02-30", num).length, 0);
  c.holidays = [date]; assert.equal(scheduledSessions(c, date, num).length, 0);
  c.holidays = []; c.teachers[num].active = false; assert.equal(scheduledSessions(c, date, num).length, 0);
});
test("schedule validation rejects conflicts, malformed times and permits consecutive sessions", () => {
  const c = configuration(); const other = { ...baseSchedule, id: undefined };
  assert.throws(() => validateSchedule(other, c), /bertabrakan/);
  assert.equal(validateSchedule({ ...other, start: "08:20", end: "09:00" }, c).start, "08:20");
  assert.throws(() => validateSchedule({ ...other, start: "25:00" }, c), /tidak valid/);
  assert.throws(() => validateSchedule({ ...other, id: "__proto__" }, c), /tidak valid/);
  assert.equal(windowFor(baseSchedule, date).start - windowFor(baseSchedule, date).open, 15 * 60000);
});
async function fixture(t) {
  let now = moment(`${date} 07:07`, "YYYY-MM-DD HH:mm").valueOf();
  t.mock.method(Date, "now", () => now);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "teacher-attendance-test-"));
  const state = new JsonState({ initial: { [TEACHERS_PATH]: configuration(), [TEACHER_RECORDS_PATH]: { records: {}, tokens: {} }, "./lokasi.json": { latitude: -6.7, longitude: 108.5 } }, writeBatch: async () => {} });
  let match = true, failCommit = false, verificationCount = 0;
  const notifications = [];
  const classSync = [];
  const deps = {
    loadJSON: (key, fallback) => state.read(key, fallback),
    updateJSON: (key, fn) => state.update(key, fn),
    parseImageDataUrl: (value) => value === "photo" ? { buffer: Buffer.from("photo-data"), mimetype: "image/jpeg" } : null,
    validateImagePayload: async () => {}, validateImageBuffer: async () => {},
    verifyFace: async () => { verificationCount++; return match; }, writePrivateFile,
    photoRoot: temp,
    requireWebAuth: (req, res, next) => { if (!req.headers["x-role"]) return res.sendStatus(401); req.webUser = { role: req.headers["x-role"], id: "admin" }; next(); },
    requireWebAdmin: (req, res, next) => req.webUser.role === "admin" ? next() : res.sendStatus(403),
    requireWebTeacherManager: (req, res, next) => ["admin", "tu"].includes(req.webUser.role) ? next() : res.sendStatus(403),
    upload: { single: () => (_req, _res, next) => next() },
    publicBaseUrl: () => "https://school.example", getClasses: () => ({}), getStudents: () => ({}), syncBots: async () => {},
    syncStudentClassCatalog: async (change) => classSync.push(change),
    notifyTeacherAttendance: async (record) => notifications.push(record),
  };
  state.writeBatch = async () => { if (failCommit) throw new Error("database unavailable"); };
  let service = createTeacherAttendance(deps);
  const app = express(); app.use(express.json());
  service.registerCamera(app, (_req, _res, next) => next()); service.registerAdmin(app);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, role, method = body ? "POST" : "GET") => {
    const response = await fetch(base + url, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(role ? { "x-role": role } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; } return { status: response.status, data };
  };
  async function command(body = "!masuk", sender = `${num}@c.us`, botKey = `tu:${tu}`) { let reply; const handled = await service.command({ body, sender, botKey, reply: async (text) => { reply = text; } }); return { reply, handled, token: reply?.match(/#([a-f0-9]{64})/)?.[1] }; }
  return { state, command, request, temp, deps, service, notifications, classSync, setNow: (time) => { now = moment(`${date} ${time}`, "YYYY-MM-DD HH:mm").valueOf(); }, setMatch: (value) => { match = value; }, setFail: (value) => { failCommit = value; }, count: () => verificationCount };
}
const photo = { image: "photo", latitude: -6.7, longitude: 108.5, accuracy: 10 };
test("one link persists arrival separately and resumes evidence after service recreation", async (t) => {
  const f = await fixture(t); const { token } = await f.command(); assert.ok(token);
  const url = `/api/teacher-camera/${token}`;
  assert.equal((await f.request(`${url}/evidence`, { ...photo, material: "Aljabar" })).status, 400);
  const arrival = await f.request(`${url}/arrival`, photo);
  assert.equal(arrival.status, 200); assert.equal(arrival.data.record.lateMinutes, 7);
  assert.equal(f.notifications.length, 1);
  assert.equal(arrival.data.record.hasEvidence, false); assert.equal(arrival.data.record.selfie, undefined);
  await f.request(`${url}/arrival`, photo); assert.equal(f.count(), 1);
  const restarted = createTeacherAttendance(f.deps); assert.equal(restarted.report(date)[0].hasSelfie, true);
  assert.ok((await f.request(url)).data.record.arrival);
  const evidence = await f.request(`${url}/evidence`, { ...photo, material: "Persamaan linear" });
  assert.equal(evidence.status, 200); assert.equal(evidence.data.record.review, "Belum ditinjau");
  assert.equal(evidence.data.record.hasEvidence, true); assert.equal(f.count(), 1);
  await f.request(`${url}/evidence`, { ...photo, material: "Penggantian tidak sah" });
  assert.equal((await f.request(url)).data.record.material, "Persamaan linear");
  assert.equal(fs.readdirSync(f.temp).length, 2);
  assert.match((await f.command()).reply, /sudah lengkap/);
});
test("face mismatch, off-campus GPS, malformed images and tokens never create arrival", async (t) => {
  const f = await fixture(t); const { token } = await f.command(); const url = `/api/teacher-camera/${token}`;
  f.setMatch(false); assert.equal((await f.request(`${url}/arrival`, photo)).status, 400);
  f.setMatch(true);
  for (const payload of [{ ...photo, latitude: 0 }, { ...photo, accuracy: 101 }, { ...photo, latitude: null }, { ...photo, image: "invalid" }]) assert.equal((await f.request(`${url}/arrival`, payload)).status, 400);
  assert.equal((await f.request("/api/teacher-camera/invalid")).status, 410);
  assert.equal(f.service.report(date)[0].arrival, undefined); assert.equal(fs.readdirSync(f.temp).length, 0);
});
test("schedule opens fifteen minutes early; evidence waits until teaching starts; expiry blocks both", async (t) => {
  const f = await fixture(t); f.setNow("06:44"); assert.equal((await f.command()).token, undefined);
  f.setNow("06:45"); const { token } = await f.command(); const url = `/api/teacher-camera/${token}`;
  assert.equal((await f.request(`${url}/arrival`, photo)).status, 200);
  assert.equal((await f.request(`${url}/evidence`, { ...photo, material: "Materi" })).status, 400);
  f.setNow("08:20"); assert.equal((await f.request(url)).status, 410); assert.equal((await f.command()).token, undefined);
});
test("admin access protects teacher data and photos; report includes missing sessions", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/teachers")).status, 401);
  assert.equal((await f.request("/api/teachers", undefined, "wali_kelas")).status, 403);
  assert.equal((await f.request("/api/teachers", undefined, "tu")).status, 200);
  assert.equal((await f.request("/api/teachers/report?date=2026-02-30", undefined, "admin")).status, 400);
  assert.equal((await f.request(`/api/teachers/report/export?date=${date}`, undefined, "admin")).status, 200);
  assert.equal((await f.request(`/api/teachers/report/export?startDate=${date}&endDate=2026-09-21`, undefined, "admin")).status, 200);
  assert.equal((await f.request(`/api/teachers/report/export?startDate=${date}&endDate=2026-09-21`, undefined, "tu")).status, 200);
  assert.equal((await f.request(`/api/teachers/report/export?startDate=${date}&endDate=2026-09-21`, undefined, "wali_kelas")).status, 403);
  assert.equal((await f.request(`/api/teachers/report/export?startDate=2026-09-21&endDate=${date}`, undefined, "admin")).status, 400);
  assert.equal((await f.request("/api/teachers/report/export?startDate=2025-01-01&endDate=2026-01-02", undefined, "admin")).status, 400);
  const { token } = await f.command(); await f.request(`/api/teacher-camera/${token}/arrival`, photo);
  const key = f.service.report(date)[0].key;
  assert.equal((await f.request(`/api/teachers/report/${key}/selfie`)).status, 401);
  assert.equal((await f.request(`/api/teachers/report/${key}/selfie`, undefined, "wali_kelas")).status, 403);
  assert.equal((await f.request(`/api/teachers/report/${key}/selfie`, undefined, "admin")).status, 200);
  assert.equal((await f.request(`/api/teachers/report/${key}/review`, { review: "Sudah ditinjau" }, "admin")).status, 400);
  await f.request(`/api/teacher-camera/${token}/evidence`, { ...photo, material: "Materi" });
  assert.equal((await f.request(`/api/teachers/report/${key}/review`, { review: "Sudah ditinjau" }, "admin")).status, 200);
});
test("new link revokes previous link, teacher deactivation revokes access, and wali routing stays untouched", async (t) => {
  const f = await fixture(t); const first = await f.command(); const second = await f.command();
  assert.equal((await f.request(`/api/teacher-camera/${first.token}`)).status, 410);
  assert.equal((await f.request(`/api/teacher-camera/${second.token}`)).status, 200);
  assert.equal((await f.command("!masuk", `${num}@c.us`, `wali:${num}`)).handled, false);
  assert.match((await f.command("!masuk", "628000000000@c.us")).reply, /belum terdaftar/);
  await f.request("/api/teachers/person", { number: num, name: "Bu Ani", active: false }, "admin");
  assert.equal((await f.request(`/api/teacher-camera/${second.token}`)).status, 400);
});
test("failed durable write rolls back photo and leaves attendance retryable", async (t) => {
  const f = await fixture(t); const { token } = await f.command(); f.setFail(true);
  assert.equal((await f.request(`/api/teacher-camera/${token}/arrival`, photo)).status, 400);
  assert.equal(fs.readdirSync(f.temp).length, 0); assert.equal(f.service.report(date)[0].arrival, undefined);
  f.setFail(false); assert.equal((await f.request(`/api/teacher-camera/${token}/arrival`, photo)).status, 200);
});
test("data master menyediakan dropdown jadwal dan melindungi nilai yang masih digunakan", async (t) => {
  const f = await fixture(t);
  const initial = await f.request("/api/teachers", undefined, "admin");
  assert.deepEqual(initial.data.subjects, ["Matematika"]);
  assert.deepEqual(initial.data.classes, ["VII A"]);
  assert.equal((await f.request("/api/teachers/catalog/subjects", { name: "IPA" }, "admin")).status, 200);
  assert.equal((await f.request("/api/teachers/catalog/subjects", { name: "ipa" }, "admin")).status, 400);
  assert.equal((await f.request("/api/teachers/catalog/classes", { name: "VIII A" }, "admin")).status, 200);
  assert.deepEqual(f.classSync.at(-1), { type: "add", name: "VIII A" });
  const schedule = { ...baseSchedule, id: undefined, day: 2, subject: "IPA", className: "VIII A" };
  assert.equal((await f.request("/api/teachers/schedules", schedule, "admin")).status, 200);
  assert.equal((await f.request("/api/teachers/schedules", { ...schedule, day: 3, subject: "Belum Terdaftar" }, "admin")).status, 400);
  assert.equal((await f.request("/api/teachers/catalog/subjects/IPA", undefined, "admin", "DELETE")).status, 400);
  assert.equal((await f.request("/api/teachers/catalog/subjects", { name: "Seni Budaya" }, "admin")).status, 200);
  assert.equal((await f.request("/api/teachers/catalog/subjects/Seni%20Budaya", undefined, "admin", "DELETE")).status, 200);
});
test("jadwal dapat diedit dan dihapus tanpa mengubah masa berlaku yang tersimpan", async (t) => {
  const f = await fixture(t);
  const edited = await f.request(`/api/teachers/schedules/${id}`, { number: num, day: 1, subject: "Matematika", className: "VII A", start: "08:30", end: "09:50" }, "admin", "PATCH");
  assert.equal(edited.status, 200);
  assert.equal(f.service.config().schedules[id].start, "08:30");
  assert.equal(f.service.config().schedules[id].tolerance, 5);
  assert.equal(f.service.config().schedules[id].from, "2026-09-01");
  assert.equal((await f.request(`/api/teachers/schedules/${id}`, undefined, "admin", "DELETE")).status, 200);
  assert.equal(f.service.config().schedules[id], undefined);
  assert.equal((await f.request(`/api/teachers/schedules/${id}`, undefined, "admin", "DELETE")).status, 404);
});
test("mengedit data master memperbarui nama pada jadwal mengajar", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/teachers/catalog/subjects/Matematika", { name: "Aljabar" }, "admin", "PATCH")).status, 200);
  assert.equal((await f.request("/api/teachers/catalog/classes/VII%20A", { name: "VII B" }, "admin", "PATCH")).status, 200);
  const c = f.service.config();
  assert.deepEqual(c.subjects, ["Aljabar"]);
  assert.deepEqual(c.classes, ["VII B"]);
  assert.equal(c.schedules[id].subject, "Aljabar");
  assert.equal(c.schedules[id].className, "VII B");
  assert.deepEqual(f.classSync.at(-1), { type: "rename", originalName: "VII A", name: "VII B" });
});
test("menghapus guru menghapus jadwal aktif dan mencabut tautan", async (t) => {
  const f = await fixture(t);
  const { token } = await f.command();
  assert.equal((await f.request(`/api/teachers/person/${num}`, undefined, "admin", "DELETE")).status, 200);
  assert.equal((await f.request(`/api/teacher-camera/${token}`)).status, 410);
  assert.deepEqual(f.service.config().teachers, {});
  assert.equal(f.service.config().schedules[id], undefined);
  assert.equal(f.service.report(date).length, 0);
  assert.equal((await f.request(`/api/teachers/person/${num}`, undefined, "admin", "DELETE")).status, 404);
});
test("mengubah nomor guru memindahkan jadwal, izin, token, dan identitas riwayat", async (t) => {
  const f = await fixture(t);
  const newNum = "6281111111111";
  const { token } = await f.command();
  await f.state.update(TEACHER_RECORDS_PATH, (draft) => { draft[TEACHER_RECORDS_PATH].permissions ||= {}; draft[TEACHER_RECORDS_PATH].permissions[`${date}_${num}`] = { key: `${date}_${num}`, date, number: num, name: "Bu Ani", type: "Izin", reason: "Rapat" }; });
  const result = await f.request("/api/teachers/person", { originalNumber: num, number: newNum, name: "Bu Budi", active: true }, "admin");
  assert.equal(result.status, 200);
  const c = f.service.config();
  assert.equal(c.teachers[num], undefined);
  assert.equal(c.teachers[newNum].name, "Bu Budi");
  assert.equal(c.schedules[id].number, newNum);
  assert.equal(f.state.read(TEACHER_RECORDS_PATH).tokens[Object.keys(f.state.read(TEACHER_RECORDS_PATH).tokens)[0]].number, newNum);
  assert.equal(f.state.read(TEACHER_RECORDS_PATH).permissions[`${date}_${newNum}`].number, newNum);
  await f.state.update(TEACHER_RECORDS_PATH, (draft) => { delete draft[TEACHER_RECORDS_PATH].permissions[`${date}_${newNum}`]; });
  assert.equal((await f.request(`/api/teacher-camera/${token}`)).status, 200);
});
test("pengaturan nomor bot guru tidak mewajibkan atau menghapus hari libur lama", async (t) => {
  const f = await fixture(t);
  await f.state.update(TEACHERS_PATH, (draft) => { draft[TEACHERS_PATH].holidays = [date]; });
  assert.equal((await f.request("/api/teachers/settings", { number: tu }, "admin")).status, 200);
  assert.deepEqual(f.state.read(TEACHERS_PATH).holidays, [date]);
});
test("teacher permission covers scheduled sessions, revokes links, and blocks attendance", async (t) => {
  const f = await fixture(t); const issued = await f.command(); assert.ok(issued.token);
  const body = { number: num, date, type: "Sakit", reason: "Demam" };
  assert.equal((await f.request("/api/teachers/permissions", body)).status, 401);
  assert.equal((await f.request("/api/teachers/permissions", body, "admin")).status, 200);
  assert.equal((await f.request("/api/teachers/permissions", body, "admin")).status, 400);
  assert.equal((await f.request(`/api/teacher-camera/${issued.token}`)).status, 410);
  const command = await f.command(); assert.equal(command.token, undefined); assert.match(command.reply, /sakit hari ini/);
  const rows = f.service.report(date); assert.equal(rows.length, 1); assert.equal(rows[0].permission.reason, "Demam");
  const listed = await f.request(`/api/teachers/permissions?date=${date}`, undefined, "admin");
  assert.equal(listed.status, 200); assert.equal(listed.data.rows[0].type, "Sakit");
  assert.equal((await f.request(`/api/teachers/permissions/${date}/${num}`, { ...body, type: "Izin", reason: "Keperluan keluarga" }, "admin", "PATCH")).status, 200);
  assert.equal(f.service.report(date)[0].permission.type, "Izin");
  assert.equal((await f.request(`/api/teachers/permissions/${date}/${num}`, undefined, "admin", "DELETE")).status, 200);
  assert.equal(f.service.report(date)[0].permission, null);
});
test("teacher permission is rejected after attendance or without a teaching schedule", async (t) => {
  const f = await fixture(t); const { token } = await f.command();
  await f.request(`/api/teacher-camera/${token}/arrival`, photo);
  assert.equal((await f.request("/api/teachers/permissions", { number: num, date, type: "Izin", reason: "Keperluan keluarga" }, "admin")).status, 400);
  assert.equal((await f.request("/api/teachers/permissions", { number: num, date: "2026-09-15", type: "Izin", reason: "Keperluan keluarga" }, "admin")).status, 400);
});
