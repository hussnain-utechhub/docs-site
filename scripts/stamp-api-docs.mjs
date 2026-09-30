#!/usr/bin/env node
/**
 * Puts last_update and custom_edit_url onto the pages generated from each OpenAPI spec.
 *
 * Those pages are written by the OpenAPI plugin at build time, so git knows nothing about
 * them. Without a stamp Docusaurus falls back to running git against this repo, which
 * fails outright when the working tree is not a repo and reports today's date when it is.
 * The honest date for an endpoint page is the date its spec last changed, which the sync
 * recorded in .spec-meta.json.
 *
 * Run after `docusaurus gen-api-docs`, before the build. `npm run gen-api` does both.
 */
import fs from "node:fs";
import path from "node:path";

const DOCS = path.resolve("docs");
if (!fs.existsSync(DOCS)) {
  console.log("No docs folder. Run the sync first.");
  process.exit(0);
}

let stamped = 0;

for (const entry of fs.readdirSync(DOCS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(DOCS, entry.name, "api");
  const metaPath = path.join(dir, ".spec-meta.json");
  if (!fs.existsSync(metaPath)) continue;

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".mdx")) continue;
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, "utf8");
    if (!raw.startsWith("---\n")) continue;
    const end = raw.indexOf("\n---", 4);
    if (end === -1) continue;
    const front = raw.slice(4, end);
    if (/^last_update:/m.test(front)) continue;

    // The plugin writes custom_edit_url: null to hide the Edit button. Point it at the
    // spec instead, because editing the spec is exactly how you change these pages.
    const cleaned = front.replace(/^custom_edit_url:.*$/m, "").replace(/\n{2,}/g, "\n");
    const stamp =
      `last_update:\n  date: ${meta.date}\n  author: ${meta.author}\n` +
      `custom_edit_url: ${meta.editUrl}`;
    fs.writeFileSync(full, `---\n${cleaned}\n${stamp}\n---${raw.slice(end + 4)}`);
    stamped++;
  }
}

console.log(stamped === 0 ? "No generated API pages to stamp." : `Stamped ${stamped} API pages.`);
