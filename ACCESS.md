# Access notes

Read this before you point anyone at a URL.

## The problem

A GitHub Pages site built from a private repo is still served publicly. The repo is
private. The site is not. Anyone with the URL reads it, and the URL is guessable.

The only exception is GitHub Enterprise Cloud, which supports publishing a Pages site
privately so that only people with read access to the repo can see it. That covers project
sites from private or internal org repos. It does not cover organization sites, and on
Enterprise Managed Users every Pages site is private whether you want that or not.

We are not on Enterprise Cloud. So as written, `.github/workflows/build.yml` would publish
our internal architecture, integration points, credential locations and known gotchas to
the open internet.

**Do not enable GitHub Pages on this repo until one of the options below is settled.**

## What is actually in these docs

Worth being specific, because it decides how much this matters:

- System pages name the services we run, how they connect, and which fields matter.
- Gotchas name our rate limits and failure modes.
- ADRs name our vendors and what we chose against.
- Access sections name where credentials live. Never the credentials themselves, per rule 4
  in CONTRIBUTING, but "which vault, whose account" is still a map for someone.

None of it is catastrophic on its own. All of it together is a decent reconnaissance
document for our stack. Treat it as internal.

## Options

**1. Cloudflare Pages behind Cloudflare Access.** Build the same artifact, deploy to
Cloudflare Pages, put Cloudflare Access in front. Free at our size, and no domain purchase:
Access can gate the project's own `<project>.pages.dev` hostname. Email one-time PIN as the
login method to start, an identity provider later if it is worth it. Auth is at the edge, so
the site never renders for a stranger. This is the recommendation.

**2. GitHub Enterprise Cloud.** Flip Pages to private and change nothing else here. Clean,
and the Edit buttons and repo permissions line up exactly. Costs a plan upgrade, so it only
makes sense if we want Enterprise for other reasons.

**3. Netlify or Vercel with SSO.** Same shape as option 1. Both gate previews and
production behind team SSO on paid tiers. Fine if we already pay for one.

**4. No hosting yet.** Read the markdown in GitHub. It renders, it is searchable across the
org, and the folder structure is legible. Run `npm start` locally when you want the site
view. This costs nothing and stays correct, and it is the right answer if the site is not
worth a decision this month.

## What already works behind auth

Search is local. `@easyops-cn/docusaurus-search-local` builds the index at build time and
ships it with the site, so it keeps working behind an auth proxy. Algolia DocSearch would
not, because it crawls from outside.

## If we go with option 1

`.github/workflows/build.yml` already does the GitHub half. It builds on every push, cron
and `docs-updated` dispatch, then pushes the finished `build/` directory straight to
Cloudflare with `wrangler pages deploy`. Direct upload, not Cloudflare's Git integration:
the build stays in one place, `DOCS_SYNC_TOKEN` never leaves GitHub, and the rebuild
triggers keep working. Cloudflare's Git integration would only rebuild on a push to
docs-site, which is the one repo whose content never changes.

Nothing deploys until the repo variable `PUBLISH_TARGET` is set to `cloudflare-pages`.

The Cloudflare half, done once per project:

- A Pages project created as **Direct Upload**, not connected to a Git repo.
- An API token scoped to **Cloudflare Pages: Edit**, plus the account ID. Both go in this
  repo as secrets.
- **Access over the production `pages.dev` hostname.** No custom domain required. In Zero
  Trust, Access, Applications, Add an application, Self-hosted, and type the project's
  hostname into Public hostname directly. It accepts a `pages.dev` hostname even though the
  zone is Cloudflare's rather than ours.

  Do not go looking for this in the Pages project settings. The control there is **Preview
  access**, and its own help text says it covers preview URLs only: "Production pages.dev
  and custom domains are managed separately in Zero Trust." Older Cloudflare docs describe a
  workaround where you enable the preview policy and then delete the wildcard from the
  generated application's Subdomain field. That still works, but it is no longer necessary.

- **One-time PIN added as an identity provider**, under Zero Trust, Integrations, Identity
  providers, Add new identity provider, One-time PIN. This is not optional and not the
  default. New Zero Trust organizations default to the Cloudflare identity provider, so
  without this step the login page asks people to sign in with a Cloudflare account and no
  email is ever sent. Then, on the application, either accept all identity providers or
  select OTP explicitly.

- **A policy on the application**, allowing emails ending in our domain. Keep the two
  straight: the identity provider decides *how* someone proves who they are, the policy
  decides *whether* that person is allowed. They fail in a confusing way together, because
  an address that matches no Allow policy gets no OTP email while the page still claims one
  was sent. That is deliberate, so the login page cannot be used to enumerate addresses.

  Note the trade in the policy: anyone who can receive mail at the domain gets in, and
  mailbox access is the only factor. Fine for internal docs, and a policy edit to tighten
  later.

- **`noreply@notify.cloudflare.com` allowlisted** in Microsoft 365, or the codes get
  filtered. They are single use and expire after ten minutes, and a mail scanner that
  follows the link first will burn one before anybody reads it.

- **Restrict previews** separately, on the Pages settings page, if preview deployments are
  ever used. Nothing generates them today: the workflow only deploys `--branch=main`.

- **A custom domain is optional and still worth having eventually**, for a URL people can
  remember. If one is added it needs its own Access application. Cloudflare is explicit that
  without one the login page renders on the custom domain and then fails to authenticate,
  which looks like an outage rather than a misconfiguration.

## Users and seats

There is no roster to fill in. Cloudflare consumes a seat when someone authenticates, not
when an admin adds them, so the Access policy is the entire user management story. The free
plan covers 50, one per person regardless of how many times they log in, and we are not
close.

The trap: the Users list in Zero Trust records who has already logged in, and deleting
someone from it does not revoke anything. Cloudflare is explicit that a removed user who
authenticates again just takes a seat again. **To cut off access, edit the policy.** For OTP
specifically the second lever is their mailbox, because receiving the code is the whole
credential. Neither of those is the Users list, which is where everyone looks first.

## What we ended up with

Project `aa-docs-site`, serving at `aa-docs-site.pages.dev`, behind a self-hosted Access
application with an email OTP policy.

The `pages.dev` subdomain cannot be renamed. It is fixed when the project is created, the
namespace is shared across every Cloudflare account, and changing it means deleting the
project and making a new one. Decide on the name before there is anything to lose.

Verify the gate from an unauthenticated shell, which is the check that actually matters:

```bash
curl -sSI https://aa-docs-site.pages.dev/ | head -3
```

A 302 to `cloudflareaccess.com` is correct. A 200 means the site is public.

Whichever option we pick, write it up as an ADR in this repo so the next person knows the
Pages decision was deliberate.
