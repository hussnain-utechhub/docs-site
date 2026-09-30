#!/usr/bin/env node
/**
 * Pulls the docs/ folder out of every repo in the GitHub org and drops it into
 * ./docs/<repo-name>/ so Docusaurus can build one site from all of them.
 *
 * Uses a sparse checkout so we only download the docs folder, not the whole repo.
 * Repos without a docs/ folder are skipped silently. That is intentional. It means
 * a repo opts in just by adding the folder, with no config change here.
 *
 * Three things this does beyond copying files:
 *   1. Writes docs/index.md, the org-wide landing page, listing every repo it pulled.
 *      Docusaurus serves docs at the site root, so without this the root 404s.
 *   2. Stamps last_update frontmatter on every page from the source repo's git log.
 *      Without it Docusaurus reads this repo's history, where every file is new at
 *      build time, and shows today's date on every page.
 *   3. Writes a _category_.json per repo pointing at that repo's docs/index.md, so
 *      each section opens on the repo's own front page instead of a generated index.
 *
 * Env:
 *   DOCS_ORG      Owner to pull from: an org, or a user account. Accepts a comma
 *                 separated list, e.g. "attorney-assistant,pete-aa". Everything the
 *                 token can see under those owners lands in the same site, so only list
 *                 more than one for a build nobody else will read.
 *   DOCS_TOKEN    token with read access to those repos (required)
 *   DOCS_DIR      folder inside each repo to pull (default: docs)
 *   SKIP_REPOS    comma separated repo names to ignore
 *   SELF_REPO     this repo's name, never pulled (default: docs-site)
 *
 * The names avoid the GITHUB_ prefix on purpose. GitHub Actions reserves it: a repo
 * variable named GITHUB_ORG cannot be created at all. GITHUB_ORG and GITHUB_TOKEN still
 * work as a local fallback, because that is what a developer shell usually already has.
 *
 * Test hooks. Leave these unset in CI.
 *   API_BASE      GitHub API base (default: https://api.github.com)
 *   GIT_BASE      base for clone URLs (default: authenticated github.com)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rewriteEscapingLinks } from "./rewrite-links.mjs";

const OWNERS = (process.env.DOCS_ORG || process.env.GITHUB_ORG || "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const ORG = OWNERS[0];
const TOKEN = process.env.DOCS_TOKEN || process.env.GITHUB_TOKEN;
const DOCS_DIR = process.env.DOCS_DIR || "docs";
const SELF = process.env.SELF_REPO || "docs-site";
const SKIP = (process.env.SKIP_REPOS || "").split(",").map((s) => s.trim()).filter(Boolean);
const API_BASE = process.env.API_BASE || "https://api.github.com";
SKIP.push(SELF); // this repo generates docs/ at build time, so pulling it would recurse

if (OWNERS.length === 0 || !TOKEN) {
  console.error("DOCS_ORG and DOCS_TOKEN are required.");
  process.exit(1);
}

const OUT = path.resolve("docs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "docsync-"));

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

// DOCS_ORG can name an organization or a personal account, and the endpoint that lists
// repos is different for each. The trap is /users/<name>/repos: it returns only PUBLIC
// repos no matter what the token can see, so a personal account full of private repos
// reports zero and looks like a permissions problem. For the token's own account the
// endpoint is /user/repos, which is scoped to whatever the token was granted.
async function resolveSource(ORG) {
  const me = await fetch(`${API_BASE}/user`, { headers: HEADERS });
  if (me.ok) {
    const login = (await me.json()).login;
    if (login && login.toLowerCase() === ORG.toLowerCase()) {
      console.log(`${ORG} is the token's own account. Listing repos the token can see.`);
      return { path: "/user/repos", query: "affiliation=owner" };
    }
  }

  const org = await fetch(`${API_BASE}/orgs/${ORG}`, { headers: HEADERS });
  if (org.ok) return { path: `/orgs/${ORG}/repos`, query: "type=all" };
  if (org.status !== 404) {
    throw new Error(`GitHub API ${org.status} looking up ${ORG}: ${await org.text()}`);
  }

  console.warn(
    `${ORG} is not an organization and is not this token's account.\n` +
    `  Falling back to public repos only. Private repos will be missing.`
  );
  return { path: `/users/${ORG}/repos`, query: "type=all" };
}

async function listRepos(ORG) {
  const src = await resolveSource(ORG);
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${API_BASE}${src.path}?per_page=100&${src.query}&page=${page}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    repos.push(...batch.filter((r) => !r.archived && !SKIP.includes(r.name)));
    if (batch.length < 100) break;
  }
  if (repos.length === 0) {
    console.warn(
      "\nThe token can see no repos under this account.\n" +
      "  Check the token's Repository access. 'Only select repositories' means it sees\n" +
      "  only those. 'All repositories' is what you want, or this list needs updating\n" +
      "  every time someone creates a repo."
    );
  }
  return repos;
}

function pullDocs(repo) {
  const dest = path.join(TMP, repo.slug);
  const base = process.env.GIT_BASE || `https://x-access-token:${TOKEN}@github.com`;
  const url = `${base}/${repo.owner}/${repo.name}.git`;
  try {
    // Full history for the docs folder only. We need the log, so no --depth 1 here;
    // blob:none plus sparse keeps the download small anyway.
    execSync(
      `git clone --filter=blob:none --sparse --branch ${repo.default_branch} ${url} ${dest}`,
      { stdio: "pipe" }
    );
    execSync(`git -C ${dest} sparse-checkout set ${DOCS_DIR}`, { stdio: "pipe" });
  } catch (err) {
    console.warn(`  skipped ${repo.name}: clone failed`);
    return false;
  }
  const src = path.join(dest, DOCS_DIR);
  if (!fs.existsSync(src)) return false;

  const target = path.join(OUT, repo.slug);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(src, target, { recursive: true });

  stampFrontmatter(dest, target, repo);
  writeSpecMeta(dest, target, repo);
  writeCategory(target, repo);
  return true;
}

// Two passes over every copied markdown file. Reads the last commit that touched it in
// the source repo and writes that in as last_update frontmatter, so the page shows when the
// doc actually changed rather than when the site was built. Then rewrites any link that
// points outside docs/ to an absolute URL on the source repo -- see rewrite-links.mjs.
function stampFrontmatter(clone, target, repo) {
  // Fallback for files git has no history for (untracked, or added in the working tree).
  // Every page must end up with a stamp: if one does not, Docusaurus falls back to running
  // git against THIS repo, which reports the build date at best and hard-fails the build
  // when the working directory is not a git repo at all.
  let head = ["", ""];
  try {
    head = execSync(`git -C ${clone} log -1 --format=%aI%x09%an`, { stdio: ["pipe", "pipe", "pipe"] })
      .toString().trim().split("\t");
  } catch {}

  for (const file of walk(target)) {
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
    const rel = path.posix.join(DOCS_DIR, path.relative(target, file).split(path.sep).join("/"));
    let date, author;
    try {
      const out = execSync(
        `git -C ${clone} log -1 --format=%aI%x09%an -- "${rel}"`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString().trim();
      [date, author] = out ? out.split("\t") : head;
    } catch {
      [date, author] = head;
    }
    const raw = fs.readFileSync(file, "utf8");

    // Point links that escape docs/ at the source repo. Done before the date check on
    // purpose: an unresolvable link fails the build whether or not the page got a stamp.
    let out = rewriteEscapingLinks(raw, rel, repo, DOCS_DIR);

    if (date) {
      // The Edit button has to point at the repo the file actually came from, which the
      // site config cannot work out once more than one owner is in play. Stamp it per file.
      const editUrl = `${repo.html_url}/edit/${repo.default_branch}/${rel}`;
      out = injectFrontmatter(out, date, author, editUrl);
    }
    if (out !== raw) fs.writeFileSync(file, out);
  }
}

// Adds last_update and custom_edit_url to existing frontmatter, or creates a frontmatter
// block. Leaves an author's own values alone, in case they were set deliberately.
function injectFrontmatter(raw, date, author, editUrl) {
  const stamp = `last_update:\n  date: ${date}\n  author: ${author}\ncustom_edit_url: ${editUrl}`;
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end !== -1) {
      const front = raw.slice(4, end);
      if (/^last_update:/m.test(front) || /^custom_edit_url:/m.test(front)) return raw;
      return `---\n${front}\n${stamp}\n---${raw.slice(end + 4)}`;
    }
  }
  return `---\n${stamp}\n---\n\n${raw}`;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// If the repo ships an OpenAPI spec, record when the spec last changed and where it came
// from. scripts/stamp-api-docs.mjs puts those onto the pages generated from it, which have
// no git history of their own and would otherwise crash the build or claim to be new today.
function writeSpecMeta(clone, target, repo) {
  const dir = path.join(target, "api");
  if (!fs.existsSync(dir)) return;
  const spec = ["openapi.yaml", "openapi.yml", "openapi.json"]
    .map((f) => path.join(dir, f))
    .find((f) => fs.existsSync(f));
  if (!spec) return;

  const rel = path.posix.join(DOCS_DIR, "api", path.basename(spec));
  let date = "";
  let author = "";
  try {
    const out = execSync(`git -C ${clone} log -1 --format=%aI%x09%an -- "${rel}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
    if (out) [date, author] = out.split("\t");
  } catch {}
  if (!date) return;

  fs.writeFileSync(
    path.join(dir, ".spec-meta.json"),
    JSON.stringify(
      {
        date,
        author,
        editUrl: `${repo.html_url}/edit/${repo.default_branch}/${rel}`,
      },
      null,
      2
    ) + "\n"
  );
}

// Gives each repo its own collapsible section in the sidebar. If the repo has a
// docs/index.md, the section header opens that page. Otherwise Docusaurus generates a
// plain list, which is a hint to the repo owner that they never wrote a front page.
function writeCategory(target, repo) {
  const hasIndex =
    fs.existsSync(path.join(target, "index.md")) ||
    fs.existsSync(path.join(target, "index.mdx"));
  const meta = {
    label: repo.ownerPrefixed ? `${repo.name} (${repo.owner})` : repo.name,
    link: hasIndex
      ? { type: "doc", id: `${repo.slug}/index` }
      : {
          type: "generated-index",
          // Pin the slug so every repo section lives at /<repo>/ whether it has an
          // index page or not. Without this, generated indexes land on a
          // /category/<repo> route and the link from the root page 404s.
          slug: `/${repo.slug}`,
          description: repo.description || "",
        },
    customProps: { sourceRepo: repo.html_url },
  };
  fs.writeFileSync(
    path.join(target, "_category_.json"),
    JSON.stringify(meta, null, 2) + "\n"
  );
}

// The site root. Docusaurus serves docs at "/", so something has to live at docs/index.md.
// Generating it means the org-wide index is never out of date and nobody maintains a list.
function writeRootIndex(pulled, skipped) {
  const multi = OWNERS.length > 1;
  const esc = (t) => (t || "").replace(/\|/g, "\\|");
  const rows = pulled
    .map((r) =>
      multi
        ? `| [${r.name}](${r.slug}/) | ${r.owner} | ${esc(r.description)} |`
        : `| [${r.name}](${r.slug}/) | ${esc(r.description)} |`
    )
    .join("\n");
  const header = multi
    ? "| Repo | Owner | What it is |\n| --- | --- | --- |"
    : "| Repo | What it is |\n| --- | --- |";
  const missing = skipped.length
    ? skipped.map((r) => `- ${multi ? r.owner + "/" : ""}${r.name}`).join("\n")
    : "- None. Every active repo has docs.";

  // This page is generated, so it has no git history of its own. It still needs a
  // last_update stamp for the same reason every other page does.
  const now = new Date().toISOString();
  const body = `---
title: Tech Docs
slug: /
sidebar_position: 0
last_update:
  date: ${now}
  author: sync-docs.mjs
---

# Tech Docs

How our systems are built and why we built them that way. One section per repo, pulled
from that repo's \`docs/\` folder. This page is generated, so it is never out of date.

Docs are edited in the repo they describe, not here. Every page has an Edit button that
opens the source file on GitHub.${multi ? "\n\nThis build covers " + OWNERS.join(", ") + "." : ""}

## Repos with docs

${header}
${rows}

## Repos with no docs yet

A repo shows up here until someone adds a \`docs/\` folder to it. Copy the scaffold from
[CONTRIBUTING](https://github.com/${OWNERS[0]}/${SELF}/blob/main/README.md) to get started.

${missing}

<!-- Generated by scripts/sync-docs.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit. -->
`;
  fs.writeFileSync(path.join(OUT, "index.md"), body);
}

const repos = [];
for (const owner of OWNERS) {
  const found = await listRepos(owner);
  // List them by name. A token set to "Only select repositories" silently omits repos it
  // was not granted, and the site just quietly lacks them -- there is no error anywhere.
  // Printing the names is the only way anyone notices one is missing.
  console.log(`Found ${found.length} repos in ${owner}: ${found.map((r) => r.name).join(", ")}`);
  for (const r of found) repos.push({ ...r, owner });
}

// Docusaurus strips a leading number prefix off every path segment when it works out a
// doc id, so a repo called 30-Day-Trial-Banner becomes Day-Trial-Banner on the site. That
// is the same rule that orders 0001-foo.md ahead of 0002-foo.md, so we want to keep it --
// but the folder has to be named what Docusaurus is going to call it. Otherwise the
// _category_.json written below points at an id that does not exist and the whole build
// fails, taking every other repo's docs down with it.
//
// Mirrors DefaultNumberPrefixParser in @docusaurus/plugin-content-docs.
function stripNumberPrefix(name) {
  // Leave dates and versions alone: 2021-11-foo, 7.0-foo.
  if (/^\d+[-_.]\d+/.test(name)) return name;
  const m = /^\d+\s*[-_.]+\s*([^-_.\s].*)$/.exec(name);
  return m ? m[1] : name;
}

// Two owners can each have a repo called "utils". Keep the short folder name when it is
// unique and fall back to owner-repo when it is not, so a single-owner build keeps its URLs.
for (const r of repos) r.slug = stripNumberPrefix(r.name);
const seen = new Map();
for (const r of repos) seen.set(r.slug, (seen.get(r.slug) || 0) + 1);
for (const r of repos) {
  if (seen.get(r.slug) > 1) {
    r.slug = stripNumberPrefix(`${r.owner}-${r.name}`);
    r.ownerPrefixed = true;
  }
}

fs.mkdirSync(OUT, { recursive: true });

const pulled = [];
const skipped = [];
for (const repo of repos) {
  if (pullDocs(repo)) {
    console.log(`  pulled ${repo.name}`);
    pulled.push(repo);
  } else {
    skipped.push(repo);
  }
}

if (skipped.length) {
  console.log(`\nNo ${DOCS_DIR}/ folder, so not on the site: ${skipped.map((r) => r.name).join(", ")}`);
}

writeRootIndex(pulled, skipped);
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nPulled docs from ${pulled.length} of ${repos.length} repos.`);
if (pulled.length === 0) {
  console.error("No docs found anywhere. Check DOCS_DIR and token scope.");
  process.exit(1);
}
