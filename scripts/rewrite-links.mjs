import path from "node:path";

// A doc that links out of its repo's docs/ folder -- "../README.md", "../../src/thing.ts" --
// points at a file that really exists in the source repo but was never copied here, because
// the sync pulls docs/ and nothing else. Docusaurus resolves the link against the site,
// finds nothing, and onBrokenLinks: "throw" fails the build for every repo in the org
// because of one repo's link. Telling authors to stop linking to their own README does not
// scale and is not even good advice.
//
// So rewrite those to an absolute URL on the source repo, which is what the author meant.
// Links that stay inside docs/ are deliberately left alone: those Docusaurus can and should
// check, and a throw on one of those is a real broken link worth failing over.

// Anything already absolute, protocol-relative, site-absolute or a bare anchor.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

// ](target) and ![alt](target), with an optional "title" after the path.
const INLINE = /(!?)\[([^\]]*)\]\(\s*<?([^)<>]*?)>?\s*\)/g;
// [label]: target, the reference-definition form, at the start of a line.
const REFDEF = /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/;

function targetOutsideDocs(target, fromDir, docsDir) {
  // Keep an #anchor or a "title" attached to whatever we produce.
  const m = /^([^#\s]+)([\s\S]*)$/.exec(target);
  if (!m) return null;
  const [, filePart, rest] = m;
  if (!filePart || EXTERNAL.test(filePart)) return null;

  const abs = path.posix.normalize(path.posix.join(fromDir, decodeURI(filePart)));
  // Still inside docs/: Docusaurus owns this link, leave it.
  if (abs === docsDir || abs.startsWith(`${docsDir}/`)) return null;
  // Climbed out of the repo entirely. Genuinely wrong, so let it keep failing the build.
  if (abs.startsWith("../")) return null;
  return { abs, rest };
}

/**
 * @param raw      file contents
 * @param relPath  path within the source repo, e.g. "docs/decisions/0001-x.md"
 * @param repo     { html_url, default_branch }
 */
export function rewriteEscapingLinks(raw, relPath, repo, docsDir = "docs") {
  const fromDir = path.posix.dirname(relPath);
  const base = `${repo.html_url}/blob/${repo.default_branch}/`;

  // A fenced block can contain example markdown. Rewriting a link inside one would corrupt
  // a code sample, and Docusaurus does not resolve links there anyway.
  let inFence = null;
  const lines = raw.split("\n").map((line) => {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (inFence === null) inFence = fence[1][0];
      else if (fence[1][0] === inFence) inFence = null;
      return line;
    }
    if (inFence !== null) return line;

    let out = line.replace(INLINE, (whole, bang, text, target) => {
      const hit = targetOutsideDocs(target, fromDir, docsDir);
      if (!hit) return whole;
      // An image needs the raw bytes; a blob URL renders GitHub's file viewer instead.
      const suffix = bang ? "?raw=1" : "";
      return `${bang}[${text}](${base}${hit.abs}${suffix}${hit.rest})`;
    });

    out = out.replace(REFDEF, (whole, label, target) => {
      const hit = targetOutsideDocs(target, fromDir, docsDir);
      return hit ? `${label}${base}${hit.abs}${hit.rest}` : whole;
    });

    return out;
  });

  return lines.join("\n");
}
