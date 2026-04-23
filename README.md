# LinguaFlow — AI Language Coaching System

[![CI](https://github.com/JefferyLiu6/fsi-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/JefferyLiu6/fsi-2026/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-package%20manager-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Live demo:** _coming soon_ · [Walkthrough video](#) _(placeholder)_
Try it out: https://linguaflow-demo.vercel.app 

A full-stack language learning platform that combines timed drills, route-aware AI coaching, and persistent learner progress.
It is built as a product-style system, not a chatbot demo, with explicit architecture boundaries, guardrails, and reliability checks.

## Key Highlights

- **Product scope**: timed drills, custom lists, dashboard analytics, and coaching workflows.
- **AI architecture**: FastAPI agent + LangGraph routing + deterministic JSON handling.
- **System design**: typed Next.js <-> Python API bridge with clear service boundaries.
- **Engineering quality**: CI checks for lint, type safety, tests, build, and Python syntax.

## Screenshots

**Home — drill session widget and language picker**
![Drill session](docs/screenshots/drill-session.png)

**Drill feedback + AI Tutor coaching exchange**
![Drill feedback and tutor](docs/screenshots/drill-feedback.png)

**AI Drill Generation — raw prompt mode with live preview**
![Drill generation](docs/screenshots/drill-generation.png)

**Results dashboard** — rolling accuracy, response time, training intensity heatmap
![Dashboard](docs/screenshots/dashboard.png)

## System Architecture

LinguaFlow is split into three layers: a Next.js app for UI and authenticated web routes, a Prisma-backed persistence layer for user/session data, and a FastAPI AI service for drill generation and tutoring.
The web layer owns auth and API contracts, while the agent layer owns model interaction, routing, and tutor/generation behavior.

```mermaid
flowchart LR
  subgraph browser [Browser]
    UI[Next.js App Router + React]
  end

  subgraph next [Next.js Server]
    API[Route Handlers /api/*]
    AUTH[JWT Cookie Auth]
  end

  subgraph data [Persistence]
    DB[(SQLite via Prisma)]
  end

  subgraph agent [LinguaFlow Agent — Optional]
    FASTAPI[FastAPI Service :8000]
    GEN[Generation Endpoint /generate]
    TUTOR_API[Tutor Endpoint /tutor]
    TUTOR_STREAM["Tutor Stream /tutor/stream (SSE)"]
    subgraph tutor [Tutor Graph — LangGraph]
      ROUTER[Router Node]
      HINT[Hint]
      SOCRATIC[Socratic]
      EXPLAIN[Explain]
      CLARIFY[Clarify]
      READY[Ready Check]
    end
    PROVIDERS[Provider-backed LLMs\nOpenAI · Anthropic · Google · Groq · Ollama]
  end

  UI --> API
  API --> AUTH
  API --> DB
  API -->|/api/generate-drills| FASTAPI
  API -->|/api/tutor| FASTAPI
  API -->|/api/tutor/stream| FASTAPI
  FASTAPI --> GEN
  FASTAPI --> TUTOR_API
  FASTAPI --> TUTOR_STREAM
  FASTAPI --> ROUTER
  ROUTER --> HINT
  ROUTER --> SOCRATIC
  ROUTER --> EXPLAIN
  ROUTER --> CLARIFY
  ROUTER --> READY
  GEN --> PROVIDERS
  HINT --> PROVIDERS
  SOCRATIC --> PROVIDERS
  EXPLAIN --> PROVIDERS
  CLARIFY --> PROVIDERS
  READY --> PROVIDERS
```

## Iteration History

### v1 — Timing + Feedback Loop First
- **What changed:** Implemented the strict core loop (20s timer, submit/skip/timeout paths, immediate feedback, session scoring).
- **Why:** Validate learning mechanics first before adding architecture or AI complexity.
- **Impact:** Confirmed UX viability and exposed the next bottleneck: non-persistent local state.

### v2 — Data Contracts + Persistence Boundary
- **What changed:** Added typed Next.js API routes plus Prisma models (`DrillSession`, `UserSettings`, `CustomList`).
- **Why:** Decouple UI rendering from data logic and establish stable request/response contracts.
- **Impact:** Deterministic persistence, cleaner component boundaries, and a foundation for multi-user flows.

### v3 — Isolated AI Service for Generation
- **What changed:** Introduced a separate FastAPI generation service with guided/raw modes, JSON extraction, and output filtering.
- **Why:** Keep AI failures isolated from the web app and make model/provider iteration easier.
- **Impact:** Safer AI integration; malformed model output is filtered before entering user sessions.

### v4 — Tutor Control via LangGraph
- **What changed:** Replaced one-shot tutoring with LangGraph routing (`hint`, `socratic`, `explain`, `clarify`, `ready_check`) and hint-level state.
- **Why:** Make tutor behavior controllable and resilient under ambiguous learner messages.
- **Impact:** More consistent coaching behavior through structured routing, JSON fallback, and safe defaults.

### v5 — Reliability, Security, and Failure Handling
- **What changed:** Added JWT cookie auth, protected data routes, turn caps, input validation, and clearer upstream error mapping.
- **Why:** Reduce silent failure paths and harden multi-user behavior before broader usage.
- **Impact:** More production-like reliability with clearer operational failure modes and stronger CI guarantees.

### v6 — Streaming + Deployment Preparation (current)
- **What changed:** Added `/tutor/stream` SSE, plus runtime metadata (`elapsed_ms`, `route`, `hint_level`) for observability.
- **Why:** Improve perceived responsiveness and make runtime behavior measurable for tuning and ops.
- **Impact:** End-to-end system is deployment-ready in architecture; once live, this phase will be labeled **Production Deployment**.

## Product Features

- **Core drills**: translation, substitution, transformation
- **Languages**: Spanish, French, German, Chinese, Japanese, Korean, English
- **User flows**:
  - Register/login with JWT cookie session
  - Run timed drills and receive immediate feedback
  - Track performance on a personal dashboard
  - Browse full drill library by language/topic/category
- **Optional AI capabilities**:
  - Generate custom drills via local Ollama model
  - Ask AI tutor for hints, explanations, clarifications, and readiness checks

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend (Web) | Next.js Route Handlers, TypeScript |
| Backend (AI) | FastAPI, LangGraph, OpenAI / Anthropic / Google / Groq / Ollama support |
| Data | Prisma 7, SQLite (`@prisma/adapter-libsql`) |
| Auth | `jose` (HS256 JWT in httpOnly cookie), `bcryptjs` |
| Testing | Vitest (unit + integration) |
| CI | GitHub Actions (`lint`, `tsc`, `test`, `build`, Python `py_compile`) |

## Production Profile

For local development, LinguaFlow runs with SQLite and optional local Ollama inference.

For deployment, the intended production profile is:
- Next.js frontend/web API on Vercel
- FastAPI agent on Render
- Postgres via Prisma
- Hosted LLM provider for reliable inference

This keeps the local setup lightweight while preserving a clear migration path to an internet-facing production architecture.

## Model Strategy

- **Default model profile**: `openai/gpt-4o-mini` is the baseline for tutor and generation requests because it is cost-efficient, low-latency, and strong enough for short coaching turns and drill JSON output.
- **Provider abstraction by design**: model IDs use `provider/model` format, so the same request path can run on OpenAI, Anthropic, Google, Groq, or local Ollama without changing endpoint contracts.
- **Structured outputs reduce hallucinations**: the tutor router attempts structured output first, then falls back to JSON parsing, improving route reliability for `hint`, `socratic`, `explain`, `clarify`, and `ready_check`.
- **Deterministic parsing for generation**: drill generation enforces JSON-array extraction plus schema-like field filtering (`prompt`, `answer`, type constraints) before returning results.
- **Multi-model ready for deployment tuning**: the architecture supports switching models per environment (cost, latency, quality) while keeping the frontend/API payload shape stable.

## Evaluation

Benchmark snapshot (local run, 2026-04-03, model: `openai/gpt-4o-mini`):

- **Tutor routing validity**: 15/15 prompts returned a valid route (`hint`, `socratic`, `explain`, `clarify`, `ready_check`) via `/tutor/stream`.
- **Average tutor latency**: 1.97s end-to-end over 15 streaming tutor requests.
- **Generation validity after filtering**: 12/12 generation requests returned non-empty filtered drill sets with required `prompt` + `answer` fields.
- **Average generation latency**: 6.63s over 12 guided generation requests (96 valid drills total).
- **Safety behavior**: invalid/ambiguous outputs remain bounded by route fallbacks (`socratic` default), field filtering, and explicit 4xx/5xx error mapping.

Method notes:
- Tutor benchmark used one-turn coaching prompts and validated the final SSE `route` event.
- Generation benchmark used guided mode across multiple topic/difficulty/grammar combinations.
- These are lightweight operational checks (not a formal offline eval suite), intended to show real runtime behavior on the current stack.

## Engineering Highlights

### 1) Typed cross-service API bridge
The Next.js API layer maps frontend camelCase payloads to Python snake_case contracts and maps responses back to frontend shape. This keeps the UI ergonomic without sacrificing strict backend contracts.

### 2) LangGraph tutor orchestration
The tutor service uses a router-plus-specialists graph:
- router classifies learner intent (`hint`, `socratic`, `explain`, `clarify`, `ready_check`)
- conditional edges dispatch to specialist nodes
- each specialist applies route-specific prompting policy
- guardrails enforce turn limits and stable fallback behavior

### 3) Security and session model
- Login issues a signed JWT in an `httpOnly` cookie with `SameSite=Lax`
- Protected app routes are enforced by `proxy.ts`
- Data routes require authenticated session; AI routes are restricted in production mode

### 4) Reliability workflow
- Unit tests for auth and drill logic
- Integration tests for auth flow and per-user session isolation
- CI pipeline validates code health before merge

## Agent System Design

The Python agent exposes two independent sub-systems on the same FastAPI service.

### Drill Generation (single-pass)

```mermaid
flowchart TD
  REQ[POST /generate\nGenerateRequest] --> MODE{mode?}
  MODE -->|guided| BUILD[Build guided prompt\ntopic · difficulty · grammar · count]
  MODE -->|raw| RAW[Use raw_prompt as-is]
  BUILD --> LLM[Provider model\nsingle-pass inference]
  RAW   --> LLM
  LLM   --> EXTRACT[JSON extraction\nstrip fences · parse array]
  EXTRACT --> FILTER[Filter valid drills\nprompt + answer required]
  FILTER --> RES[GenerateResponse\ndrills · model · elapsed_ms]
```

### Tutor Endpoint (non-streaming `/tutor`)

```mermaid
flowchart TD
  REQ2[POST /tutor\nTutorRequest] --> GUARD{Turn cap\nexceeded?}
  GUARD -->|yes| EARLY[Early return\nNo model call]
  GUARD -->|no| STATE[Build TutorState\ninvoke LangGraph]

  STATE --> ROUTER[Router node\nIntent classification\nstructured output + JSON fallback]

  ROUTER -->|hint| HINT[Hint node\nProgressive reveal]
  ROUTER -->|socratic| SOC[Socratic node\nGuided question]
  ROUTER -->|explain| EXP[Explain node\nGrammar/pattern focus]
  ROUTER -->|clarify| CLA[Clarify node\nInstruction disambiguation]
  ROUTER -->|ready_check| RDY[Ready-check node\nShort takeaway + continue]

  HINT --> OUT[Build TutorResponse\nassistant_message · structured · elapsed_ms]
  SOC  --> OUT
  EXP  --> OUT
  CLA  --> OUT
  RDY  --> OUT
```

### Tutor Streaming Endpoint (`/tutor/stream`)

```mermaid
flowchart TD
  SREQ[POST /tutor/stream\nTutorRequest] --> MODE{mode?}

  MODE -->|feedback| FEED[stream_feedback\nsingle prompt stream]
  FEED --> SSE1[SSE tokens\ndata: token]
  SSE1 --> DONE1[done=true]

  MODE -->|tutor| VALID{messages valid\nlast role=user?}
  VALID -->|no| E1[SSE error event]
  VALID -->|yes| CAP{turn cap\nexceeded?}
  CAP -->|yes| CAPMSG[stream cap message]
  CAPMSG --> DONE2[done=true]
  CAP -->|no| R2[router_node\nnon-stream classification]
  R2 --> SPEC["stream_specialist(route)\nchunked LLM output"]
  SPEC --> SSE2[SSE tokens\ndata: token]
  SSE2 --> META[done=true + route + hint_level]
```

**Key design decisions:**
- **Guardrail before the graph** — turn cap is enforced in the endpoint, not inside a node, so the LLM is never called unnecessarily
- **Router uses structured output with JSON fallback** — tolerates models that ignore tool-call format
- **Specialist nodes share a single `_run_specialist` helper** — prompting policy is centralized; LangGraph conditional edges select the node
- **`hint_level` increments only on the hint route** — other routes leave it unchanged, preserving progressive-reveal state across turns
- **Streaming path reuses router + specialist policies** — `/tutor/stream` keeps routing behavior aligned while delivering incremental SSE tokens

## API Surface (Web Layer)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/register` | Create user account | No |
| POST | `/api/auth/login` | Sign in and set cookie | No |
| POST | `/api/auth/logout` | Clear cookie | Cookie |
| GET | `/api/auth/me` | Return current session | Cookie |
| GET/POST | `/api/sessions` | Load/save drill sessions | Yes |
| GET/PUT | `/api/custom-list` | Load/save custom drills | Yes |
| GET/PUT | `/api/language` | Load/save preferred language | Yes |
| POST | `/api/generate-drills` | Proxy to Python generation endpoint | Dev open / Prod guarded |
| POST | `/api/tutor` | Proxy to Python tutor endpoint | Dev open / Prod guarded |
| POST | `/api/tutor/stream` | Proxy to Python SSE tutor stream endpoint | Dev open / Prod guarded |

## Data Model

Prisma schema includes:
- `User` (identity + credentials)
- `DrillSession` (session performance + serialized results)
- `CustomList` (user-generated drill sets)
- `UserSettings` (preferences such as language)

SQLite is used for local-first simplicity; migration path to Postgres is straightforward by changing Prisma provider and running migrations.

## Local Development

### Prerequisites
- Node.js 20+
- pnpm
- Python 3.10+ (only if running the AI agent)
- Ollama (only if using AI generation/tutor)

### 1) Install and run the web app

```bash
cd fsi-2026-demo
pnpm install
npx prisma generate
npx prisma db push
pnpm dev
```

Open `http://localhost:3000`.

### 2) Run optional AI agent

Terminal A:

```bash
ollama serve
ollama pull llama3.1
```

Terminal B:

```bash
cd fsi-2026-demo/agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/health
```

## Environment Variables

Create `.env.local` from `.env.example`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Prisma database URL (for SQLite: `file:./prisma/dev.db`) |
| `JWT_SECRET` | Yes | Secret for signing JWT cookies |
| `AGENT_URL` | No | Python agent base URL (default `http://localhost:8000`) |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Build production bundle |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest suite |
| `pnpm test:watch` | Run tests in watch mode |

## Quality and CI

- Test files live under `__tests__/` (unit + integration coverage)
- CI workflow in `.github/workflows/ci.yml` runs:
  - `pnpm lint`
  - `npx tsc --noEmit`
  - `pnpm test`
  - `pnpm build`
  - Python syntax checks for all agent modules

## Production Notes

- Rotate `JWT_SECRET` carefully (rotation invalidates existing sessions)
- Serve over HTTPS so secure cookies are active in production
- Add rate limiting and auth hardening around AI-heavy routes for internet-facing deployments
- For multi-instance deployments, migrate from SQLite to Postgres

## Current Limitations

- AI features depend on local Ollama availability unless replaced with hosted inference
- SQLite is optimized for local/single-node usage
- Tutor/generation endpoints currently prioritize local development ergonomics

## Roadmap

- Add end-to-end tests for critical user flows
- Add observability (request tracing and endpoint latency dashboards)
- Add model routing/fallback policies for AI endpoints
- Introduce migration-backed Postgres production profile
- Publish demo deployment and walkthrough video

## License

MIT © JL200126 — see [LICENSE](LICENSE).
