/**
 * Finds every OpenAPI spec the sync pulled and returns the plugin config for it.
 *
 * A repo opts in by committing docs/api/openapi.yaml, the same way it opts into the site
 * by having a docs/ folder. Nothing is listed here by hand.
 *
 * The spec lives with the code it describes. Rendering happens here, because the renderer
 * is a Docusaurus plugin and repos should not have to carry one.
 */
const fs = require("node:fs");
const path = require("node:path");

const DOCS = path.resolve(__dirname, "..", "docs");
const CANDIDATES = ["api/openapi.yaml", "api/openapi.yml", "api/openapi.json"];

function findSpecs() {
  if (!fs.existsSync(DOCS)) return [];
  const out = [];
  for (const entry of fs.readdirSync(DOCS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const rel of CANDIDATES) {
      const spec = path.join(DOCS, entry.name, rel);
      if (fs.existsSync(spec)) {
        // Relative to the site root on purpose. The plugin writes specPath and outputDir
        // straight into the generated frontmatter, and an absolute path there becomes a
        // broken link that only reproduces on someone else's machine.
        out.push({
          repo: entry.name,
          spec: path.posix.join("docs", entry.name, rel),
          outputDir: path.posix.join("docs", entry.name, "api"),
        });
        break;
      }
    }
  }
  return out;
}

// Shape the plugin expects: { [id]: { specPath, outputDir, sidebarOptions } }
function apiConfig() {
  const config = {};
  for (const { repo, spec, outputDir } of findSpecs()) {
    config[repo] = {
      specPath: spec,
      outputDir,
      hideSendButton: true, // no live server to call from a static site
      downloadUrl: undefined,
      sidebarOptions: { groupPathsBy: "tag", categoryLinkSource: "tag" },
    };
  }
  return config;
}

module.exports = { findSpecs, apiConfig };
