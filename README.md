# GeoWake

Smart transit geofencing and wake-up alarms.

Drop a pin anywhere on the map, choose a radius, and GeoWake rings an alarm
siren the moment you arrive. Destinations can be picked by hand, saved as
favorites, or described in plain language ("wake me up 1 km before the
airport") and resolved by an AI + geocoding pipeline.

- **`client/`** — Expo SDK 57 app (React Native Web). Map, GPS, siren, settings.
- **`server/`** — Express 5 + TypeScript API with Socket.IO, Prisma/PostgreSQL,
  Redis cache, Google sign-in and Groq-powered alarm parsing.
- **`docker-compose.yml`** — local PostgreSQL + Redis for development.

---

## Platform support: **web only**

This release is a **web application**, and that is declared explicitly in
`client/app.json`:

```json
"platforms": ["web"]
```

The product depends on browser-only capabilities: Leaflet maps, the
`navigator.geolocation` watcher, Web Audio, `localStorage`, the Google Identity
Services button and a browser file input. Expo therefore refuses to start an
iOS/Android target for this project, and `client/components/UnsupportedPlatformNotice.tsx`
renders a clear explanation if a native bundle is ever loaded, so native builds
fail loudly instead of silently misbehaving.

Scripts: `npm run start` / `npm run web` (dev server) and `npm run build:web`
(production bundle in `client/dist/`).

**To ship native later**, replace each browser dependency with its SDK 57
equivalent — `react-native-maps` (or `expo-maps`), `expo-location`,
`expo-audio`, `expo-secure-store` / `@react-native-async-storage/async-storage`,
and `expo-document-picker` — then remove the `platforms` restriction.

---

## Prerequisites

- Node.js 22.13+ (Expo SDK 57 requirement; Node 25 works)
- npm 10+
- Docker (for the local PostgreSQL and Redis) — or your own instances

---

## Local setup

### 1. Start PostgreSQL and Redis

```bash
docker compose up -d
```

This creates PostgreSQL on `localhost:5432` (`devuser` / `devpassword` /
database `geowakedb`) and Redis on `localhost:6379`. The credentials match the
defaults in `server/.env.example`.

### 2. Configure the server

```bash
cd server
cp .env.example .env
```

Then edit `server/.env` and set at least:

| Variable          | Required | Notes                                                        |
| ----------------- | -------- | ------------------------------------------------------------ |
| `DATABASE_URL`    | yes      | Matches the `docker-compose` credentials by default           |
| `JWT_SECRET`      | yes      | ≥ 32 chars. `openssl rand -base64 48`. Signs **and** verifies every token |
| `GOOGLE_CLIENT_ID`| yes      | Web client ID from Google Cloud; must equal the client's value |
| `PORT`            | no       | Defaults to `5000`                                            |
| `GROQ_API_KEY`    | no       | Without it the AI endpoint falls back to geocoding only        |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | no | Cache is optional; the API falls back to PostgreSQL |
| `CORS_ORIGIN`     | no       | Defaults to `*`; lock it down in production                   |

The server **refuses to start** when a required variable is missing, and tells
you exactly which ones — a misconfigured deploy fails immediately instead of
running with an insecure default.

### 3. Install, migrate and run

```bash
cd server
npm install
npx prisma generate     # or: npm run db:generate
npm run db:deploy       # apply migrations (use db:migrate while developing)
npm run dev             # http://localhost:5000
```

Verify it is alive:

```bash
curl http://localhost:5000/api/health
```

### 4. Configure and run the client

```bash
cd client
cp .env.example .env    # optional: the defaults already target localhost
npm install
npm start               # opens the web app
```

For a production bundle:

```bash
npm run build:web       # static output in client/dist/
```

---

## Configuration reference

Server (`server/.env`) and client (`client/.env`) templates are committed as
`*.env.example`. Client variables must be prefixed `EXPO_PUBLIC_`, which inlines
them into the public bundle — **never place a secret in one**. In particular the
Google OAuth *client secret* belongs nowhere in this repository: the browser
sends only an ID token, which the server verifies against Google's public keys
with `google-auth-library`.

---

## How authentication works

1. The browser gets a Google ID token from Google Identity Services.
2. `POST /api/auth/google` verifies that token's **RSA signature, issuer,
   audience and expiry** against the configured client ID. `jwt.decode()` is
   never used for verification.
3. On success the server upserts the user and issues a GeoWake JWT signed with
   `JWT_SECRET`. The same secret and algorithm are used for every verification
   path (HTTP middleware and the Socket.IO handshake).

Notes:

- Public registration always creates a `USER`. A `role` field in the request
  body is rejected. Promotion to `ADMIN` is an out-of-band operation:
  `npx prisma studio` or `prisma db execute`.
- The browser keeps the JWT in `localStorage` and sends it as
  `Authorization: Bearer …`.
- Socket.IO connections present the same JWT in the handshake
  (`auth: { token }`); the server derives the user from the verified claims, so
  a client can neither report another user's location nor trigger their alarms.

---

## Alarm lifecycle

`ACTIVE → TRIGGERED → DISMISSED` (or deleted by the user).

A triggered alarm is **never deleted** — it is moved to `TRIGGERED` with a
conditional update so concurrent GPS pings can only fire it once. The client
refetches alarms on every trigger, shows the history in the alarms panel, and
marks a stopped alarm `DISMISSED`.

---

## API overview

All routes except `/api/health` and the auth entry points require
`Authorization: Bearer <jwt>`.

| Method   | Path                        | Purpose                                  |
| -------- | --------------------------- | ---------------------------------------- |
| `GET`    | `/api/health`               | Liveness probe                           |
| `POST`   | `/api/auth/google`          | Verify a Google ID token, return a JWT   |
| `POST`   | `/api/auth/register`        | Public sign-up (always `USER`)           |
| `POST`   | `/api/auth/login`           | Password login                           |
| `GET`    | `/api/auth/me`              | Current profile                          |
| `GET`    | `/api/alarms`               | All alarms for the caller                |
| `POST`   | `/api/alarms`               | Create an alarm                          |
| `PATCH`  | `/api/alarms/:id/status`    | Update status                            |
| `DELETE` | `/api/alarms/:id`           | Delete one alarm                         |
| `DELETE` | `/api/alarms/clear-all`     | Delete all alarms                        |
| `GET`    | `/api/favorites`            | List favorites                           |
| `POST`   | `/api/favorites`            | Save a favorite                          |
| `DELETE` | `/api/favorites/:id`        | Delete a favorite                        |
| `POST`   | `/api/ai/parse-alarm`       | Prompt → destination + coordinates       |

All input is validated with Zod and answered with a consistent shape:
`{ "error": "..." }` for single problems, `{ "errors": ["...", "..."] }` for
validation failures. Updates and deletes return `404` when the resource does
not exist **or** does not belong to the caller.

---

## Deployment

### Server (Render or any Node host)

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Set the secrets: `JWT_SECRET` and `GOOGLE_CLIENT_ID` (plus `GROQ_API_KEY`
   and the `REDIS_*` values if you use a cache). `PORT` is injected by Render.
3. Build command: `npm install && npm run build`
   Start command: `npm start`
   Health check path: `/api/health`
4. Run migrations once per release: `npm run db:deploy`.

### Client (any static host: Render static site, Netlify, Vercel, S3, …)

1. Build command: `npm install && npm run build:web`
   Publish directory: `dist`
2. Set `EXPO_PUBLIC_API_URL` to your server's `/api` URL. If it is not set, the
   app falls back to `https://geowake-6lwr.onrender.com/api`.

### Google Cloud

In the OAuth 2.0 Web client, add your deployed origin (and `http://localhost:8081`
for development) to **Authorised JavaScript origins**. The client ID must match
`EXPO_PUBLIC_GOOGLE_CLIENT_ID` and the server's `GOOGLE_CLIENT_ID`.

---

## Validation

```bash
cd server && npm run typecheck    # tsc --noEmit
cd client && npm run typecheck    # tsc --noEmit
cd client && npx expo config --type public
```

---

## Known limitations

- Web only: no iOS/Android build (see *Platform support*).
- Geolocation requires HTTPS in production (browsers block it on plain HTTP,
  except on `localhost`).
- Browsers suspend Web Audio until the page has had a user gesture; GeoWake
  unlocks audio on the first interaction.
- The AI parser depends on Groq and the public Photon geocoder; both are given
  bounded timeouts and the parser degrades to regex + geocoding.
- Map tiles come from Esri and OpenStreetMap with no API key, which is fine for
  development but subject to their fair-use limits. CARTO's CDN now requires a
  key and answers with a placeholder tile, so it is no longer used.
- Redis is a 60-second cache; an unreachable cache degrades to PostgreSQL.
