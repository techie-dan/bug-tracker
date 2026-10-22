# Ziki Issues

Team **Zendor** fork of [`emerjent/bug-tracker`](https://github.com/emerjent/bug-tracker) (formerly `zeduchat/bug-tracker`).

Report bugs, filter the board, triage status/assignee, vote, and leave comments.

# Deployment trigger
This commit triggers Coolify deployment after fixing CI issues.

See the [new-ticket feed handbook](docs/handbook.md) for the human feed and agent polling API.

Brand mark: `public/ziki-mark.svg`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind
- Auth.js v5 — Google OAuth; email/password for local dev only (off in production, see `AUTH_PASSWORD_LOGIN`)
- Prisma + PostgreSQL
- pnpm
- Docker / Coolify deploy (served from root at `ziki.dev`)

## Live (production)

https://ziki.dev

(Old links on `https://issues.zedu.chat` and the legacy sub-path `https://contributors.zedu.chat/bug-tracker` still work.)

## Roles (RBAC)

| Role | Capabilities |
| --- | --- |
| `user` | Report bugs, comment, vote |
| `admin` | Site catalog access (platforms, types). Does not grant power inside an organization |
| `super_admin` | Site-wide access, including every organization's admin powers, plus `/admin/users` |

Inside an organization, triage, delete, boost, and member management come from the membership role (`owner` or `admin`), not from the site-wide `admin` role. `/admin/users` lists only the organization you're currently in.

Super-admin credentials come from `SUPER_ADMIN_*` env vars (see below). The seeder is idempotent and does not overwrite an existing super admin unless `SUPER_ADMIN_FORCE_UPDATE=true`.

## Keyboard shortcuts

Shortcuts are enabled by default and can be turned off in **Settings → Keyboard shortcuts**. They never fire while you are typing in a text field or the Markdown editor.

| Shortcut | Action |
| --- | --- |
| `n` or `c` | Report a new issue |
| `/` or `Ctrl/Cmd+K` | Search issues |
| `g` then `i` | Go to issues |
| `g` then `d` | Go to the admin dashboard (admins only) |
| `g` then `n` | Go to notifications |
| `j` / `k` | Next / previous issue in the list |
| `?` | Show the shortcuts help dialog |

## Demo accounts (credentials seed)

Local development only. Password sign-in is **off in production** (`AUTH_PASSWORD_LOGIN`), and the seeder refuses to load demo data when `NODE_ENV=production`.

| Email | Password |
| --- | --- |
| `alice@zendor.dev` | `12345678` (admin) |
| `bob@zendor.dev` | `12345678` |
| `cara@zendor.dev` | `12345678` |

> Seed only on an **empty** database (or set `SEED_DEMO_DATA=true`). Never wipe a DB that already has real signups.

## Local setup

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres on localhost:5433
pnpm db:migrate
pnpm db:seed                  # empty DB only
pnpm dev                      # http://localhost:3001
```

The app is served from the root domain at **`http://localhost:3001`** (matching production at `ziki.dev`). Legacy `/bug-tracker` paths automatically redirect to root.

## Link previews (Open Graph / Twitter)

Issue detail URLs (`/issues/[id]`, with legacy `/bugs/[id]` backwards-compatible redirects) emit OG + Twitter Card metadata so Slack, Discord, X, WhatsApp, and similar clients can unfurl a card with **title**, **status**, **author**, a **description snippet**, the **`/ziki-share.png`** share image (see `lib/share-image.ts`; SVGs are dropped by most unfurlers), and a **canonical URL**.

### Privacy (auth-gated pages)

All ticket pages require a session for normal browsers. Link-preview bots are allowlisted in middleware so they can fetch metadata without signing in. That path only exposes **safe public fields**: title, status label, reporter display name, and a short description snippet. It does **not** include emails, comments, proof links, votes, assignee details, or triage controls. Unauthenticated crawlers that reach the page see the same limited preview body plus a sign-in link — never the full ticket.

Platform unfurl caches are outside our control; metadata is generated on each request from current DB state (`generateMetadata`), so refreshed crawls pick up title/status edits.

### Env vars

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres URL |
| `AUTH_SECRET` | Session secret (`openssl rand -base64 32`) |
| `AUTH_URL` / `NEXTAUTH_URL` | Auth.js base path: origin + `/api/auth` (Next.js `basePath` is applied on top) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (required in production) |
| `AUTH_PASSWORD_LOGIN` | `true`/`false` to force email/password sign-in and the reset flow on/off. Default: off in production, on elsewhere |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Idempotent super-admin seed (optional; password min 12 chars) |
| `SUPER_ADMIN_FORCE_UPDATE` | Set `true` to rotate password / promote an existing account |
| `SEED_DEMO_DATA` | Set `true` to wipe and load demo users/bugs |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional SMTP for password-reset email (logs reset URL to console when unset) |
| `REPORT_FORM_URL` | Optional Google Form behind the floating "Report issue" button. Must be an `https://` link on a Google-owned host; when unset the button is not rendered |

Google redirect URI: `{AUTH_URL}/api/auth/callback/google`

## Deploy (Coolify)

- Build pack: **Dockerfile**. Container runs `prisma migrate deploy` on start.
- Set variables from `.env.example` in Coolify.
- GitHub secrets: `COOLIFY_WEBHOOK_URL` (and optionally `COOLIFY_TOKEN`).
- `Deploy (Coolify)` runs only after `Malware Scan (CI Gate)` passes on `main`.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Dev server (port 3001) |
| `pnpm build` / `pnpm start` | Production build / start (`PORT`) |
| `pnpm test` | Vitest |
| `pnpm db:migrate` | Prisma migrate (dev) |
| `pnpm db:seed` | Seed demo users/bugs (**empty DB only**) |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md).

PRs target **`main`** on `Zedu-Endor/issue-tracker` (this fork; the repo was renamed from `bug-tracker`). Sync from `upstream` (`emerjent/bug-tracker`) as needed.

## Archive

Earlier standalone MVP history/issues origin: [`Zedu-Endor/bug-tracker-mvp`](https://github.com/Zedu-Endor/bug-tracker-mvp) (issues transferred here).
