const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const header = html.slice(html.indexOf('<header class="sticky'), html.indexOf("</header>"));

test("header keeps unit selector and account menu in a single row", () => {
  assert.match(header, /flex-nowrap/);
  assert.match(header, /class="navbar-controls"/);
  assert.match(html, /\.navbar-controls\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(header, /class="navbar-unit-select /);
  assert.match(html, /\.navbar-unit-select\s*\{[^}]*width:\s*clamp\(/);
});

test("narrow screens reserve room for accessible controls", () => {
  assert.match(html, /@media \(max-width:\s*479px\)\s*\{[^}]*\.navbar-page-heading\s*\{\s*display:\s*none/);
  assert.match(header, /aria-label="Pilih unit aktif"/);
  assert.match(header, /aria-label="Buka menu akun"/);
  assert.match(header, /@change="selectActiveUnit\(\$event\)"/);
  assert.match(header, /min-h-11 shrink-0 flex-nowrap/);
  assert.match(html, /\.navbar-primary\s*\{[^}]*min-width:\s*0/);
});

test("account details remain available without crowding tablet navbar", () => {
  assert.match(header, /navbar-user-label hidden min-w-0 xl:block/);
  assert.match(header, /truncate text-sm text-slate-700/);
  assert.match(header, /@keydown.escape.window="userMenuOpen=false"/);
});
