# Testing SmartFinance v2

The test suite is the safety net for every change. Run the part that matches your change,
and run all of it before you finish.

## Commands (run from `v2/`)

| Command | What it runs | Time |
| --- | --- | --- |
| `npm run test:changed` | **Only the tests that cover what you changed** (see below) | seconds – 1 min |
| `npm test` | Unit + data + UI (jsdom) layers | ~30 s |
| `npm run test:e2e` | Real-browser flows (desktop **and** phone viewport) | ~2 min |
| `npm run test:all` | Everything above | ~3 min |
| `npm run test:coverage` | Non-browser layers with a **90 % line-coverage gate** | ~40 s |
| `SHOT_DIR=./shots npm run test:e2e -- visual` | Also saves design screenshots | |

First time only: `npm ci` then `npx playwright install chromium`.
Set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser instead.

## The rule

1. **After any change, run `npm run test:changed`.** It maps changed files to the smallest
   sufficient set of tests (`--dry` shows the plan, `--base main` compares with a branch,
   `--all` forces everything).
2. **Before finishing a task or opening a PR, run `npm run test:all`.**
3. **New or changed behaviour needs new or updated tests in the same change.** A fix for a bug
   starts with a test that fails for that bug.
4. Never delete or loosen an assertion to make a test pass. If a test is wrong, fix it and say why.

## Layers — where does a new test go?

| You changed… | Add the test in | Style |
| --- | --- | --- |
| Pure logic: `src/domain`, `src/core`, `src/config` | `tests/unit/` | Plain `node:test`, no DOM |
| SQL schema `db/*.sql` | `tests/unit/schema.test.js` | Static checks of RLS, constraints, grants |
| Storage, services, auth, importer | `tests/data/` | Contract tests; fake Supabase in `tests/helpers/fakeSupabase.js` |
| Components, one screen's rendering/behaviour | `tests/ui/` | jsdom + `makeViewCtx()` from `tests/helpers/fixtures.js` |
| Boot, sign-in, sharing between two people, failures | `tests/ui/app.integration.test.js` | Real `start()` against local and fake-cloud backends |
| Colours, spacing, theme | `tests/unit/design-tokens.test.js` | Token usage + WCAG contrast |
| Service worker, manifest, `index.html`, theme boot | `tests/unit/service-worker.test.js`, `theme-boot.test.js`, `invariants.test.js` | |
| A user journey, layout, accessibility, offline | `tests/e2e/*.spec.js` | Playwright; page object in `tests/e2e/helpers.js` |
| Overflow and spacing on every screen (320–1280px, light and dark) | `tests/e2e/layout.spec.js` | Uses deliberately awkward data from `tests/e2e/seed.js` (long names, big amounts, long notes) |

### Architecture and security invariants (always enforced)

`tests/unit/invariants.test.js` fails the build if:

- source uses `innerHTML`, `eval`, `document.write` or inline `style` attributes;
- `index.html` loses its strict Content-Security-Policy;
- a `service_role` key is committed;
- `domain` imports UI/data code, UI components import data/features, or a feature talks to a
  storage adapter or the backend directly;
- a route lacks a title, icon or renderer.

`tests/unit/schema.test.js` fails if a table is added without row-level security, a policy is
`using (true)`, an RPC becomes callable by anonymous users, or the SQL and the validators drift apart.

## Adding a screen — checklist

1. `src/features/<name>/view.js` + one line in `src/app/router.js`.
2. A `tests/ui/<name>.test.js` covering empty state, data, every action and every error.
3. An `e2e` flow in a spec (desktop and mobile run automatically).
4. `npm run test:all`.

## What is *not* covered, honestly

- `db/001`–`006` are checked statically (guarded, re-runnable, no pgcrypto calls under a pinned
  `search_path`) and run against the fake backend, but are **not** executed against a real Postgres
  or Supabase project by these tests. Apply it to a staging project and run a manual
  two-account smoke test before trusting it with real data.
- Realtime and auth use a faithful in-memory fake (`fakeSupabase.js`), not the live service.
- The Google-Drive backup of the original app (repo root) is not part of v2 and is not tested here.
