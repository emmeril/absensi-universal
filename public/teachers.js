window.mountTeacherPanel = function mountTeacherPanel(root, notify, initialTab = "guru", refreshWhatsapp = async () => {}) {
const $ = (id) => root.querySelector(`#${id}`) || document.getElementById(id);
const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
let config, reportRows = [], summaryRows = [], permissionRows = [], teacherRows = [];
const teacherTable = { search: "", statusFilter: "", photoFilter: "", sortKey: "", sortDirection: "asc", page: 1, size: 10 };
const summaryTable = { search: "", statusFilter: "", sortKey: "", sortDirection: "asc", page: 1, size: 10 };
const reportTable = { search: "", statusFilter: "", reviewFilter: "", sortKey: "", sortDirection: "asc", page: 1, size: 10 };
const scheduleTable = { search: "", teacherFilter: "", dayFilter: "", sortKey: "", sortDirection: "asc", page: 1, size: 10 };
const permissionTable = { search: "", typeFilter: "", sortKey: "", sortDirection: "asc", page: 1, size: 10 };
const catalogTables = {
  subjects: { search: "", sortDirection: "asc", page: 1, size: 10 },
  classes: { search: "", sortDirection: "asc", page: 1, size: 10 },
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function message(text, error = false) {
  if (!root.isConnected) return;
  $("message").textContent = text;
  $("message").hidden = !error;
  $("message").className = "mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700";
  notify(text, error ? "error" : "ok");
}
async function api(url, body, method = body ? "POST" : "GET") {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/teachers${url}`, { method, headers: body && !multipart ? { "Content-Type": "application/json" } : {}, body: body ? (multipart ? body : JSON.stringify(body)) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}
async function action(fn) { try { await fn(); } catch (error) { message(error.message, true); } }
function cell(row, value) { const td = document.createElement("td"); td.textContent = value ?? "-"; row.append(td); return td; }
function button(parent, label, fn, style = "primary") { const b = document.createElement("button"); b.type = "button"; b.className = style === "warning" ? "rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 disabled:opacity-50" : "rounded bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 disabled:opacity-50"; b.textContent = label; b.onclick = () => action(async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }); parent.append(b); return b; }
function teacherAction(parent, label, icon, className, fn) { const b = document.createElement("button"); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); b.className = `rounded px-2.5 py-1.5 disabled:opacity-50 ${className}`; b.innerHTML = `<i class="fa-solid ${icon}"></i>`; b.onclick = () => action(async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }); parent.append(b); return b; }
function emptyRow(body, columns, text) { const row = body.insertRow(); const td = cell(row, text); td.colSpan = columns; td.className = "py-10 text-center text-slate-400"; }
function paginate(rows, table) { const pages = Math.max(1, Math.ceil(rows.length / table.size)); table.page = Math.min(table.page, pages); const start = (table.page - 1) * table.size; return { rows: rows.slice(start, start + table.size), pages, start }; }
function updatePager(prefix, table, total, pages, start) { $(`${prefix}Current`).textContent = table.page; $(`${prefix}Prev`).disabled = table.page <= 1; $(`${prefix}Next`).disabled = table.page >= pages; $(`${prefix}PageInfo`).textContent = total ? `Menampilkan ${start + 1}-${Math.min(start + table.size, total)} dari ${total} data` : "Menampilkan 0 data"; }
function sortRows(rows, table, getters) { if (!table.sortKey) return rows; const getter = getters[table.sortKey]; const direction = table.sortDirection === "desc" ? -1 : 1; return [...rows].sort((a, b) => String(getter(a)).localeCompare(String(getter(b)), "id", { numeric: true, sensitivity: "base" }) * direction); }
function bindTableControls(prefix, table, fields, render, sortSelector) {
  for (const [id, key] of Object.entries(fields)) {
    const element = $(`${prefix}${id}`); if (!element) continue;
    const event = element.tagName === "SELECT" ? "onchange" : "oninput";
    element[event] = (e) => { table[key] = e.target.value; table.page = 1; render(); };
  }
  $(`${prefix}PageSize`).onchange = (e) => { table.size = Number(e.target.value); table.page = 1; render(); };
  $(`reset${prefix[0].toUpperCase()}${prefix.slice(1)}Filters`).onclick = () => { for (const [id, key] of Object.entries(fields)) { table[key] = ""; $(`${prefix}${id}`).value = ""; } table.page = 1; render(); };
  $(`${prefix}Prev`).onclick = () => { if (table.page > 1) { table.page--; render(); } };
  $(`${prefix}Next`).onclick = () => { table.page++; render(); };
  for (const sortButton of root.querySelectorAll(`[data-${sortSelector}-sort]`)) sortButton.onclick = () => { const key = sortButton.dataset[`${sortSelector}Sort`]; if (table.sortKey === key) table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc"; else { table.sortKey = key; table.sortDirection = "asc"; } table.page = 1; render(); };
}
function updateSortButtons(table, selector) { for (const sortButton of root.querySelectorAll(`[data-${selector}-sort]`)) { const active = table.sortKey === sortButton.dataset[`${selector}Sort`]; sortButton.closest("th").setAttribute("aria-sort", active ? (table.sortDirection === "asc" ? "ascending" : "descending") : "none"); sortButton.querySelector("i").className = `fa-solid ${active ? (table.sortDirection === "asc" ? "fa-sort-up" : "fa-sort-down") : "fa-sort"}`; } }
function photoLink(parent, key, kind, label) { const a = document.createElement("a"); a.href = `/api/teachers/report/${encodeURIComponent(key)}/${kind}`; a.target = "_blank"; a.rel = "noopener"; a.textContent = label; a.className = "block text-[#3c8dbc] hover:underline"; parent.append(a); }
function closeTeacherModal() { $("teacherModal").hidden = true; $("teacherForm").reset(); $("teacherNumber").disabled = false; delete $("teacherNumber").dataset.original; }
function openTeacherModal(number = "") {
  const teacher = number ? config.teachers[number] : null;
  $("teacherModalTitle").textContent = teacher ? "Edit Guru" : "Tambah Guru";
  $("teacherName").value = teacher?.name || "";
  $("teacherNumber").value = number;
  if (teacher) $("teacherNumber").dataset.original = number; else delete $("teacherNumber").dataset.original;
  $("teacherNumber").disabled = false;
  $("teacherActive").value = String(teacher?.active ?? true);
  $("teacherModal").hidden = false;
  $("teacherName").focus();
}
function filteredTeachers() {
  const query = teacherTable.search.toLocaleLowerCase("id");
  return teacherRows.filter((teacher) => {
    const matchesSearch = `${teacher.name} ${teacher.number}`.toLocaleLowerCase("id").includes(query);
    const matchesStatus = !teacherTable.statusFilter || (teacherTable.statusFilter === "active" ? teacher.active : !teacher.active);
    const matchesPhoto = !teacherTable.photoFilter || (teacherTable.photoFilter === "available" ? teacher.hasPhoto : !teacher.hasPhoto);
    return matchesSearch && matchesStatus && matchesPhoto;
  });
}
function sortedTeachers(rows) {
  if (!teacherTable.sortKey) return rows;
  const getters = { name: (teacher) => teacher.name, number: (teacher) => teacher.number, status: (teacher) => Number(teacher.active), photo: (teacher) => Number(teacher.hasPhoto) };
  const valueFor = getters[teacherTable.sortKey];
  const direction = teacherTable.sortDirection === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => String(valueFor(left)).localeCompare(String(valueFor(right)), "id", { numeric: true, sensitivity: "base" }) * direction);
}
function renderTeachers() {
  const filtered = sortedTeachers(filteredTeachers());
  const pages = Math.max(1, Math.ceil(filtered.length / teacherTable.size));
  teacherTable.page = Math.min(teacherTable.page, pages);
  const start = (teacherTable.page - 1) * teacherTable.size;
  const visible = filtered.slice(start, start + teacherTable.size);
  $("teachers").replaceChildren();
  for (const [index, teacher] of visible.entries()) {
    const row = $("teachers").insertRow(); cell(row, start + index + 1); cell(row, teacher.name); cell(row, teacher.number); cell(row, teacher.active ? "Aktif" : "Nonaktif"); cell(row, teacher.hasPhoto ? "Tersedia" : "Belum ada");
    const actions = document.createElement("div"); actions.className = "flex justify-center gap-1"; cell(row, "").append(actions);
    const input = document.createElement("input"); input.type = "file"; input.accept = "image/jpeg,image/png"; input.hidden = true;
    input.onchange = () => action(async () => { if (!input.files[0]) return; const data = new FormData(); data.append("photo", input.files[0]); await api(`/${teacher.number}/photo`, data); message("Foto referensi guru tersimpan."); await reload(); });
    actions.append(input);
    teacherAction(actions, "Unggah foto", "fa-camera", "bg-emerald-50 text-emerald-700", () => input.click());
    teacherAction(actions, "Edit", "fa-pen-to-square", "bg-amber-50 text-amber-700", () => openTeacherModal(teacher.number));
    teacherAction(actions, "Hapus", "fa-trash", "bg-red-50 text-red-700", async () => {
      if (!confirm(`Hapus guru ${teacher.name}? Jadwal mengajar aktif guru ini juga akan dihapus, sedangkan riwayat absensinya tetap disimpan.`)) return;
      await api(`/person/${encodeURIComponent(teacher.number)}`, undefined, "DELETE");
      await reload(); await Promise.all([loadReport(), loadSummary(), loadPermissions()]); message("Guru dan jadwal aktifnya dihapus.");
    });
  }
  if (!visible.length) emptyRow($("teachers"), 6, "Data tidak ditemukan");
  $("teacherCurrentPage").textContent = teacherTable.page;
  $("teacherPrevPage").disabled = teacherTable.page <= 1;
  $("teacherNextPage").disabled = teacherTable.page >= pages;
  $("teacherPageInfo").textContent = filtered.length ? `Menampilkan ${start + 1}-${Math.min(start + teacherTable.size, filtered.length)} dari ${filtered.length} data` : "Menampilkan 0 data";
  $("resetTeacherFilters").hidden = !(teacherTable.search || teacherTable.statusFilter || teacherTable.photoFilter);
  for (const sortButton of root.querySelectorAll("[data-teacher-sort]")) {
    const active = teacherTable.sortKey === sortButton.dataset.teacherSort;
    sortButton.closest("th").setAttribute("aria-sort", active ? (teacherTable.sortDirection === "asc" ? "ascending" : "descending") : "none");
    sortButton.querySelector("i").className = `fa-solid ${active ? (teacherTable.sortDirection === "asc" ? "fa-sort-up" : "fa-sort-down") : "fa-sort"}`;
  }
}
function option(select, value, label = value) { const item = document.createElement("option"); item.value = value; item.textContent = label; select.append(item); }
function catalogDefinition(kind) { return kind === "subjects" ? { label: "Mata Pelajaran", singular: "mata pelajaran", placeholder: "Contoh: Matematika" } : { label: "Kelas", singular: "kelas", placeholder: "Contoh: VII A" }; }
function closeCatalogModal() { $("catalogModal").hidden = true; $("catalogForm").reset(); delete $("catalogModal").dataset.kind; delete $("catalogModal").dataset.original; }
function openCatalogModal(kind, original = "") { const definition = catalogDefinition(kind); $("catalogModal").dataset.kind = kind; if (original) $("catalogModal").dataset.original = original; else delete $("catalogModal").dataset.original; $("catalogModalTitle").textContent = `${original ? "Edit" : "Tambah"} ${definition.label}`; $("catalogNameLabel").textContent = `Nama ${definition.label}`; $("catalogName").placeholder = definition.placeholder; $("catalogName").value = original; $("catalogModal").hidden = false; $("catalogName").focus(); }
function closeScheduleModal() { $("scheduleModal").hidden = true; $("scheduleForm").reset(); delete $("scheduleModal").dataset.id; }
function openScheduleModal(schedule) {
  $("scheduleForm").reset();
  if (schedule) {
    $("scheduleModal").dataset.id = schedule.id;
    $("scheduleModalTitle").textContent = "Edit Jadwal";
    $("scheduleModalDescription").textContent = "Perbarui data pengajaran dan waktu jadwal ini.";
    $("scheduleModalIcon").className = "fa-solid fa-pen-to-square";
    $("scheduleSubmitLabel").textContent = "Simpan Perubahan";
    $("scheduleTeacher").value = schedule.number;
    $("day").value = schedule.day;
    $("subject").value = schedule.subject;
    $("className").value = schedule.className;
    $("start").value = schedule.start;
    $("end").value = schedule.end;
  } else {
    delete $("scheduleModal").dataset.id;
    $("scheduleModalTitle").textContent = "Tambah Jadwal";
    $("scheduleModalDescription").textContent = "Lengkapi data pengajaran untuk menyimpan jadwal.";
    $("scheduleModalIcon").className = "fa-solid fa-calendar-plus";
    $("scheduleSubmitLabel").textContent = "Simpan Jadwal";
  }
  $("scheduleModal").hidden = false; $("scheduleTeacher").focus();
}
function closePermissionModal() { $("permissionModal").hidden = true; $("teacherPermissionForm").reset(); delete $("permissionModal").dataset.originalDate; delete $("permissionModal").dataset.originalNumber; }
function openPermissionModal(permission) {
  $("teacherPermissionForm").reset();
  if (permission) {
    $("permissionModal").dataset.originalDate = permission.date; $("permissionModal").dataset.originalNumber = permission.number;
    if (![...$("permissionTeacher").options].some((item) => item.value === permission.number)) option($("permissionTeacher"), permission.number, permission.name);
    $("permissionModalTitle").textContent = "Edit Izin Guru"; $("permissionModalDescription").textContent = "Perbarui data izin guru ini."; $("permissionModalIcon").className = "fa-solid fa-pen-to-square"; $("permissionSubmitLabel").textContent = "Simpan Perubahan";
    $("permissionTeacher").value = permission.number; $("permissionDate").value = permission.date; $("permissionType").value = permission.type; $("permissionReason").value = permission.reason;
  } else {
    delete $("permissionModal").dataset.originalDate; delete $("permissionModal").dataset.originalNumber;
    $("permissionModalTitle").textContent = "Tambah Izin Guru"; $("permissionModalDescription").textContent = "Catat izin untuk seluruh sesi mengajar guru."; $("permissionModalIcon").className = "fa-solid fa-file-circle-plus"; $("permissionSubmitLabel").textContent = "Simpan Izin";
    $("permissionDate").value = $("teacherPermissionDate").value || today;
  }
  $("permissionModal").hidden = false; $("permissionTeacher").focus();
}
function filteredCatalog(kind) { const query = catalogTables[kind].search.toLocaleLowerCase("id"); return (config[kind] || []).filter((name) => name.toLocaleLowerCase("id").includes(query)); }
function renderCatalog(kind) {
  const table = catalogTables[kind]; const definition = catalogDefinition(kind);
  const rows = [...filteredCatalog(kind)].sort((a, b) => a.localeCompare(b, "id", { numeric: true, sensitivity: "base" }) * (table.sortDirection === "desc" ? -1 : 1));
  const pages = Math.max(1, Math.ceil(rows.length / table.size)); table.page = Math.min(table.page, pages);
  const start = (table.page - 1) * table.size; const visible = rows.slice(start, start + table.size); const body = $(`${kind}CatalogRows`); body.replaceChildren();
  for (const [index, name] of visible.entries()) {
    const row = body.insertRow(); cell(row, start + index + 1); cell(row, name);
    const actions = document.createElement("div"); actions.className = "flex justify-center gap-1"; cell(row, "").append(actions);
    teacherAction(actions, `Edit ${definition.label}`, "fa-pen-to-square", "bg-amber-50 text-amber-700", () => openCatalogModal(kind, name));
    teacherAction(actions, `Hapus ${definition.label}`, "fa-trash", "bg-red-50 text-red-700", async () => {
      if (!confirm(`Hapus ${definition.singular} ${name}?`)) return;
      await api(`/catalog/${kind}/${encodeURIComponent(name)}`, undefined, "DELETE"); await reload(); message(`${definition.label} dihapus.`);
    });
  }
  if (!visible.length) emptyRow(body, 3, "Data tidak ditemukan");
  $(`${kind}CatalogCurrent`).textContent = table.page; $(`${kind}CatalogPrev`).disabled = table.page <= 1; $(`${kind}CatalogNext`).disabled = table.page >= pages;
  $(`${kind}CatalogPageInfo`).textContent = rows.length ? `Menampilkan ${start + 1}-${Math.min(start + table.size, rows.length)} dari ${rows.length} data` : "Menampilkan 0 data";
  $(`${kind}CatalogReset`).hidden = !table.search;
  const sortButton = root.querySelector(`[data-catalog-sort="${kind}"]`); sortButton.closest("th").setAttribute("aria-sort", table.sortDirection === "asc" ? "ascending" : "descending"); sortButton.querySelector("i").className = `fa-solid ${table.sortDirection === "asc" ? "fa-sort-up" : "fa-sort-down"}`;
}
async function reload() {
  config = await api("");
  $("tuNumber").value = config.number;
  teacherRows = Object.entries(config.teachers).map(([number, teacher]) => ({ number, ...teacher }));
  renderTeachers(); $("scheduleTeacher").replaceChildren(); $("scheduleTeacherFilter").replaceChildren(); $("permissionTeacher").replaceChildren();
  option($("scheduleTeacherFilter"), "", "Semua guru");
  $("subject").replaceChildren(); $("className").replaceChildren();
  option($("subject"), "", "Pilih mata pelajaran"); option($("className"), "", "Pilih kelas");
  for (const subject of config.subjects || []) option($("subject"), subject);
  for (const className of config.classes || []) option($("className"), className);
  renderCatalog("subjects"); renderCatalog("classes");
  for (const [number, t] of Object.entries(config.teachers)) {
    option($("scheduleTeacherFilter"), number, t.name);
    if (t.active) {
      for (const select of [$("scheduleTeacher"), $("permissionTeacher")]) { const option = document.createElement("option"); option.value = number; option.textContent = t.name; select.append(option); }
    }
  }
  if ([...$("scheduleTeacherFilter").options].some((item) => item.value === scheduleTable.teacherFilter)) $("scheduleTeacherFilter").value = scheduleTable.teacherFilter;
  else scheduleTable.teacherFilter = "";
  renderSchedules();
}
function scheduleRows() { return Object.values(config.schedules || {}).map((s) => ({ ...s, teacher: config.teachers[s.number]?.name || s.number, dayLabel: days[s.day], time: `${s.start}–${s.end}` })); }
function renderSchedules() {
  const query = scheduleTable.search.toLocaleLowerCase("id");
  let rows = scheduleRows().filter((s) => `${s.teacher} ${s.number} ${s.dayLabel} ${s.className} ${s.subject} ${s.time}`.toLocaleLowerCase("id").includes(query) && (!scheduleTable.teacherFilter || s.number === scheduleTable.teacherFilter) && (!scheduleTable.dayFilter || String(s.day) === scheduleTable.dayFilter));
  rows = sortRows(rows, scheduleTable, { teacher: (s) => s.teacher, day: (s) => s.day, time: (s) => s.start, class: (s) => s.className, subject: (s) => s.subject });
  const page = paginate(rows, scheduleTable); const body = $("schedules"); body.replaceChildren();
  for (const [index, s] of page.rows.entries()) {
    const row = body.insertRow(); cell(row, page.start + index + 1); cell(row, s.teacher); cell(row, s.dayLabel); cell(row, s.time); cell(row, s.className); cell(row, s.subject);
    const actions = document.createElement("div"); actions.className = "flex justify-center gap-1"; cell(row, "").append(actions);
    teacherAction(actions, "Edit jadwal", "fa-pen-to-square", "bg-amber-50 text-amber-700", () => openScheduleModal(s));
    teacherAction(actions, "Hapus jadwal", "fa-trash", "bg-red-50 text-red-700", async () => {
      if (!confirm(`Hapus jadwal ${s.teacher} pada ${s.time}?`)) return;
      await api(`/schedules/${encodeURIComponent(s.id)}`, undefined, "DELETE"); await reload(); await loadReport(); message("Jadwal dihapus. Riwayat absensi tetap tersedia.");
    });
  }
  if (!page.rows.length) emptyRow(body, 7, "Belum ada jadwal mengajar.");
  updatePager("schedule", scheduleTable, rows.length, page.pages, page.start); $("resetScheduleFilters").hidden = !(scheduleTable.search || scheduleTable.teacherFilter || scheduleTable.dayFilter); updateSortButtons(scheduleTable, "schedule");
}
function attendanceStatus(r) { return r.permission ? `${r.permission.type}: ${r.permission.reason}` : !r.arrival ? "Belum hadir" : r.hasEvidence ? "Bukti lengkap" : "Hadir · bukti belum lengkap"; }
async function loadReport() {
  reportRows = (await api(`/report?date=${encodeURIComponent($("teacherReportDate").value)}`)).rows;
  renderReport();
}
function renderReport() {
  const query = reportTable.search.toLocaleLowerCase("id");
  let rows = reportRows.filter((r) => {
    const status = r.permission ? "permission" : !r.arrival ? "absent" : r.hasEvidence ? "present" : "incomplete";
    const review = r.review === "Sudah ditinjau" ? "reviewed" : r.review === "Perlu perbaikan" ? "needs-review" : "pending";
    return `${r.name} ${r.number} ${r.schedule.className} ${r.schedule.subject} ${r.material || ""}`.toLocaleLowerCase("id").includes(query) && (!reportTable.statusFilter || reportTable.statusFilter === status) && (!reportTable.reviewFilter || reportTable.reviewFilter === review);
  });
  rows = sortRows(rows, reportTable, { name: (r) => r.name, session: (r) => `${r.schedule.className} ${r.schedule.subject}`, arrival: (r) => r.arrival || "", status: (r) => attendanceStatus(r) });
  const page = paginate(rows, reportTable); const body = $("teacherReport"); body.replaceChildren();
  for (const [index, r] of page.rows.entries()) {
    const row = body.insertRow(); cell(row, page.start + index + 1); cell(row, r.name); cell(row, `${r.schedule.start}–${r.schedule.end} · ${r.schedule.className} · ${r.schedule.subject}`);
    cell(row, r.arrival ? `${new Date(r.arrival).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}${r.lateMinutes ? ` (terlambat ${r.lateMinutes} menit)` : ""}` : "-");
    cell(row, attendanceStatus(r)); cell(row, r.material);
    const photos = cell(row, ""); if (r.hasSelfie) photoLink(photos, r.key, "selfie", "Selfie"); if (r.hasEvidence) photoLink(photos, r.key, "evidence", "Kegiatan");
    const review = cell(row, r.review || "-");
    if (r.reviewNote) { const note = document.createElement("p"); note.className = "mt-2 text-xs text-slate-500"; note.textContent = r.reviewNote; review.append(note); }
    if (r.hasEvidence) {
      const controls = document.createElement("div"); controls.className = "mt-2 flex flex-wrap gap-2"; review.append(controls);
      button(controls, "Tandai ditinjau", async () => { await api(`/report/${encodeURIComponent(r.key)}/review`, { review: "Sudah ditinjau", note: "" }); await loadReport(); message("Tinjauan disimpan."); });
      button(controls, "Catat perbaikan", async () => { const note = prompt("Catatan perbaikan untuk tindak lanjut TU:"); if (!note) return; await api(`/report/${encodeURIComponent(r.key)}/review`, { review: "Perlu perbaikan", note }); await loadReport(); message("Catatan tersimpan. Sampaikan tindak lanjut kepada guru."); }, "warning");
    }
  }
  if (!page.rows.length) emptyRow(body, 8, "Tidak ada jadwal atau catatan absensi pada tanggal ini.");
  updatePager("report", reportTable, rows.length, page.pages, page.start); $("resetReportFilters").hidden = !(reportTable.search || reportTable.statusFilter || reportTable.reviewFilter); updateSortButtons(reportTable, "report");
}
async function loadSummary() {
  summaryRows = (await api(`/report?date=${encodeURIComponent($("teacherSummaryDate").value)}`)).rows;
  $("summaryActive").textContent = Object.values(config.teachers).filter((teacher) => teacher.active).length;
  $("summaryScheduled").textContent = summaryRows.length;
  $("summaryPresent").textContent = summaryRows.filter((row) => row.arrival).length;
  $("summaryPermissions").textContent = new Set(summaryRows.filter((row) => row.permission).map((row) => row.number)).size;
  renderSummary();
}
function renderSummary() {
  const query = summaryTable.search.toLocaleLowerCase("id");
  let rows = summaryRows.filter((r) => { const status = r.permission ? "permission" : r.arrival ? "present" : "absent"; return `${r.name} ${r.number} ${r.schedule.className} ${r.schedule.subject}`.toLocaleLowerCase("id").includes(query) && (!summaryTable.statusFilter || summaryTable.statusFilter === status); });
  rows = sortRows(rows, summaryTable, { name: (r) => r.name, time: (r) => r.schedule.start, class: (r) => `${r.schedule.className} ${r.schedule.subject}`, status: (r) => attendanceStatus(r) });
  const page = paginate(rows, summaryTable); const body = $("teacherSummary"); body.replaceChildren();
  for (const [index, item] of page.rows.entries()) {
    const row = body.insertRow(); cell(row, page.start + index + 1); cell(row, item.name); cell(row, `${item.schedule.start}–${item.schedule.end}`);
    cell(row, `${item.schedule.className} · ${item.schedule.subject}`); cell(row, attendanceStatus(item));
  }
  if (!page.rows.length) emptyRow(body, 5, "Tidak ada sesi mengajar pada tanggal ini.");
  updatePager("summary", summaryTable, rows.length, page.pages, page.start); $("resetSummaryFilters").hidden = !(summaryTable.search || summaryTable.statusFilter); updateSortButtons(summaryTable, "summary");
}
async function loadPermissions() {
  permissionRows = (await api(`/permissions?date=${encodeURIComponent($("teacherPermissionDate").value)}`)).rows;
  renderPermissions();
}
function renderPermissions() {
  const query = permissionTable.search.toLocaleLowerCase("id");
  let rows = permissionRows.filter((r) => `${r.name} ${r.number} ${r.reason}`.toLocaleLowerCase("id").includes(query) && (!permissionTable.typeFilter || permissionTable.typeFilter === r.type));
  rows = sortRows(rows, permissionTable, { name: (r) => r.name, type: (r) => r.type, date: (r) => r.date });
  const page = paginate(rows, permissionTable); const body = $("teacherPermissions"); body.replaceChildren();
  for (const [index, item] of page.rows.entries()) {
    const row = body.insertRow(); cell(row, page.start + index + 1); cell(row, item.name); cell(row, item.type); cell(row, item.reason); cell(row, item.date);
    const actions = document.createElement("div"); actions.className = "flex justify-center gap-1"; cell(row, "").append(actions);
    teacherAction(actions, "Edit izin guru", "fa-pen-to-square", "bg-amber-50 text-amber-700", () => openPermissionModal(item));
    teacherAction(actions, "Hapus izin guru", "fa-trash", "bg-red-50 text-red-700", async () => {
      if (!confirm(`Hapus ${item.type.toLowerCase()} ${item.name}?`)) return;
      await api(`/permissions/${encodeURIComponent(item.date)}/${encodeURIComponent(item.number)}`, undefined, "DELETE");
      await Promise.all([loadPermissions(), loadSummary(), loadReport()]); message("Izin guru dihapus.");
    });
  }
  if (!page.rows.length) emptyRow(body, 6, "Belum ada izin guru pada tanggal ini.");
  updatePager("permission", permissionTable, rows.length, page.pages, page.start); $("resetPermissionFilters").hidden = !(permissionTable.search || permissionTable.typeFilter); updateSortButtons(permissionTable, "permission");
}
$("addTeacher").onclick = () => openTeacherModal();
$("closeTeacherModal").onclick = closeTeacherModal;
$("cancelTeacherModal").onclick = closeTeacherModal;
$("teacherModal").onclick = (event) => { if (event.target === $("teacherModal")) closeTeacherModal(); };
$("teacherModal").onkeydown = (event) => { if (event.key === "Escape") closeTeacherModal(); };
$("teacherSearch").oninput = (event) => { teacherTable.search = event.target.value; teacherTable.page = 1; renderTeachers(); };
$("teacherStatusFilter").onchange = (event) => { teacherTable.statusFilter = event.target.value; teacherTable.page = 1; renderTeachers(); };
$("teacherPhotoFilter").onchange = (event) => { teacherTable.photoFilter = event.target.value; teacherTable.page = 1; renderTeachers(); };
$("teacherPageSize").onchange = (event) => { teacherTable.size = Number(event.target.value); teacherTable.page = 1; renderTeachers(); };
$("resetTeacherFilters").onclick = () => {
  teacherTable.search = ""; teacherTable.statusFilter = ""; teacherTable.photoFilter = ""; teacherTable.page = 1;
  $("teacherSearch").value = ""; $("teacherStatusFilter").value = ""; $("teacherPhotoFilter").value = ""; renderTeachers();
};
$("teacherPrevPage").onclick = () => { if (teacherTable.page > 1) { teacherTable.page--; renderTeachers(); } };
$("teacherNextPage").onclick = () => { const pages = Math.ceil(filteredTeachers().length / teacherTable.size); if (teacherTable.page < pages) { teacherTable.page++; renderTeachers(); } };
for (const sortButton of root.querySelectorAll("[data-teacher-sort]")) sortButton.onclick = () => {
  const key = sortButton.dataset.teacherSort;
  if (teacherTable.sortKey === key) teacherTable.sortDirection = teacherTable.sortDirection === "asc" ? "desc" : "asc";
  else { teacherTable.sortKey = key; teacherTable.sortDirection = "asc"; }
  teacherTable.page = 1; renderTeachers();
};
for (const addButton of root.querySelectorAll("[data-add-catalog]")) addButton.onclick = () => openCatalogModal(addButton.dataset.addCatalog);
$("closeCatalogModal").onclick = closeCatalogModal; $("cancelCatalogModal").onclick = closeCatalogModal;
$("catalogModal").onclick = (event) => { if (event.target === $("catalogModal")) closeCatalogModal(); };
$("catalogModal").onkeydown = (event) => { if (event.key === "Escape") closeCatalogModal(); };
$("addSchedule").onclick = () => openScheduleModal(); $("closeScheduleModal").onclick = closeScheduleModal; $("cancelScheduleModal").onclick = closeScheduleModal;
$("scheduleModal").onclick = (event) => { if (event.target === $("scheduleModal")) closeScheduleModal(); };
$("scheduleModal").onkeydown = (event) => { if (event.key === "Escape") closeScheduleModal(); };
$("addPermission").onclick = () => openPermissionModal(); $("closePermissionModal").onclick = closePermissionModal; $("cancelPermissionModal").onclick = closePermissionModal;
$("permissionModal").onclick = (event) => { if (event.target === $("permissionModal")) closePermissionModal(); };
$("permissionModal").onkeydown = (event) => { if (event.key === "Escape") closePermissionModal(); };
$("catalogForm").onsubmit = (event) => {
  event.preventDefault(); const submit = event.submitter; const kind = $("catalogModal").dataset.kind; const label = catalogDefinition(kind).label;
  const original = $("catalogModal").dataset.original;
  action(async () => { submit.disabled = true; try { await api(original ? `/catalog/${kind}/${encodeURIComponent(original)}` : `/catalog/${kind}`, { name: $("catalogName").value }, original ? "PATCH" : "POST"); closeCatalogModal(); await reload(); message(`${label} ${original ? "diperbarui" : "ditambahkan"}.`); } finally { submit.disabled = false; } });
};
for (const kind of ["subjects", "classes"]) {
  const table = catalogTables[kind];
  $(`${kind}CatalogSearch`).oninput = (event) => { table.search = event.target.value; table.page = 1; renderCatalog(kind); };
  $(`${kind}CatalogPageSize`).onchange = (event) => { table.size = Number(event.target.value); table.page = 1; renderCatalog(kind); };
  $(`${kind}CatalogReset`).onclick = () => { table.search = ""; table.page = 1; $(`${kind}CatalogSearch`).value = ""; renderCatalog(kind); };
  $(`${kind}CatalogPrev`).onclick = () => { if (table.page > 1) { table.page--; renderCatalog(kind); } };
  $(`${kind}CatalogNext`).onclick = () => { const pages = Math.ceil(filteredCatalog(kind).length / table.size); if (table.page < pages) { table.page++; renderCatalog(kind); } };
  root.querySelector(`[data-catalog-sort="${kind}"]`).onclick = () => { table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc"; table.page = 1; renderCatalog(kind); };
}
bindTableControls("summary", summaryTable, { Search: "search", StatusFilter: "statusFilter" }, renderSummary, "summary");
bindTableControls("report", reportTable, { Search: "search", StatusFilter: "statusFilter", ReviewFilter: "reviewFilter" }, renderReport, "report");
bindTableControls("schedule", scheduleTable, { Search: "search", TeacherFilter: "teacherFilter", DayFilter: "dayFilter" }, renderSchedules, "schedule");
bindTableControls("permission", permissionTable, { Search: "search", TypeFilter: "typeFilter" }, renderPermissions, "permission");
for (const id of ["settingsForm", "teacherForm", "scheduleForm"]) $(id).onsubmit = (event) => {
  event.preventDefault(); const submit = event.submitter;
  action(async () => {
    submit.disabled = true;
    try {
      if (id === "settingsForm") await api("/settings", { number: $("tuNumber").value });
      if (id === "teacherForm") await api("/person", { originalNumber: $("teacherNumber").dataset.original || "", number: $("teacherNumber").value, name: $("teacherName").value, active: $("teacherActive").value === "true" });
      if (id === "scheduleForm") { const schedule = { number: $("scheduleTeacher").value, day: Number($("day").value), subject: $("subject").value, className: $("className").value, start: $("start").value, end: $("end").value }; const scheduleId = $("scheduleModal").dataset.id; await api(scheduleId ? `/schedules/${encodeURIComponent(scheduleId)}` : "/schedules", schedule, scheduleId ? "PATCH" : "POST"); }
      await reload(); await loadReport(); message(id === "settingsForm" ? "Pengaturan disimpan. Hubungkan nomor melalui menu Bot Guru." : "Data tersimpan.");
      if (id === "settingsForm") await refreshWhatsapp();
      if (id === "teacherForm") closeTeacherModal();
      if (id === "scheduleForm") closeScheduleModal();
    } finally { submit.disabled = false; }
  });
};
$("teacherPermissionForm").onsubmit = (event) => {
  event.preventDefault(); const submit = event.submitter;
  action(async () => {
    submit.disabled = true;
    try {
      const permission = { number: $("permissionTeacher").value, date: $("permissionDate").value, type: $("permissionType").value, reason: $("permissionReason").value };
      const originalDate = $("permissionModal").dataset.originalDate; const originalNumber = $("permissionModal").dataset.originalNumber;
      await api(originalDate ? `/permissions/${encodeURIComponent(originalDate)}/${encodeURIComponent(originalNumber)}` : "/permissions", permission, originalDate ? "PATCH" : "POST");
      $("teacherPermissionDate").value = permission.date; closePermissionModal();
      await Promise.all([loadPermissions(), loadSummary(), loadReport()]); message("Izin guru tersimpan.");
    } finally { submit.disabled = false; }
  });
};
$("teacherReportDate").value = today; $("teacherSummaryDate").value = today; $("teacherPermissionDate").value = today;
$("teacherExportStartDate").value = today; $("teacherExportEndDate").value = today;
$("teacherExportStartDate").max = today; $("teacherExportEndDate").min = today;
$("teacherExportStartDate").onchange = () => { $("teacherExportEndDate").min = $("teacherExportStartDate").value; };
$("teacherExportEndDate").onchange = () => { $("teacherExportStartDate").max = $("teacherExportEndDate").value; };
$("teacherReportDate").onchange = () => action(loadReport); $("refreshReport").onclick = () => action(loadReport);
$("teacherSummaryDate").onchange = () => action(loadSummary);
$("teacherPermissionDate").onchange = () => action(loadPermissions);
$("exportReport").onclick = () => {
  const startDate = $("teacherExportStartDate").value, endDate = $("teacherExportEndDate").value;
  if (!startDate || !endDate) { message("Pilih tanggal awal dan akhir export.", true); return; }
  if (endDate < startDate) { message("Tanggal akhir tidak boleh sebelum tanggal awal.", true); return; }
  window.location.assign(`/api/teachers/report/export?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
};
function showPanel(id) {
  for (const panel of root.querySelectorAll("[data-teacher-panel]")) panel.hidden = panel.id !== id;
}
let currentTab;
root.setTeacherView = (tab) => {
  if (tab === currentTab) return;
  currentTab = tab;
  showPanel(({ "ringkasan-guru": "teacherSummaryPanel", guru: "peoplePanel", "mapel-guru": "subjectsPanel", "kelas-guru": "classesPanel", "jam-guru": "schedulePanel", "izin-guru": "teacherPermissionPanel", "laporan-guru": "reportPanel", "bot-tu": "settingsPanel" })[tab] || "teacherSummaryPanel");
};
root.setTeacherView(initialTab);
async function initialize() {
  $("retryTeachers").hidden = true;
  try { await reload(); await Promise.all([loadReport(), loadSummary(), loadPermissions()]); $("content").hidden = false; $("message").hidden = true; }
  catch (error) { message(error.message, true); $("retryTeachers").hidden = false; }
}
$("retryTeachers").onclick = initialize;
void initialize();
};
