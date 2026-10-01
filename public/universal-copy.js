"use strict";

const PHRASES = [
  ["Sistem Absensi Sekolah", "Sistem Absensi Universal"],
  ["sistem absensi sekolah", "sistem absensi universal"],
  ["Pengajuan Izin Siswa", "Pengajuan Izin Anggota"],
  ["pengajuan izin siswa", "pengajuan izin anggota"],
  ["Bot Siswa", "Bot Anggota"],
  ["bot siswa", "bot anggota"],
  ["Wali Kelas", "Pengelola Unit"],
  ["wali kelas", "pengelola unit"],
  ["Orang Tua", "Kontak Darurat"],
  ["orang tua", "kontak darurat"],
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
  ["Kelas", "Unit"],
  ["kelas", "unit"],
  ["Absen Siswa", "Absen Anggota"],
  ["Tambah Siswa", "Tambah Anggota"],
  ["Edit Siswa", "Edit Anggota"],
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
    .replace(/\bKelas\b/g, "Unit")
    .replace(/\bkelas\b/g, "unit");
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
