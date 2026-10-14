# VerifyHub

An AI-verification platform that takes **any real project** — a GitHub repo, a ZIP upload, a live URL, or a built-in example — and proves it actually works: it detects the stack, installs dependencies in an isolated runner, boots the app, health-checks it, exposes a live preview (direct proxy or ngrok tunnel), runs the verification engine, captures evidence, and notifies you on Telegram — all orchestrated from a dark, VS Code-inspired workspace UI.

## What it does

1. **Ingest** a project from GitHub (public URL or PAT-connected account), a ZIP upload, a live URL, or one of the four bundled runnable examples (static HTML, Express API, FastAPI, Vite+React).
2. **Detect** the stack — language, package manager, install command, start command, port, framework — from manifests like `package.json`, `requirements.txt`, `.verifyhub.yml`.
3. **Run** it in isolation: a per-project sandbox workspace, and either the **local runner** (Node process groups, per-project Python `.verifyhub-venv`) or the **Docker runner** (resource limits, non-root, no socket access — set `VERIFYHUB_RUNNER=docker`).
4. **Health-check** the booted app against reserved ports, with live logs streamed into the UI terminal.
5. **Preview** it live mid-run: the built-in preview proxy serves the app through the platform, and an ngrok tunnel can be attached for public sharing.
6. **Verify** it with the Kane engine (Kane CLI when available, with an honest HTTP-probe fallback — the fallback is always reported explicitly in the event timeline).
7. **Capture evidence** — HTTP checks, logs, artifacts — stored per run and viewable in the run detail page.
8. **Notify & schedule** — Telegram deliveries with per-run results, cron schedules for recurring verification, GitHub webhooks to re-verify on push.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, standalone output), React 19, TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, recharts, Monaco-style dark workspace shell |
| Data | Prisma ORM + SQLite (same domain model as the PostgreSQL spec: projects → runs → events/logs/evidence, schedules, integrations, notifications, webhook audit) |
| Realtime | Polling-based live updates, accelerated by the `ws-service` socket.io mini-service |
| Isolation | Local runner with process-group cleanup + venv, or Docker runner |

## Quick start

Prerequisites: **Node.js 20+** (or **Bun 1.1+**). Docker is optional (only for the Docker runner).

```bash
# 1. Install dependencies
bun install            # or: npm install

# 2. Point DATABASE_URL at a local SQLite file (a ready .env ships with the folder)
#    .env → DATABASE_URL=file:../db/custom.db
#    (Prisma resolves relative SQLite paths against prisma/schema.prisma)

# 3. Create the database and generate the client
bun run db:push        # or: npm run db:push

# 4. Start the dev server
bun run dev            # or: npm run dev
# → http://localhost:3000
```

Optional real-time accelerator (socket.io on :3003, publish API on :3004):

```bash
cd mini-services/ws-service && bun install && bun index.ts
```

Production build:

```bash
bun run build && bun run start
```

## Scripts

| Script | What it does |
|---|---|
| `dev` | Next dev server on port 3000 (logs tee'd to `dev.log`) |
| `build` | `next build` + assembles the standalone bundle (static + public) |
| `start` | Runs the standalone production server |
| `lint` | ESLint across the repo |
| `db:push` | Pushes `prisma/schema.prisma` to SQLite |
| `db:generate` | Regenerates the Prisma client |

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | SQLite file URL, e.g. `file:../db/custom.db` |
| `VERIFYHUB_RUNNER` | no | `local` (default) or `docker` — Docker runner enforces memory/CPU limits, non-root user, and never mounts the socket into the verified app |

Integration credentials (GitHub PAT, Telegram bot token + chat id, ngrok authtoken) are configured **in the app** under Settings / GitHub / Telegram — no extra env vars needed.

## Project structure

```
src/
  app/                      # App Router pages + REST API
    api/v1/                 # projects, runs, events, logs, evidence, preview proxy,
                            # schedules, integrations, github, telegram, webhooks,
                            # examples, upload, notifications, dashboard
    (pages)                 # dashboard, projects, project workspace, runs, run detail,
                            # kane, github, schedules, telegram, settings
  components/verifyhub/     # shell (activity bar + top bar), runs table,
                            # new-verification dialog, shared bits
  components/ui/            # shadcn/ui primitives
  server/verifyhub/         # the engine room:
    orchestrator.ts         #   run lifecycle: detect → prepare → install → start →
                            #   health → preview/tunnel → verify → cleanup → notify
    detect.ts               #   stack detection from manifests
    runner.ts               #   local runner (ports, process groups, venv) + docker runner
    engines.ts              #   verification engines (Kane CLI / HTTP probe fallback)
    ngrok.ts                #   tunnel management
    integrations.ts         #   telegram delivery, github repos, webhook dispatch
    store.ts / bus.ts       #   persistence + event bus
    examples.ts             #   four bundled runnable example projects
    config.ts / types.ts
  lib/                      # db client, typed API client + useApi hook, utils
prisma/schema.prisma        # full domain model (SQLite dialect)
mini-services/ws-service/   # socket.io broadcast service
docs/SPEC.md                # original product specification
```

## API surface (all under `/api/v1`)

- **Projects** — `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET /projects/:id/tree|file|config|runs`
- **Runs** — `GET/POST /runs`, `GET /runs/:id`, `POST /runs/:id/cancel`, `GET /runs/:id/logs|events|evidence`
- **Live preview** — `GET /preview/:runId/*` (proxies the verified app mid-run; returns an explanatory 410 after cleanup)
- **Ingestion** — `POST /upload` (ZIP), `POST /github/connect`, `GET /github/repos`, `POST /webhooks/github`
- **Automation** — `GET/POST /schedules`, `PATCH/DELETE /schedules/:id`
- **Integrations** — `GET /integrations`, `POST /telegram/connect`, `GET /notifications`
- **Misc** — `GET /dashboard` (KPIs), `GET /examples`, `GET /api` (health)

## Design notes

- **SQLite instead of PostgreSQL**: chosen so the platform runs anywhere with zero services; the Prisma domain model matches the PostgreSQL spec one-to-one, so switching back is a datasource swap.
- **Honest engine reporting**: when the Kane CLI is unavailable, the HTTP-probe fallback runs the full boot + health-check pipeline but the event timeline explicitly labels the engine used, so a "passed" run never masquerades as CLI-grade verification.
- **Clean process lifecycle**: verified apps are spawned as detached process-group leaders and torn down with negative-PID `killTree`; `reservePort()` re-checks that no listener survived, so runs leave no orphan processes or leaked ports.
- **Workspace discipline**: every project gets its own sandbox workspace under `verifyhub-data/` (created at runtime), keeping uploaded source, venvs, and artifacts isolated per project.
