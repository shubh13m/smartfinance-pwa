# Repository instructions

## SmartFinance v2 (`v2/`)

The household app lives in `v2/`. The original app in the repository root is separate and
should not be modified unless asked.

### Testing policy — applies to every change under `v2/`

1. After **any** code or style change, run `npm run test:changed` from `v2/` (it selects the
   tests that cover the changed files). Fix failures before continuing.
2. Before declaring a task done, run `npm run test:all` (unit, data, UI and browser tests).
3. **New or changed behaviour must come with new or updated tests in the same change**, in the
   layer described in `v2/TESTING.md` ("Layers — where does a new test go?"). A bug fix starts
   with a test that reproduces the bug.
4. Never delete, skip or weaken an assertion just to get green. If a test is wrong, correct it and
   explain why.
5. If you add a file that the change-selector does not know about, update `RULES` in
   `v2/scripts/test-changed.mjs` and its test `v2/tests/unit/test-changed.test.js`.
6. Keep coverage at or above the gate in `npm run test:coverage` (90 % lines).

### Architecture rules (enforced by `v2/tests/unit/invariants.test.js`)

- `domain` is pure: imports only `core` and `config`.
- UI components never import `data`, `services`, `auth` or `features`.
- Features talk to the `ledger` service only — never to storage adapters or the backend.
- Only `app/bootstrap.js` chooses the backend.
- Render text with the `h()` helper (`textContent`); never `innerHTML`. No inline `style`
  attributes (the Content-Security-Policy forbids them) — set `el.style.x` from code or use CSS.
- Money is integer paise; ids are UUIDs; colours and spacing come from `v2/styles/tokens.css`.

### Commands

```
cd v2
npm run test:changed     # tests for what you changed
npm test                 # unit + data + ui (jsdom)
npm run test:e2e         # real browser, desktop + phone
npm run test:all         # everything
npm run test:coverage    # coverage with a 90 % gate
```
