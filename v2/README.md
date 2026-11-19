# SmartFinance v2 — shared household budgeting

Two (or more) people share one set of income, expenses, recurring bills and goals,
with a 50/30/20 plan and combined or per-person views. The original app in the repo
root is untouched; v2 lives here and can import its data.

## Run locally (no account needed)

```
cd v2
npm ci
npm run serve      # http://localhost:8080/v2/
npm run test:all   # unit + data + UI + real-browser tests (see TESTING.md)
```

With no backend configured the app runs in **local mode**: data stays in this browser,
and you can add a second name to try the two-person views on one device.

## Turn on sharing between two phones (Supabase)

1. Create a Supabase project and run every file in [db/](db) in order (`001` to `006`) in the
   SQL editor. Paste the file contents, not the file name. All of them are safe to re-run.
2. In Authentication settings, enable email sign-in.
3. Put the project URL and **anon** key in [src/config/env.js](src/config/env.js).
   The anon key is public by design; row-level security is what protects the data.
   Never put a `service_role` key in this repo.
4. One of you signs up and creates a household, then shares the invite code from
   Settings. The other signs up and joins with it.

Changes made by either person appear on the other's screen through realtime updates.

## Structure

| Folder | Responsibility |
| --- | --- |
| `src/domain` | Pure business rules (50/30/20, recurring, summaries, goals, validation). No DOM, no network. |
| `src/data` | Storage adapters (IndexedDB, Supabase, in-memory) behind one contract, plus the v1 importer. |
| `src/services` | `ledger.js`: validates input, stamps ownership, scopes everything to the household. |
| `src/auth` | Local and Supabase sign-in behind one interface. |
| `src/features` | One folder per screen. Add a screen = a new folder + one line in `src/app/router.js`. |
| `src/ui`, `src/core` | Shared components, icons, theme and utilities (safe DOM builder, money, dates). |
| `styles` | Design system: `tokens.css` (colour/spacing/shadow, light + dark), `base.css`, `components.css`, `layout.css`. |
| `db` | SQL schema and row-level-security policies. |
| `tests`, `scripts` | The test suite and the `test:changed` selector. See [TESTING.md](TESTING.md). |

Rules: `features → services → data`, `domain` imports nothing, UI never calls the backend directly.
Money is stored as integer paise, ids are UUIDs, and text is rendered with `textContent` only.

## Design system

Every colour, radius and shadow comes from `styles/tokens.css`; pages are composed only from the
classes in `components.css`. It ships light and dark themes (follows the OS until you choose,
applied before first paint), a sidebar layout on desktop and bottom tabs plus a floating
"New entry" button on phones, and WCAG-AA contrast checked by tests.

## Testing

`npm run test:changed` runs only what your change affects; `npm run test:all` runs everything.
New or changed behaviour must ship with tests — the rules are in [TESTING.md](TESTING.md) and
`.github/copilot-instructions.md`, and CI runs the full suite on every pull request.

## Why it feels fast

- **Your changes show instantly.** The ledger announces a write before the server answers, the
  cache (`src/services/dataCache.js`) patches the screen, and a rejected write is undone with a
  message (an entry form reopens with what you typed).
- **The other phone is patched, not reloaded.** Realtime events carry the changed row. Only
  member changes, or a reconnect after a dropped connection, trigger a full re-read.
- **Launches are quick.** The service worker opens files from its cache and refreshes them in the
  background, so a new deploy appears on the **second** launch after it ships.

## Known limits

- Edits need a connection in cloud mode; there is no offline write queue yet.
- The v1 importer is not idempotent. It asks before importing a second time.
- `db/001_init.sql` has not been run against a live Supabase project in this repo's tests.
