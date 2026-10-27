# Contributing to GeoWake

Thanks for your interest in contributing! GeoWake is a web-only transit
geofencing alarm app. Please read this guide before opening a PR.

## Development Setup

1. Fork and clone the repository.
2. Start Postgres + Redis: `docker compose up -d`.
3. Server:
   ```bash
   cd server
   cp .env.example .env   # fill DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID
   npm install
   npx prisma generate
   npm run db:deploy
   npm run dev
   ```
4. Client:
   ```bash
   cd client
   cp .env.example .env   # optional
   npm install
   npm start
   ```

## Branching & Commits

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Keep commits focused; one logical change per commit.

## Code Style

- TypeScript strict mode. Run `npm run typecheck` in both `server/` and `client/`.
- Follow existing patterns: Zod for validation, Prisma for DB, design tokens for UI.
- No secrets in commits; `.env` is git-ignored.

## Tests

- Add/update tests in `server/tests/` for backend changes.
- Run `cd server && npm test` (and typecheck) before submitting.

## Pull Requests

- Fill out the PR template.
- Link related issues.
- Ensure CI/typecheck passes.
- Maintainer reviews within a few days.

## Reporting Issues

Use the issue templates (Bug report / Feature request). For security issues,
see `SECURITY.md` (do not file public issues).