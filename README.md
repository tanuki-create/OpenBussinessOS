# Open Business OS

Open Business OS is a mobile-first, low-cost operating system for turning a rough business idea into a business map, assumptions, two-week initiatives, implementation work items, review loops, and a project memory graph.

The current repository is a dependency-light MVP that runs locally with Node.js 22. It works out of the box in deterministic sample mode, so you can try the full workflow without creating an LLM account or paying for API calls.

## What You Can Do Today

- Create a local workspace.
- Enter a one-sentence business idea.
- Generate staged intake questions.
- Generate a business map with target users, assumptions, risks, and metrics.
- Generate initiatives and implementation work items.
- Approve playbook output before it mutates project state.
- Review work and keep lessons in project memory.
- Inspect a Memory Graph and Project Memory Summary.
- Draft a GitHub Issue from a WorkItem through a ToolAction draft.
- Export the current project as Markdown.
- Track estimated LLM cost and monthly budget usage.

## Requirements

- Node.js 22 or newer
- npm
- Docker, only if you want to run the PostgreSQL mode locally

No database or external API key is required for the default local workflow.

## Setup

Clone the repository and enter the project directory:

```sh
git clone <your-repo-url>
cd OpenBussinessOS
```

Install the npm project:

```sh
npm install
```

The app currently has no required runtime dependencies beyond Node.js, but running `npm install` keeps your local setup aligned with the npm project and future dependency additions.

Optional: create a local environment file.

```sh
cp .env.example .env
```

You can skip this step if you only want to use sample mode.

## Start the App

Run the local server:

```sh
npm run dev
```

Open the app in your browser:

```txt
http://localhost:3000
```

The same server provides both the API and the mobile PWA shell.

To run with PostgreSQL as the backing store:

```sh
docker compose up -d
OPEN_BUSINESS_OS_STORE=postgres npm run dev
```

The server applies `packages/db/schema.sql` on startup unless `OPEN_BUSINESS_OS_INIT_DB=0` is set.

## First Run Workflow

1. Create a workspace from the setup screen.
2. Choose `Sample` or leave the AI key for later.
3. Enter a short business idea, for example:

   ```txt
   An AI tool that helps small product teams turn rough ideas into two-week validation plans.
   ```

4. Generate intake questions and answer the ones that matter.
5. Generate the Business Map.
6. Open the Memory view and approve the latest playbook output.
7. Generate initiatives and WorkItems.
8. Create a GitHub Issue draft from a WorkItem if you want to test the ToolAction flow.
9. Add a review after you have evidence or learnings.
10. Export the project as Markdown.

The UI is designed for phone-sized screens, but it also works in a desktop browser.

## Sample Mode and Live LLM Mode

By default, Open Business OS uses deterministic sample output. This keeps the project usable without network access and makes tests stable.

To use a live DeepSeek-compatible API path, start the server with:

```sh
OPEN_BUSINESS_OS_LIVE_LLM=1 DEEPSEEK_API_KEY=your_key_here npm run dev
```

You can also save a workspace API key from the Settings screen. API keys are encrypted on the server and are not returned to the browser, Markdown export, or smoke test output.

High-quality mode requires explicit approval before execution. The API also checks estimated live LLM cost against the workspace monthly budget before running.

Live LLM output is parsed and schema-validated before it can be saved to project state. If live output is invalid JSON or fails the task schema, the server attempts one repair prompt; if repair fails, it records a failed `ai_run` and returns a reviewable error payload without applying invalid output.

## GitHub Issue Execution

GitHub Issue ToolActions always require approval before execution. Without an app GitHub token, execution completes as a dry-run so the approval flow remains testable offline.

To create real issues after approval, start the server with:

```sh
OPEN_BUSINESS_OS_GITHUB_TOKEN=github_pat_here \
OPEN_BUSINESS_OS_GITHUB_REPOSITORY=owner/repo \
npm run dev
```

You can also set `OPEN_BUSINESS_OS_GITHUB_OWNER` and `OPEN_BUSINESS_OS_GITHUB_REPO` instead of `OPEN_BUSINESS_OS_GITHUB_REPOSITORY`. On successful real execution, the source WorkItem stores `external_provider`, `external_id`, and `external_url`.

## Authentication Mode

The default `OPEN_BUSINESS_OS_AUTH_MODE=local` keeps local development and tests zero-config. It authenticates as the built-in local user, and the `x-open-business-os-role` header remains available only in this mode for RBAC checks.

For a self-hosted token-gated MVP, start with token mode:

```sh
OPEN_BUSINESS_OS_AUTH_MODE=token OPEN_BUSINESS_OS_API_TOKEN=change-me npm run dev
```

The API accepts bearer tokens, `x-open-business-os-token` / `x-api-token`, and the `obos_session` session cookie. Use `OPEN_BUSINESS_OS_AUTH_TOKENS` to map multiple tokens to existing user ids, for example `{"owner-token":{"userId":"..."}}`. In token mode, `/api/v1/me` reflects the authenticated user, workspace reads are membership-scoped, and write endpoints reject missing or invalid tokens.

## Useful Commands

Run a quick syntax check:

```sh
npm run check
```

Run unit tests:

```sh
npm test
```

Run the browserless mobile E2E/PWA contract check:

```sh
npm run test:e2e
```

Run the CI-friendly verification bundle that does not need a listening server:

```sh
npm run verify
```

Run the smoke workflow:

```sh
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

The smoke test expects the local server to already be running. `test:e2e` starts no browser and opens no port; it validates the mobile-critical static PWA assets plus the API workflow contract through the in-process handler. A Playwright mobile viewport/screenshot suite remains the follow-up for real rendering and overlap checks.

Full local verification before a handoff:

```sh
npm run verify
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

For PostgreSQL smoke testing, start the server in PostgreSQL mode first:

```sh
docker compose up -d
OPEN_BUSINESS_OS_STORE=postgres npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

## Local Data

The local JSON store is written under:

```txt
data/open-business-os.json
```

The `data/` directory is ignored by Git. If you want to start from a clean local workspace, stop the server and remove that file.

## Current Architecture

- `apps/api/src/server.js` serves the JSON API and the static PWA files.
- `apps/api/src/store.js` provides the local JSON store.
- `apps/api/src/repositories/` contains JSON and PostgreSQL store/runtime support.
- `apps/web/public/` contains the dependency-free mobile PWA.
- `packages/llm-gateway/` contains sample output, cost estimation, and DeepSeek-compatible request helpers.
- `packages/schemas/` validates structured AI output.
- `packages/security/` handles encryption, redaction, RBAC, and audit helpers.
- `packages/db/schema.sql` is the target PostgreSQL schema.

## Database

The default local mode uses a JSON store for zero-friction development. PostgreSQL runtime mode is also available through `OPEN_BUSINESS_OS_STORE=postgres` and `DATABASE_URL`.

Long-term project memory is represented as:

- `memory_nodes`
- `memory_edges`
- `project_memory_summaries`

See [packages/db/schema.sql](packages/db/schema.sql) and [docs/implementation-details.md](docs/implementation-details.md) for the database and memory design.

## Documentation

- [Detailed design](open_business_os_detailed_design.md)
- [Implementation details](docs/implementation-details.md)
- [Next actions](docs/next-actions.md)

## Project Status

This is still an MVP, but the main local workflow, token-based auth, PostgreSQL runtime path, GitHub Issue ToolAction execution, Memory Graph, and browserless mobile E2E contract are now in place. The next major work is OIDC/secure-cookie auth, durable async queues, provider fallback, and Playwright-based mobile visual regression.
