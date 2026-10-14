VerifyHub — Full Build Plan + Master AI Prompt

This is the version I would build: a production-oriented AI verification platform, not just a Kane wrapper.

> Core idea: Give VerifyHub a GitHub repository, ZIP/project, or URL → detect the project → run it in an isolated Docker environment → expose it through ngrok when needed → give the live URL to Kane → watch Kane verify the app inside the VerifyHub browser → save evidence/results → notify Telegram → optionally repeat automatically through GitHub webhooks or schedules.




---

1. Product identity

Name

VerifyHub

Tagline

> Build it. Run it. Let Kane verify it.



One-line pitch

> VerifyHub turns code into a live application and lets AI verify that it actually works.



Startup pitch

> VerifyHub is an AI-powered application verification platform for developers. Connect a GitHub repository, upload a project, or provide a live URL, and VerifyHub automatically prepares the application, runs it in an isolated Docker environment, exposes it securely when necessary, and gives Kane a real browser to verify the application. Developers can watch the entire process inside a clean VS Code-inspired workspace, inspect logs and evidence, receive live results, and get Telegram notifications. Verification can run manually, on every commit, on pull requests, or on a schedule.




---

2. What we're building

The complete workflow:

VERIFYHUB
                     │
       ┌─────────────┼─────────────┐
       │             │             │
    GitHub        Upload        Live URL
       │             │             │
       └─────────────┼─────────────┘
                     ▼
              Project Detector
                     │
                     ▼
                Run Manager
                     │
                     ▼
              Docker Runner
                     │
          ┌──────────┴──────────┐
          │                     │
       Web App              API App
          │                     │
          └──────────┬──────────┘
                     ▼
                   ngrok
                     │
                     ▼
              Public HTTPS URL
                     │
                     ▼
                    KANE
                     │
                     ▼
             Browser Verification
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Results     Evidence    Logs
          │          │          │
          └──────────┼──────────┘
                     ▼
                VerifyHub UI
                     │
              ┌──────┴──────┐
              ▼             ▼
          Dashboard      Telegram


---

3. Input types

VerifyHub should support three primary ways of starting a verification.

A. GitHub repository

https://github.com/user/project

The user selects:

Repository
Branch
Commit
Verification profile


---

B. Project upload

.zip

or eventually a project folder.

Example:

my-project.zip

VerifyHub extracts it into a temporary runner.


---

C. Existing URL

https://example.com

In this case VerifyHub doesn't need to start the application.

It can immediately give the URL to Kane.


---

4. Automatic project detection

This is one of the most important components.

VerifyHub should inspect:

package.json
requirements.txt
pyproject.toml
Pipfile
uv.lock
package-lock.json
pnpm-lock.yaml
yarn.lock
vite.config.*
next.config.*
angular.json
manage.py
main.py
app.py
docker-compose.yml
Dockerfile
index.html

Then determine:

Language
Framework
Package manager
Start command
Build command
Expected port
Health-check strategy

Example:

Detected Project

Language: Python
Framework: FastAPI
Package Manager: pip
Start command:
uvicorn main:app --host 0.0.0.0 --port 8000

Port: 8000

Or:

Detected Project

Language: TypeScript
Framework: Vite
Package Manager: npm
Start:
npm run dev -- --host 0.0.0.0

Port: 5173


---

5. Docker architecture

Docker is the execution layer.

Do not run arbitrary user repositories directly on the VerifyHub API server.

Instead:

VerifyHub API
      │
      ▼
     Redis
      │
      ▼
    Worker
      │
      ▼
Docker Runner
      │
      └── temporary container

Every verification gets an isolated environment:

verify-run-8f92

Inside:

/app
├── project
├── dependencies
└── runtime

The runner starts the user's application there.

When verification finishes:

Kane stops
ngrok stops
container destroyed

But the results remain in PostgreSQL.


---

6. Runner lifecycle

A run should have a state machine:

QUEUED
   ↓
PREPARING
   ↓
CLONING
   ↓
INSTALLING
   ↓
BUILDING
   ↓
STARTING
   ↓
HEALTH_CHECK
   ↓
EXPOSING
   ↓
READY
   ↓
KANE_VERIFYING
   ↓
COLLECTING_EVIDENCE
   ↓
COMPLETED

Failure can happen at any stage:

FAILED
CANCELLED
TIMEOUT


---

7. ngrok architecture

For applications that need external browser access:

Docker
  │
  └── Application
       │
       └── localhost:8000
                │
                ▼
              ngrok
                │
                ▼
       https://xxxxx.ngrok.app

VerifyHub saves:

preview_url
internal_port
ngrok_tunnel_id

Then:

preview URL
     │
     ├── VerifyHub Live Browser
     │
     ├── Kane
     │
     └── Telegram

For static applications you can either serve them directly through the runner or expose the local web server through the same mechanism.


---

8. Kane integration

Kane should be treated as a verification engine.

VerifyHub controls:

Kane job
Kane target URL
Kane instructions
Kane timeout
Kane result
Kane evidence

Conceptually:

VerifyHub
    │
    ▼
Kane CLI
    │
    ▼
Browser
    │
    ▼
ngrok URL
    │
    ▼
Docker application

Kane's output becomes structured VerifyHub events.

For example:

{
  "run_id": "run_123",
  "type": "verification_step",
  "message": "Login button found",
  "status": "success"
}


---

9. Live Kane browser

This should be the hero feature of the UI.

The user sees:

┌─────────────────────────────────────────────┐
│ KANE                                       │
│ ● VERIFYING                                │
├─────────────────────────────────────────────┤
│                                             │
│       ┌───────────────────────────────┐     │
│       │                               │     │
│       │        LIVE APPLICATION       │     │
│       │                               │     │
│       │        Your website           │     │
│       │                               │     │
│       └───────────────────────────────┘     │
│                                             │
├─────────────────────────────────────────────┤
│ ACTIVITY                                    │
│                                             │
│ ✓ Application loaded                        │
│ ✓ Navigation detected                       │
│ → Opening login                             │
│ ✓ Login form found                          │
│ → Testing authentication                    │
└─────────────────────────────────────────────┘


---

10. Evidence system

Every verification should produce evidence.

Examples:

Screenshots
Console logs
Network errors
Kane actions
Verification steps
Failure messages
Application logs
Health-check results

Project run:

RUN #1024

✓ Application started
✓ Homepage loaded
✓ Navigation works
✓ Login works
× Logout failed

Evidence
├── screenshot-01.png
├── screenshot-02.png
├── kane.log
└── application.log


---

11. GitHub integration

Users connect GitHub.

VerifyHub should support:

Repository selection
Branch selection
Commit selection
Pull requests
Commit verification
Webhooks
Repository metadata

Eventually:

GitHub
   │
   ▼
Push / PR
   │
   ▼
VerifyHub webhook
   │
   ▼
Create verification
   │
   ▼
Docker
   │
   ▼
Kane
   │
   ▼
Result


---

12. Automatic GitHub verification

The killer workflow:

Developer changes code
        ↓
git push
        ↓
GitHub
        ↓
VerifyHub webhook
        ↓
Docker runner
        ↓
Application starts
        ↓
ngrok
        ↓
Kane
        ↓
Verification
        ↓
GitHub status
        ↓
Telegram

Eventually VerifyHub can report:

✓ VerifyHub

Commit a82f91d passed verification.

18/18 checks passed.


---

13. Scheduling

Users should be able to create:

Every 30 minutes
Every hour
Daily
Weekly
Custom cron

Example:

Project:
My API

Schedule:
Every day at 02:00

Branch:
main

Verification:
Full Kane verification

Telegram:
Enabled

Architecture:

Scheduler
   ↓
Verification Job
   ↓
Redis
   ↓
Worker
   ↓
Docker
   ↓
Kane


---

14. Telegram integration

Telegram becomes the remote notification center.

The bot can send:

🤖 VerifyHub

Project: My API
Commit: a82f91d

Status: ✅ PASSED

18/18 checks passed.

Preview:
https://xxxx.ngrok.app

Duration:
2m 14s

Failure:

🤖 VerifyHub

Project: My API

Status: ❌ FAILED

14/18 checks passed.

Failed:
Login → Dashboard

Evidence:
[available in VerifyHub]

Preview:
https://xxxx.ngrok.app


---

15. Telegram commands

Eventually:

/start
/projects
/runs
/status
/run <project>
/cancel <run>
/preview <project>
/logs <run>
/verify <project>
/schedule

So you could literally be on your phone and say:

/run my-api

Then:

🚀 Starting verification...

🐳 Docker runner created

🌐 ngrok ready

🤖 Kane started

⏳ Verifying...

✅ 18/18 passed


---

16. Main UI

The frontend should feel like:

> VS Code + CI/CD dashboard + live browser testing



But with its own identity.

Main navigation:

Dashboard
Projects
Runs
Kane
GitHub
Schedules
Telegram
Settings


---

17. Project workspace

┌───────────────────────────────────────────────────────┐
│ VerifyHub                               ● Connected   │
├─────┬─────────────────────────────────────────────────┤
│     │ Project: my-api                                 │
│  ⌂  │                                                 │
│  ▦  │ ┌───────────────┬────────────────────────────┐ │
│  ▶  │ │ EXPLORER      │ KANE                       │ │
│  ◉  │ │               │                            │ │
│  G  │ │ src/          │ ● VERIFYING                │ │
│  ◷  │ │ ├ main.py     │                            │ │
│  ⚙  │ │ ├ routes/     │ https://xxxxx.ngrok.app    │ │
│     │ │ └ models/     │                            │ │
│     │ │               │ ┌────────────────────────┐ │ │
│     │ │ tests/        │ │                        │ │ │
│     │ │               │ │    LIVE BROWSER        │ │ │
│     │ │               │ │                        │ │ │
│     │ │               │ │    APPLICATION         │ │ │
│     │ │               │ │                        │ │ │
│     │ │               │ └────────────────────────┘ │ │
│     │ └───────────────┴────────────────────────────┘ │
├─────┴─────────────────────────────────────────────────┤
│ TERMINAL                                               │
│ $ uvicorn main:app --host 0.0.0.0 --port 8000       │
└───────────────────────────────────────────────────────┘


---

18. Frontend stack

Use:

React
TypeScript
Vite
Tailwind CSS
Radix UI
Lucide React
Zustand
TanStack Query
Axios
React Router
xterm
Monaco Editor
Framer Motion
React Dropzone
React Resizable Panels
Recharts
React Markdown
Shiki
YAML
date-fns

NPM install

npm install \
react \
react-dom \
react-router-dom \
zustand \
@tanstack/react-query \
axios \
lucide-react \
framer-motion \
react-dropzone \
react-resizable-panels \
xterm \
@xterm/addon-fit \
@xterm/addon-search \
@xterm/addon-web-links \
@monaco-editor/react \
recharts \
react-markdown \
remark-gfm \
shiki \
yaml \
date-fns \
@radix-ui/react-dialog \
@radix-ui/react-dropdown-menu \
@radix-ui/react-context-menu \
@radix-ui/react-tooltip \
@radix-ui/react-tabs \
@radix-ui/react-select \
@radix-ui/react-popover \
@radix-ui/react-scroll-area \
@radix-ui/react-separator \
@radix-ui/react-slot

Development:

npm install -D \
vite \
typescript \
@vitejs/plugin-react \
tailwindcss \
@tailwindcss/vite \
eslint \
prettier


---

19. Python stack

API

FastAPI
Uvicorn
Pydantic
Pydantic Settings

Database

SQLAlchemy
asyncpg
Alembic
PostgreSQL

Jobs

Redis
Celery

Integrations

httpx
GitPython
aiogram

Runner

Docker SDK
watchdog

Security

cryptography
PyJWT
pwdlib[argon2]

Logging

structlog

Scheduling

APScheduler

Testing

pytest
pytest-asyncio

Quality

ruff
mypy


---

20. Complete Python install

pip install \
fastapi \
"uvicorn[standard]" \
pydantic \
pydantic-settings \
sqlalchemy \
asyncpg \
alembic \
redis \
celery \
httpx \
gitpython \
docker \
watchdog \
cryptography \
PyJWT \
"pwdlib[argon2]" \
structlog \
aiogram \
apscheduler

Development:

pip install \
pytest \
pytest-asyncio \
ruff \
mypy


---

21. Database design

PostgreSQL tables:

users
projects
project_sources
github_connections
repositories
runs
run_events
run_logs
verification_sessions
verification_steps
evidence
artifacts
schedules
telegram_connections
notifications
webhooks
api_keys

Core relationship:

User
 │
 ├── Projects
 │     │
 │     ├── Runs
 │     │    ├── Events
 │     │    ├── Logs
 │     │    ├── Evidence
 │     │    └── Artifacts
 │     │
 │     └── Schedules
 │
 ├── GitHub Connection
 │
 └── Telegram Connection


---

22. API structure

Example:

/api/v1

Projects

POST   /projects
GET    /projects
GET    /projects/{id}
DELETE /projects/{id}

Runs

POST /projects/{id}/runs
GET  /runs
GET  /runs/{id}
POST /runs/{id}/cancel
GET  /runs/{id}/logs
GET  /runs/{id}/events

Kane

POST /runs/{id}/verify
GET  /runs/{id}/verification
GET  /runs/{id}/evidence

GitHub

GET  /github/repositories
POST /github/connect
POST /github/webhook
POST /github/projects/{id}/sync

Schedules

POST   /schedules
GET    /schedules
PATCH  /schedules/{id}
DELETE /schedules/{id}

Telegram

POST /telegram/connect
POST /telegram/test


---

23. WebSocket

Use:

/ws/runs/{run_id}

Events:

run.created
run.status
runner.created
project.detected
install.started
install.completed
application.started
health_check
ngrok.connected
kane.started
kane.action
kane.screenshot
kane.error
kane.completed
run.completed

This powers the live UI.


---

24. Project configuration

Eventually support:

name: my-project

runtime:
  type: auto

verification:
  engine: kane

  url: auto

  instructions:
    - Open homepage
    - Test navigation
    - Test login
    - Test logout

notifications:
  telegram: true

schedule:
  enabled: true
  cron: "0 */6 * * *"

Call it:

.verifyhub.yml

This makes VerifyHub feel like a real developer platform.


---

25. Docker Compose for VerifyHub itself

Local development:

docker-compose.yml

services:

  frontend

  api

  worker

  scheduler

  postgres

  redis

The actual user projects are separate temporary Docker containers.

This distinction is very important.

VerifyHub infrastructure
        │
        ├── API
        ├── Worker
        ├── Redis
        └── PostgreSQL

User execution
        │
        ├── runner-001
        ├── runner-002
        └── runner-003


---

26. Local environment

Your PC:

Windows 11
    │
    ▼
WSL 2
    │
    ▼
Ubuntu
    │
    ▼
Docker Desktop / Docker Engine
    │
    ▼
VerifyHub

You can develop the whole platform locally.


---

27. Production

Your production target:

AWS VPS
    │
    ▼
Coolify
    │
    ├── VerifyHub Web
    ├── VerifyHub API
    ├── Worker
    ├── Scheduler
    ├── PostgreSQL
    └── Redis

Coolify handles deployment and service management.

Your GitHub repository becomes:

GitHub
   ↓
Coolify
   ↓
AWS VPS


---

28. Production runner security

This needs to be designed before public launch.

Because you're executing arbitrary repositories, runner containers should have:

CPU limits
Memory limits
Disk limits
Execution timeout
Process limits
Non-root user
Restricted Linux capabilities
Temporary filesystem
Isolated workspace
No host filesystem access
No Docker socket inside runner
Restricted network access where possible
Secret isolation
Automatic cleanup

Never mount /var/run/docker.sock into an untrusted project container.

That's one of the biggest security rules for this project.


---

29. MVP

Don't build everything at once.

Phase 1

Build:

React UI
FastAPI
PostgreSQL
Redis
Docker
Project upload
Project detection
Python/Node support
Application runner
ngrok
Kane
Live browser
Live logs

Goal:

Upload project
     ↓
Docker
     ↓
Application starts
     ↓
ngrok
     ↓
Kane
     ↓
Result


---

30. Phase 2

Add:

GitHub
Repository cloning
Branches
Commits
GitHub OAuth
Webhooks

Then:

git push
   ↓
VerifyHub
   ↓
automatic verification


---

31. Phase 3

Add:

Telegram
Notifications
Telegram commands
Schedules
Cron
Verification history


---

32. Phase 4

Add:

Evidence
Screenshots
Run comparison
Verification history
Artifacts
Failure analysis


---

33. Phase 5

Add advanced verification:

Kane
pytest
Jest
Playwright
Lighthouse
Accessibility
API testing
Security checks

Now VerifyHub becomes a verification platform rather than a single-tool integration.


---

34. Final project architecture

verifyhub/
│
├── apps/
│   ├── web/
│   │   ├── dashboard/
│   │   ├── projects/
│   │   ├── runs/
│   │   ├── kane/
│   │   ├── github/
│   │   ├── schedules/
│   │   └── settings/
│   │
│   └── api/
│       ├── routes/
│       ├── services/
│       ├── models/
│       ├── schemas/
│       └── websocket/
│
├── workers/
│   ├── runner/
│   ├── kane/
│   ├── github/
│   ├── telegram/
│   └── scheduler/
│
├── infrastructure/
│   ├── docker/
│   ├── compose/
│   └── deployment/
│
├── tests/
│
├── .env.example
├── docker-compose.yml
├── README.md
└── .verifyhub.yml


---

🔥 MASTER BUILD PROMPT

You can give the following prompt to an AI coding agent to start building it:

You are a senior full-stack architect, DevOps engineer, security engineer, and developer-tool designer.

Build a production-oriented developer platform called:

VERIFYHUB

TAGLINE:
"Build it. Run it. Let Kane verify it."

CORE PRODUCT IDEA:

VerifyHub is an AI-powered application verification platform.

A user should be able to:

1. Upload a project ZIP.
2. Connect a GitHub repository.
3. Provide an existing live URL.

VerifyHub detects the project type, prepares the environment, runs the application inside an isolated Docker container, exposes the application through ngrok when external browser access is required, starts Kane as the browser verification engine, displays the live verification experience inside the VerifyHub web interface, stores logs/results/evidence, and optionally sends results to a Telegram bot.

The architecture must be designed so Kane is a verification engine inside VerifyHub rather than the entire product.

TECH STACK:

FRONTEND:
- React
- TypeScript
- Vite
- Tailwind CSS
- Radix UI
- Lucide React
- Zustand
- TanStack Query
- React Router
- Axios
- Framer Motion
- xterm
- Monaco Editor
- React Dropzone
- React Resizable Panels
- Recharts
- React Markdown
- Remark GFM
- Shiki
- YAML
- date-fns

BACKEND:
- Python
- FastAPI
- Uvicorn
- Pydantic
- Pydantic Settings
- SQLAlchemy
- PostgreSQL
- asyncpg
- Alembic
- Redis
- Celery
- HTTPX
- GitPython
- Docker SDK
- Watchdog
- Cryptography
- PyJWT
- pwdlib with Argon2
- Structlog
- aiogram
- APScheduler

DEVELOPMENT:
- pytest
- pytest-asyncio
- Ruff
- mypy

INFRASTRUCTURE:
- Docker
- Docker Compose
- GitHub
- ngrok
- Kane CLI
- AWS VPS
- Coolify

FRONTEND DESIGN:

Create a very clean, professional developer workspace inspired by the usability principles of VS Code, but DO NOT clone VS Code.

VerifyHub must have its own visual identity.

Use:
- dark developer workspace
- subtle borders
- compact navigation
- excellent spacing
- clean typography
- minimal animations
- Lucide icons
- responsive design
- desktop-first developer workspace
- tablet support
- mobile support

DO NOT use:
- excessive gradients
- neon effects
- excessive glassmorphism
- giant cards
- unnecessary animations
- cluttered dashboards

The primary application workspace should contain:

LEFT ACTIVITY BAR:
- Dashboard
- Projects
- Runs
- Kane
- GitHub
- Schedules
- Telegram
- Settings

PROJECT WORKSPACE:
- Explorer
- Live Browser
- Kane activity
- Terminal
- Logs

The signature UI is the Kane live verification browser.

Users should be able to watch:
- application loading
- Kane actions
- verification steps
- screenshots/evidence
- success/failure
- application logs
- terminal output

BACKEND ARCHITECTURE:

Use:

React
↓
FastAPI
↓
Redis
↓
Celery Worker
↓
Docker Runner
↓
Application
↓
ngrok
↓
Kane
↓
Verification Result
↓
WebSocket
↓
React UI

Every project execution must happen in an isolated temporary Docker container.

NEVER execute arbitrary user repositories directly on the main API host.

RUNNER:

The runner must:
1. Create temporary workspace.
2. Clone GitHub repository or extract upload.
3. Detect project type.
4. Detect language/framework/package manager.
5. Detect install command.
6. Detect build command.
7. Detect start command.
8. Detect application port.
9. Install dependencies.
10. Build application if necessary.
11. Start application.
12. Perform health check.
13. Start ngrok when required.
14. Obtain public HTTPS URL.
15. Start Kane verification.
16. Stream events to VerifyHub.
17. Store logs and evidence.
18. Stop Kane.
19. Stop ngrok.
20. Destroy the temporary container.
21. Preserve verification metadata and evidence.

PROJECT DETECTION MUST SUPPORT AT LEAST:

Node:
- package.json
- npm
- pnpm
- yarn
- Vite
- React
- Next.js
- Express

Python:
- requirements.txt
- pyproject.toml
- Pipfile
- FastAPI
- Flask
- Django

Static:
- index.html
- HTML/CSS/JS

Also detect:
- Dockerfile
- docker-compose.yml

Design the detection engine so more frameworks can be added later.

RUN STATE MACHINE:

QUEUED
PREPARING
CLONING
INSTALLING
BUILDING
STARTING
HEALTH_CHECK
EXPOSING
READY
KANE_VERIFYING
COLLECTING_EVIDENCE
COMPLETED

Failure states:
FAILED
CANCELLED
TIMEOUT

WEBSOCKET:

Implement:

/ws/runs/{run_id}

Events should include:

run.created
run.status
runner.created
project.detected
install.started
install.completed
application.started
health_check
ngrok.connected
kane.started
kane.action
kane.screenshot
kane.error
kane.completed
run.completed

The UI must update in real time.

KANE:

Integrate Kane CLI as an external verification engine.

Do not hard-code the system around Kane internals.

Create an abstraction:

VerificationEngine

Then implement:

KaneVerificationEngine

The architecture must allow future engines:

Playwright
pytest
Jest
Lighthouse
Accessibility scanner
Security scanner
API tester

Kane receives the accessible application URL and verification instructions.

Capture:
- status
- actions
- output
- errors
- screenshots/evidence where available
- duration
- final result

NGROK:

The runner should expose applications through ngrok when required.

Example:

Docker application:
127.0.0.1:8000

↓
ngrok

↓
https://xxxxx.ngrok.app

The public URL should be available to:
- Kane
- VerifyHub Live Browser
- Telegram notifications

GITHUB:

Implement GitHub integration with:
- OAuth
- repository listing
- repository selection
- branch selection
- commit selection
- repository cloning
- webhook handling
- push verification
- pull request verification

Workflow:

git push
↓
GitHub webhook
↓
VerifyHub
↓
create run
↓
Docker
↓
ngrok
↓
Kane
↓
result

TELEGRAM:

Create a Telegram notification service using aiogram.

Support:
- verification started
- application ready
- ngrok URL
- Kane started
- verification completed
- verification failed
- logs summary
- preview URL
- evidence link

Eventually support commands:

/start
/projects
/runs
/status
/run <project>
/cancel <run>
/preview <project>
/logs <run>
/verify <project>
/schedule

SCHEDULER:

Implement APScheduler initially.

Allow:
- hourly
- daily
- weekly
- custom cron

A schedule should contain:
- project
- branch
- verification profile
- cron
- enabled state
- notification configuration

DATABASE:

Use PostgreSQL.

Create models for:

users
projects
project_sources
github_connections
repositories
runs
run_events
run_logs
verification_sessions
verification_steps
evidence
artifacts
schedules
telegram_connections
notifications
webhooks
api_keys

API:

Create versioned routes:

/api/v1/projects
/api/v1/runs
/api/v1/github
/api/v1/kane
/api/v1/schedules
/api/v1/telegram
/api/v1/webhooks

RUN API:

POST /projects/{id}/runs
GET /runs
GET /runs/{id}
POST /runs/{id}/cancel
GET /runs/{id}/logs
GET /runs/{id}/events
POST /runs/{id}/verify
GET /runs/{id}/verification
GET /runs/{id}/evidence

PROJECT API:

POST /projects
GET /projects
GET /projects/{id}
DELETE /projects/{id}

GITHUB API:

POST /github/connect
GET /github/repositories
POST /github/projects/{id}/sync
POST /github/webhook

SCHEDULE API:

POST /schedules
GET /schedules
PATCH /schedules/{id}
DELETE /schedules/{id}

TELEGRAM API:

POST /telegram/connect
POST /telegram/test

SECURITY:

This platform executes arbitrary developer projects.

Security is a first-class requirement.

Use:
- isolated Docker containers
- non-root execution
- CPU limits
- memory limits
- process limits
- disk limits
- execution timeout
- temporary workspaces
- no host filesystem access
- no Docker socket inside project containers
- restricted Linux capabilities
- secret isolation
- cleanup after every run
- safe environment variable handling
- encrypted sensitive credentials
- authentication
- authorization
- rate limiting
- input validation
- safe GitHub webhook verification
- SSRF protection
- URL validation
- logging/auditing

Never expose host credentials to user projects.

Never mount /var/run/docker.sock into untrusted runner containers.

The API server, worker, scheduler, database, Redis, and project runners must be logically separated.

DOCKER COMPOSE:

Create local development services:

frontend
api
worker
scheduler
postgres
redis

User projects must run in separate dynamically-created runner containers.

Do not confuse the VerifyHub infrastructure containers with project execution containers.

ENVIRONMENT:

Create .env.example containing placeholders for:

DATABASE_URL
REDIS_URL
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_WEBHOOK_SECRET
TELEGRAM_BOT_TOKEN
NGROK_AUTHTOKEN
JWT_SECRET
ENCRYPTION_KEY

Never commit real secrets.

VERIFYHUB CONFIGURATION:

Support a project configuration file:

.verifyhub.yml

Example:

name: my-project

runtime:
  type: auto

verification:
  engine: kane
  instructions:
    - Open homepage
    - Test navigation
    - Test login
    - Test logout

notifications:
  telegram: true

schedule:
  enabled: false

DASHBOARD:

Build a clean developer dashboard showing:
- total projects
- active runs
- success rate
- recent runs
- failed runs
- active verification
- scheduled projects

PROJECT PAGE:

Show:
- project information
- GitHub repository
- branch
- latest commit
- status
- Run button
- Live button
- Tests
- Runs
- Logs
- Evidence
- Git
- Settings

RUN PAGE:

Show:
- run status
- duration
- project
- commit
- environment
- application URL
- ngrok URL
- Kane status
- live browser
- terminal
- logs
- verification timeline
- evidence
- final report

KANE PAGE:

Show:
- active Kane session
- live browser
- activity timeline
- verification steps
- screenshots
- errors
- final result

TERMINAL:

Use xterm.

Show:
- install output
- application output
- runner logs
- Kane logs where appropriate

EDITOR:

Use Monaco Editor for project inspection.

Do not attempt to become a full IDE in V1.

The primary purpose is verification.

RESPONSIVENESS:

Desktop:
full developer workspace

Tablet:
collapsible explorer/activity bar

Mobile:
stack:
- project
- live browser
- Kane activity
- logs

Do not simply shrink the desktop UI.

Create proper responsive layouts.

TESTING:

Create backend unit tests.
Create API integration tests.
Create runner tests.
Create project detection tests.
Create scheduler tests.
Create GitHub webhook tests.

Create sample test projects:

examples/
├── static-html/
├── vite-react/
├── fastapi/
├── flask/
└── express/

Each sample project should be usable to test the VerifyHub runner.

DOCUMENTATION:

Create:
README.md
ARCHITECTURE.md
DEVELOPMENT.md
SECURITY.md
DEPLOYMENT.md
CONTRIBUTING.md

Include:
- local setup
- WSL2 setup
- Docker setup
- environment variables
- database migrations
- starting workers
- starting scheduler
- ngrok configuration
- Kane configuration
- Telegram configuration
- GitHub OAuth configuration
- AWS deployment
- Coolify deployment
- security model

LOCAL DEVELOPMENT:

Target environment:

Windows 11
↓
WSL2
↓
Ubuntu
↓
Docker
↓
VerifyHub

PRODUCTION:

GitHub
↓
Coolify
↓
AWS VPS
↓
Docker
↓
VerifyHub

IMPLEMENTATION RULES:

1. Keep services modular.
2. Use clean architecture.
3. Separate API, workers, runners, integrations, and UI.
4. Use typed schemas.
5. Use async Python where appropriate.
6. Use structured logging.
7. Use WebSockets for live events.
8. Never block FastAPI request handlers with long-running verification.
9. Queue long-running jobs.
10. Make runners disposable.
11. Make verification reproducible.
12. Store immutable run metadata.
13. Keep secrets out of repositories and logs.
14. Build security into the architecture from day one.
15. Do not create fake functionality.
16. Do not use placeholder buttons that pretend to work.
17. If a feature is not implemented, clearly mark it as TODO.
18. Keep the UI clean and developer-focused.
19. Avoid unnecessary dependencies.
20. Write production-quality code.

MOST IMPORTANT USER EXPERIENCE:

A user should be able to do this:

1. Open VerifyHub.
2. Click "New Verification".
3. Select GitHub Repository.
4. Select repository and branch.
5. Click "Verify".
6. See:
   Detecting project...
   Creating runner...
   Installing dependencies...
   Starting application...
   Connecting ngrok...
   Application ready.
   Starting Kane...
7. See the live application browser.
8. Watch Kane interact with the application.
9. Watch live verification events.
10. Receive a final result.
11. Receive the preview URL and result through Telegram.
12. Inspect logs and evidence afterward.

The entire workflow should feel extremely fast, polished, and professional.

BUILD ORDER:

Phase 1:
Project scaffolding
Frontend
FastAPI
PostgreSQL
Redis
Docker Compose

Phase 2:
Authentication
Projects
Project upload
Project detection

Phase 3:
Docker runner
Application lifecycle
Health checks
Logs

Phase 4:
ngrok
Live preview

Phase 5:
Kane integration
Verification engine abstraction
Live verification events

Phase 6:
Live browser workspace
Terminal
Evidence
Run history

Phase 7:
GitHub OAuth
Repositories
Branches
Commits
Webhooks

Phase 8:
Telegram
Notifications
Bot commands

Phase 9:
Scheduler

Phase 10:
Security hardening
Testing
Documentation
AWS/Coolify deployment

Do not try to implement every phase in one giant file.

Build a real maintainable project with clear modules.

Start with Phase 1 and Phase 2, but structure the architecture so every later phase can plug into it without rewriting the system.

The key idea

The strongest version of this project isn't:

> "A website that runs Kane."



It's:

> "A verification infrastructure where Kane is one of the engines."



And the complete product loop becomes:

CODE
        │
        ▼
    VERIFYHUB
        │
        ▼
     DOCKER
        │
        ▼
   APPLICATION
        │
        ▼
      NGROK
        │
        ▼
       KANE
        │
        ▼
   VERIFICATION
        │
   ┌────┴────┐
   ▼         ▼
WEB HUB   TELEGRAM
   │
   ▼
EVIDENCE
   │
   ▼
GITHUB / CI

That's the product I'd build.