# Testing Rules (Index)

This repository uses a single source of truth for test policy and structure per application.

- Server testing rules (authoritative): `apps/server/TESTING.md:1`
- Test DB setup: `docs/DB_SETUP.md:29`

Notes
- The rules live close to the code of each app (monorepo pattern). This file exists to make discovery easy from the docs index.
- For run scripts and Jest config, see `apps/server/package.json` and `apps/server/jest.config.cjs`.

