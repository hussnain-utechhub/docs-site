# docs-site

One Docusaurus site built from the `docs/` folder of every repo in the GitHub org.

Docs stay in the repo they describe. This site is a read-only view. Nobody edits markdown
here. The Edit button on every page points back at the source repo.

## How it works

1. `scripts/sync-docs.mjs` lists every repo in the org, sparse-clones just its `docs/`
   folder, and copies it to `docs/<repo-name>/` in this repo.
2. The same script stamps `last_update` and `custom_edit_url` frontmatter on each page from
   the source repo's git log, and generates `docs/index.md`, the org-wide landing page.
3. Docusaurus builds one site with a section per repo, opening on that repo's
   `docs/index.md` if it has one.
4. GitHub Actions deploys it. Read [ACCESS.md](ACCESS.md) first.

A repo opts in by adding a `docs/` folder. There is no list to maintain. Copy
`files/docs-repo-scaffold/` from the Dev Ops folder into a repo to get the structure.

## Generated files

`docs/` is generated on every build and is gitignored. Do not commit anything into it and
do not edit it. `docs/index.md` is written by the sync script, not by hand.

## Setup

1. Create this as a repo named `docs-site`, private, under the same account that owns the
   code repos.
2. Set the repo variable `DOCS_ORG` to the account name, the part of the URL after
   github.com. It works for an organization or a personal account; the sync detects which.
   It cannot be called `GITHUB_ORG`, because GitHub reserves that prefix and rejects the
   name.
3. Create a token and save it as the repo secret `DOCS_SYNC_TOKEN`. See below.
4. Push to main. The site builds and goes nowhere. Nothing is published, and no URL
   exists. Creating this repo does not expose anything.
5. Settle hosting before publishing. See [ACCESS.md](ACCESS.md). Deploying is opt-in: the
   deploy step is skipped unless the repo variable `PUBLISH_TARGET` is set to
   `cloudflare-pages`. Setting that variable is the moment the docs land on a URL, so do it
   only once Cloudflare Access is in front of that URL. Read ACCESS.md first.
6. To deploy, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and the
   variable `CLOUDFLARE_PROJECT_NAME`. The build runs here and pushes the finished `build/`
   directory to Cloudflare, so Cloudflare never needs `DOCS_SYNC_TOKEN` and the cron and
   `docs-updated` dispatch keep working.

## If a push is rejected over the workflow files

```
! [remote rejected] main -> main (refusing to allow an OAuth App to create or
  update workflow .github/workflows/... without `workflow` scope)
```

That is the pusher's GitHub credential, not the repo. A token issued without `workflow`
scope cannot create or change anything under `.github/workflows/`, and the whole push is
rejected, so nothing lands. Every repo made from the template carries a workflow file, so
this hits people on their first push.

Fix it once, at the credential:

- **SSH remote.** `git remote set-url origin git@github.com:ORG/REPO.git`. SSH keys are not
  scoped this way, so it does not come back.
- **`gh auth refresh -h github.com -s workflow`** if you authenticate with the gh CLI.
- **A token with the scope.** Classic PAT with `repo` and `workflow`, or a fine-grained
  token with Contents and Workflows both read and write.

Do not delete the workflow file to get the push through.

## The token

The build needs to read `docs/` out of every other repo. The built-in `GITHUB_TOKEN` that
Actions provides only reaches this repo, which is the whole reason a separate secret exists.

Use a fine-grained personal access token. GitHub, top right avatar, Settings, Developer
settings, Personal access tokens, Fine-grained tokens, Generate new token.

- **Resource owner**: the account that owns the repos. If that is an organization, the org
  has to allow fine-grained tokens, and an owner may have to approve the request.
- **Repository access**: All repositories. "Only select repositories" works and then you
  have to add every new repo by hand, which nobody does. A repo the token cannot see is
  simply absent from the site, with no error.
- **Permissions**: Repository permissions, Contents: Read-only. Metadata comes along
  automatically. Nothing else. This token cannot write anything.
- **Expiration**: pick a date and put it in a calendar. When it expires the build fails with
  a 401 and the site quietly stops updating.

Then: this repo, Settings, Secrets and variables, Actions. Secrets tab, New repository
secret, name `DOCS_SYNC_TOKEN`. Variables tab, New repository variable, name `DOCS_ORG`.

A classic PAT with `repo` scope also works and is worse, because that scope can write to
every repo it can read. A GitHub App is the better answer once this matters enough to
maintain one, since App tokens do not expire on a calendar.

## API reference

A repo opts in by committing `docs/api/openapi.yaml`, the same way it opts into the site by
having a `docs/` folder. `scripts/api-specs.js` finds every spec after the sync, and
`npm run gen-api` turns each into endpoint pages with request and response samples and
generated code samples. `npm run build` and `npm start` both do it for you.

The spec stays in the repo with the code it describes. Rendering happens here, because the
renderer is a Docusaurus plugin and repos should not have to carry one.

Four things in the config exist only to make this work. Do not remove them while
troubleshooting something else:

- `docItemComponent: "@theme/ApiItem"` in the docs preset. Without it the endpoint pages
  render as empty grey panels with a console error and no build failure.
- `docusaurus-theme-openapi-docs` in `themes`.
- `future.faster` with `@docusaurus/faster`. On plain webpack the build dies with
  "Cannot get final name for export `__esModule`", and forcing it through by disabling
  module concatenation produces a page that throws "exports is not defined" at runtime.
  Rspack has no such problem.
- `future.v4.removeLegacyPostBuildHeadAttribute`, which `future.faster` requires.

`scripts/stamp-api-docs.mjs` puts the spec's real commit date and an edit link onto the
generated pages, for the same reason the sync stamps everything else.

### Code samples

`themeConfig.languageTabs` picks which languages the samples panel offers. We show HTTP,
Shell, Python, JavaScript, NodeJS and PHP. Left it alone and the theme offers all 21 it
supports, down to OCaml and Objective-C.

Tab order follows the array, and the first entry is the default. `variant` chooses the
library within a language, so Python can be Requests or http.client and PHP can be cURL,
Guzzle, HTTP_Request2 or pecl_http. The comment in the config lists every variant.

One gotcha: `shell` means Httpie and wget. curl is its own language, not a shell variant, so
add `{ language: "curl", logoClass: "curl", variant: "cURL" }` if you want a curl tab.

Verified with plugin and theme 5.2.0 on Docusaurus 3.10.2 and React 19.

## Two builds, one codebase

The site is static. Whatever the build token could see is baked into the HTML, and every
viewer sees all of it. There is no per-person filtering, and there cannot be.

So run it two ways.

**The org site.** `DOCS_ORG=your-org`, deployed, built with a token whose resource owner is
the org. That token cannot see anyone's personal repos, so personal docs cannot leak onto
the shared site even by accident. This is the one the team reads.

**A personal build.** `DOCS_ORG=your-org,your-username` with your own token, run locally
with `npm start`. You get the org's docs plus your own private repos in one site. Nobody
else can see it, because it only exists on your machine.

`DOCS_ORG` takes a comma separated list for exactly this. Rules that follow from it:

- **Never deploy a multi-owner build.** If a personal build is published, everyone with
  access to the site reads your private repos' docs. The deployed workflow reads the repo
  variable, so keep that variable set to the org alone.
- Name collisions are handled. Two repos called `utils` become `utils` and
  `owner-utils`, labelled `utils (owner)` in the sidebar. A single-owner build keeps the
  short name, so the deployed URLs never change because of a personal build.
- The Edit button is stamped per page from the repo it came from, so it stays correct across
  owners and for repos whose default branch is not `main`.

### Private repos under a personal account

Worth knowing, because it looks like a permissions bug. GitHub's `/users/<name>/repos`
endpoint returns only public repos, whatever the token allows. A personal account holding
private repos reports zero. The sync handles this: when `DOCS_ORG` is the token's own
account it lists through `/user/repos` instead, which respects the token. You will see
"pete-aa is the token's own account" in the log when that path is taken.

If `DOCS_ORG` is some other user's account, only their public repos are visible. That is a
GitHub limit, not something the script can work around.

## Running locally

Same two values, as environment variables. `DOCS_ORG` and `DOCS_TOKEN`, or the `GITHUB_ORG`
and `GITHUB_TOKEN` your shell probably already has.



```bash
export DOCS_ORG=your-org-or-username
export DOCS_TOKEN=github_pat_...
npm install
npm start
```

## Keeping it fresh

The site rebuilds on a weekday cron and whenever a repo fires a `docs-updated` dispatch.
Copy `.github/snippets/notify-docs-site.yml` into each repo to enable the second one.

## Two things not to change

`package.json` has no `"type": "module"`, and `docusaurus.config.js` uses
`module.exports`. Switching either one compiles fine and then fails server-side rendering
with `require.resolveWeak is not a function`. `scripts/sync-docs.mjs` is ESM because of its
`.mjs` extension, so it is unaffected.

`onBrokenLinks` is `"throw"`. A dead link is a docs site quietly becoming untrustworthy.
Fix the link.

`markdown.format` is `"detect"`, so `.md` files are CommonMark rather than MDX. Angle
brackets in prose, including Apex generics like `Map<Id, List<Contact>>` in a generated
reference page, fail the build under MDX. Nothing in our docs uses JSX.

## Links out of docs/

A doc may link to something in its own repo that lives outside `docs/`, most often
`../README.md`. That file is real, but the sync only copies `docs/`, so it never reaches
this site and `onBrokenLinks: "throw"` fails the build for the whole org over one repo's
link. Authors should not have to know that.

`scripts/rewrite-links.mjs` rewrites those to an absolute URL on the source repo, at its
default branch. Links that stay inside `docs/` are left alone, so Docusaurus still checks
them and still throws on a genuinely dead one. Links inside fenced code blocks are left
alone too, because they are usually examples.

## Things that will fail the build

- A relative link to a file that does not exist *within* `docs/`. A link out of `docs/` is
  rewritten instead, see above.
- A link that climbs above the repo root, like `../../../elsewhere`. Nothing sensible to
  rewrite it to, so it stays broken.
- No repo in the org has a `docs/` folder. The sync exits non-zero rather than publishing an
  empty site.
