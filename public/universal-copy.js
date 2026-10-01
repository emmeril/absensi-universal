"use strict";

const PHRASES = [
  ["Sistem Absensi Sekolah", "Sistem Absensi Universal"],
  ["sistem absensi sekolah", "sistem absensi universal"],
  ["Laporan Kehadiran Guru", "Laporan Kehadiran Petugas"],
  ["laporan kehadiran guru", "laporan kehadiran petugas"],
  ["Pengajuan Izin Siswa", "Pengajuan Izin Anggota"],
  ["pengajuan izin siswa", "pengajuan izin anggota"],
  ["Data Guru", "Data Petugas"],
  ["data guru", "data petugas"],
  ["Mata Pelajaran", "Aktivitas"],
  ["mata pelajaran", "aktivitas"],
  ["Jam Mengajar", "Jadwal Tugas"],
  ["jam mengajar", "jadwal tugas"],
  ["jadwal mengajar", "jadwal tugas"],
  ["Jadwal Mengajar", "Jadwal Tugas"],
  ["Bot Guru", "Bot Petugas"],
  ["bot guru", "bot petugas"],
  ["Bot Siswa", "Bot Anggota"],
  ["bot siswa", "bot anggota"],
  ["Wali Kelas", "Pengelola Unit"],
  ["wali kelas", "pengelola unit"],
  ["Tata Usaha", "Operator"],
  ["tata usaha", "operator"],
  ["Orang Tua", "Kontak Darurat"],
  ["orang tua", "kontak darurat"],
  ["foto kegiatan belajar", "foto kegiatan"],
  ["materi yang diajarkan", "catatan kegiatan"],
  ["materi diajarkan", "catatan kegiatan"],
  ["bukti mengajar", "bukti kegiatan"],
  ["kegiatan belajar", "kegiatan"],
  ["sesi mengajar", "sesi tugas"],
  ["Sesi mengajar", "Sesi tugas"],
  ["jadwal pelajaran", "jadwal aktivitas"],
  ["jam pelajaran", "sesi aktivitas"],
  ["admin sekolah", "admin organisasi"],
  ["Lokasi sekolah", "Lokasi kegiatan"],
  ["lokasi sekolah", "lokasi kegiatan"],
  ["Lokasi Sekolah", "Lokasi Kegiatan"],
  ["data sekolah", "data organisasi"],
  ["absensi sekolah", "absensi organisasi"],
  ["sekolah", "organisasi"],
];

const EXACT_LABELS = new Map([
  ["Siswa", "Anggota"],
  ["siswa", "anggota"],
  ["Guru", "Petugas"],
  ["guru", "petugas"],
  ["Kelas", "Unit"],
  ["kelas", "unit"],
  ["Pelajaran", "Aktivitas"],
  ["pelajaran", "aktivitas"],
  ["TU", "Operator"],
  ["Absen Siswa", "Absen Anggota"],
  ["Absen Guru", "Absen Petugas"],
  ["Tambah Siswa", "Tambah Anggota"],
  ["Edit Siswa", "Edit Anggota"],
  ["Tambah Guru", "Tambah Petugas"],
  ["Edit Guru", "Edit Petugas"],
  ["Tambah Kelas", "Tambah Unit"],
  ["Edit Kelas", "Edit Unit"],
]);

function toUniversalTerms(value) {
  if (typeof value !== "string" || !value) return value;
  const exact = EXACT_LABELS.get(value);
  if (exact) return exact;
  const phrased = PHRASES.reduce((text, [from, to]) => text.replaceAll(from, to), value);
  return phrased
    .replace(/\bSiswa\b/g, "Anggota")
    .replace(/\bsiswa\b/g, "anggota")
    .replace(/\bMurid\b/g, "Anggota")
    .replace(/\bmurid\b/g, "anggota")
    .replace(/\bGuru\b/g, "Petugas")
    .replace(/\bguru\b/g, "petugas")
    .replace(/\bKelas\b/g, "Unit")
    .replace(/\bkelas\b/g, "unit")
    .replace(/\bPelajaran\b/g, "Aktivitas")
    .replace(/\bpelajaran\b/g, "aktivitas")
    .replace(/\bmengajar\b/g, "bertugas")
    .replace(/\bdiajarkan\b/g, "dicatat");
}

function shouldSkipElement(element) {
  if (!element) return false;
  if (["SCRIPT", "STYLE", "TEXTAREA"].includes(element.tagName)) return true;
  return Boolean(element.closest?.(
    "[data-terminology-skip], [x-text*=\"brand\"], [x-text*=\".nama\"], [x-text*=\".name\"]"
  ));
}

function translateElement(root) {
  if (!root || typeof document === "undefined") return;
  const scope = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
  if (shouldSkipElement(scope)) return;

  if (root.nodeType === Node.TEXT_NODE) {
    const translated = toUniversalTerms(root.nodeValue);
    if (translated !== root.nodeValue) root.nodeValue = translated;
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (shouldSkipElement(node.parentElement)) continue;
    const translated = toUniversalTerms(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  const elements = root.nodeType === Node.ELEMENT_NODE
    ? [root, ...root.querySelectorAll("[placeholder], [title], [aria-label], [alt]")]
    : [...root.querySelectorAll("[placeholder], [title], [aria-label], [alt]")];
  for (const element of elements) {
    if (shouldSkipElement(element)) continue;
    for (const attribute of ["placeholder", "title", "aria-label", "alt"]) {
      if (element.hasAttribute?.(attribute)) {
        element.setAttribute(attribute, toUniversalTerms(element.getAttribute(attribute)));
      }
    }
  }
}

function installDocumentTerminology() {
  if (typeof document === "undefined") return;
  const install = () => {
    translateElement(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateElement(mutation.target);
        for (const node of mutation.addedNodes) translateElement(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();

  for (const method of ["alert", "confirm", "prompt"]) {
    if (typeof window[method] !== "function") continue;
    const original = window[method].bind(window);
    window[method] = (message, ...args) => original(toUniversalTerms(message), ...args);
  }
}

const api = { toUniversalTerms, translateElement, installDocumentTerminology };

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") {
  window.UniversalTerminology = api;
  installDocumentTerminology();
}
