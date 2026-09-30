# Publishing this on GitHub Pages

Prepared and ready to push. Two changes are already applied:

- `docusaurus.config.js` — `baseUrl` is `/docs-site/` (Pages project sites serve from a subpath;
  leaving it as `/` makes every asset resolve one directory too high and the site 404s).
- `.github/workflows/build.yml` — deploys with `actions/deploy-pages` instead of Cloudflare,
  gated on the repo variable `PUBLISH_TARGET` being `github-pages`.

## Steps

1. **Create the repo.** Name it exactly `docs-site`, under the account that owns EasyCRM.
   Private is fine — but read the warning at the bottom.

2. **Push this folder.**
   ```
   git init
   git add .
   git commit -m "Docs site"
   git branch -M main
   git remote add origin https://github.com/<owner>/docs-site.git
   git push -u origin main
   ```
   If the push is rejected over the workflow file, that is your credential, not the repo:
   `gh auth refresh -h github.com -s workflow`, or switch the remote to SSH.
   Do NOT delete the workflow to get the push through.

3. **Create a token.** GitHub → Settings → Developer settings → Fine-grained tokens.
   - Resource owner: the account that owns the repos
   - Repository access: **All repositories**
   - Permissions: **Contents: Read-only**. Nothing else.
   - Put the expiry date in a calendar. When it lapses the build 401s and the site silently stops updating.

4. **Add the settings.** docs-site → Settings → Secrets and variables → Actions:
   - Secret `DOCS_SYNC_TOKEN` = the token from step 3
   - Variable `DOCS_ORG` = the account name (the part of the URL after github.com)

5. **Enable Pages.** Settings → Pages → Source: **GitHub Actions**.

6. **Turn publishing on.** Add the variable `PUBLISH_TARGET` = `github-pages`.
   Nothing deploys until this exists.

7. **Run it.** Actions → Build docs site → Run workflow. The log should show:
   ```
   Found N repos in <owner>: ...
     pulled EasyCRM
   Pulled docs from 1 of N repos.
   ```
   If EasyCRM is missing from "pulled", its docs are not on `main` yet.

   Then open `https://<owner>.github.io/docs-site/`.

## Read before step 6

A GitHub Pages site built from a **private** repo is still **publicly readable**. Access control
for Pages exists only on GitHub Enterprise Cloud. See ACCESS.md.

The API documentation is customer-facing and safe to publish. The risk is what comes later: this
site pulls `docs/` from EVERY repo automatically, so the moment a repo adds internal architecture
notes they join that public URL with no further decision.

If that matters, the Cloudflare Pages path in ACCESS.md puts the same build behind a login. The
original deploy step is in git history.
