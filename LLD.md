# Low-Level Design (LLD)

This document describes the implementation-level design of GeoWake: modules,
data models, API contracts, socket protocol, algorithms, and validation.
It complements `HLD.md` (architecture) and `PRD.md` (requirements).

---

## 1. Repository Layout

```
geowake/
├── client/                 # Expo SDK 57 web app (React Native Web)
│   ├── App.tsx             # Root component, navigation, alarm orchestration
│   ├── components/         # UI (map, panels, settings, unsupported platform)
│   ├── hooks/              # useWakeEngine, useAlarms, useFavorites, ...
│   ├── lib/                # api, googleAuth, storage, theme, alarm engine
│   └── assets/
├── server/                 # Express 5 + TypeScript API
│   ├── src/
│   │   ├── server.ts       # Bootstrap: Express, Socket.IO, graceful shutdown
│   │   ├── config/         # env, db, jwt, google, groq, redis
│   │   ├── controllers/    # auth, alarm, favorite, ai
│   │   ├── middleware/     # authenticateJWT, requireRole, error handler
│   │   ├── routes/         # Express routers
│   │   ├── schemas/        # Zod validation schemas
│   │   ├── sockets/        # location.socket.ts (geofence loop)
│   │   └── utils/          # distance (haversine)
│   ├── prisma/             # schema.prisma + migrations
│   └── tests/              # security.test.ts
├── docker-compose.yml      # Postgres + Redis for local dev
├── HLD.md / PRD.md / LLD.md / README.md
```

---

## 2. Server Bootstrap (`server/src/server.ts`)

- Loads and validates environment via `config/env.ts` (fails fast on missing
  required vars).
- Creates Express app, applies JSON body parser, CORS, helmet-style headers.
- Mounts routers under `/api`:
  - `/api/health`
  - `/api/auth`
  - `/api/alarms`
  - `/api/favorites`
  - `/api/ai`
- Creates `http.Server` and attaches Socket.IO with CORS config.
- Socket.IO middleware verifies JWT from `handshake.auth.token` using the
  same `JWT_SECRET`/algorithm as HTTP.
- Registers `location.socket.ts` handlers.
- Starts listening on `PORT` (default 5000).
- Graceful shutdown on SIGTERM/SIGINT: closes HTTP server, Socket.IO, Prisma,
  Redis.

---

## 3. Configuration Modules (`server/src/config`)

| Module | Responsibility |
|--------|----------------|
| `env.ts` | Zod-validated env; exports typed `env` object; exits process on invalid/missing required vars (`DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`). |
| `db.ts` | PrismaClient singleton; logs queries in dev; disconnect on shutdown. |
| `jwt.ts` | `signToken(payload)`, `verifyToken(token)`, `extractBearer(req)` using HS256 + `JWT_SECRET`. |
| `google.ts` | `verifyGoogleIdToken(idToken)` using `google-auth-library` OAuth2Client; checks aud/iss/exp. |
| `groq.ts` | Groq client factory; `isGroqConfigured()`; timeout + max_tokens bounds. |
| `redis.ts` | ioredis client; `get`/`setex`/`del` wrappers; degrades to no-op on connection failure. |

---

## 4. Data Model (Prisma)

### 4.1 `User`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `email` | String | unique |
| `passwordHash` | String? | null for OAuth-only users |
| `name` | String? | from Google profile |
| `role` | Enum `USER`/`ADMIN` | default `USER`; registration rejects role input |
| `createdAt`, `updatedAt` | DateTime | |

### 4.2 `Alarm`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `userId` | String | FK → User |
| `title` | String | |
| `latitude` | Float | -90..90 |
| `longitude` | Float | -180..180 |
| `radiusMeters` | Int | 25..50000 |
| `status` | Enum `ACTIVE`/`TRIGGERED`/`DISMISSED` | default `ACTIVE` |
| `isFavorite` | Boolean | default false |
| `createdAt`, `updatedAt` | DateTime | |

Index: `(userId, status)` for cache-miss queries.

### 4.3 `Favorite`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `userId` | String | FK → User |
| `label` | String | |
| `latitude`, `longitude` | Float | |
| `radiusMeters` | Int | |
| `createdAt` | DateTime | |

### 4.4 `AILog`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `userId` | String | FK → User |
| `prompt` | String | raw user prompt |
| `parsedData` | Json | model output + resolved coords |
| `tokensUsed` | Int? | |
| `costEstimate` | Float? | `(tokens/1000)*0.0005` |
| `createdAt` | DateTime | |

---

## 5. Authentication & Authorization

### 5.1 Google OAuth flow

1. Client obtains Google ID token via GIS.
2. `POST /api/auth/google { id_token }`.
3. Server calls `verifyGoogleIdToken` → validates RSA signature, `aud`,
   `iss`, `exp`.
4. Upserts `User` by email (role always `USER`).
5. Issues GeoWake JWT (`sub = userId`, `email`, `role`), HS256, `JWT_SECRET`.
6. Returns `{ token }`.

### 5.2 Password auth

- `POST /api/auth/register { email, password, name? }` → bcrypt hash
  (cost 10), create User (role USER), return JWT.
- `POST /api/auth/login { email, password }` → verify hash, return JWT.
- Passwords never returned; `passwordHash` excluded from `/me`.

### 5.3 Middleware

- `authenticateJWT`: extracts Bearer token, verifies, attaches `req.user`
  (`{ id, email, role }`). Returns 401 on missing/invalid.
- `requireRole("ADMIN")`: 403 if `req.user.role !== "ADMIN"`.

### 5.4 Socket.IO handshake

- Client passes `auth: { token }`.
- Server middleware verifies token; on failure disconnects.
- On success joins room `user:${userId}`.

---

## 6. Validation Schemas (`server/src/schemas`)

All inputs validated with Zod. Errors returned as `{ errors: string[] }`.

- `auth.schema.ts`: `googleSchema`, `registerSchema`, `loginSchema`.
- `alarm.schema.ts`: `createAlarmSchema` (title min 1, lat -90..90, lng
  -180..180, radiusMeters 25..50000, isFavorite bool), `updateStatusSchema`.
- `favorite.schema.ts`: `createFavoriteSchema`.
- `ai.schema.ts`: `parseAlarmSchema` (prompt min 1, userLat/userLng optional).
- `common.schema.ts`: shared params (id).

---

## 7. API Controllers

### 7.1 `auth.controller.ts`

- `google`: verify token, upsert user, sign JWT.
- `register`: validate, hash password, create user, sign JWT.
- `login`: find user, compare hash, sign JWT.
- `me`: return `req.user` profile (no passwordHash).

### 7.2 `alarm.controller.ts`

- `list`: `findMany({ where: { userId } })`, ordered by createdAt desc.
- `create`: validate, insert with `status=ACTIVE`, userId from token.
- `updateStatus`: `updateMany({ where: { id, userId }, data: { status } })`;
  404 if count 0.
- `delete`: `deleteMany({ where: { id, userId } })`; 404 if count 0.
- `clearAll`: `deleteMany({ where: { userId } })`.

### 7.3 `favorite.controller.ts`

- `list`, `create`, `delete` (scoped by userId).

### 7.4 `ai.controller.ts` — `parseSmartAlarm` pipeline

1. Validate body.
2. Fetch user favorites (context).
3. If Groq configured: call `chat.completions.create` with system prompt
   (JSON mode), user prompt + favorites context. Timeout 4s, max_tokens 200.
4. Validate model output with `modelDestinationSchema`.
5. If no coordinates from model: geocode destination via Photon
   (`GET /api/?q=...&lat=&lon=`), timeout 5s; take `features[0]`.
6. `clampRadius` to 25..50000.
7. Insert `AILog`.
8. Return `{ title, latitude, longitude, radiusMeters }`.
9. On Groq failure/timeout: regex extract radius + Photon geocode destination.

---

## 8. Socket.IO Geofence Loop (`location.socket.ts`)

### 8.1 Events

Client → Server:
- `location:update { latitude, longitude }`

Server → Client:
- `alarm:trigger { alarmId, title, distance }`

### 8.2 Processing `location:update`

1. Extract userId from verified socket (set at handshake).
2. Join room `user:${userId}` (idempotent).
3. Read alarms from Redis key `alarms:user:${userId}`.
   - Miss: query PG `WHERE userId=? AND status=ACTIVE`, cache SETEX 60s.
4. For each active alarm:
   - `distance = haversine(lat, lng, alarm.lat, alarm.lng)`.
   - If `distance <= alarm.radiusMeters` → trigger.
5. Trigger (conditional):
   - `UPDATE alarms SET status=TRIGGERED WHERE id=? AND status=ACTIVE`.
   - If affected rows == 1:
     - `DEL alarms:user:${userId}` (invalidate cache).
     - `io.to("user:${userId}").emit("alarm:trigger", { alarmId, title, distance })`.
6. Concurrent pings: only first UPDATE affects 1 row; others 0 → no duplicate emit.

### 8.3 Haversine (`utils/distance.ts`)

Standard great-circle distance in meters using Earth radius 6371000m.
Inputs degrees; converts to radians.

---

## 9. Client Architecture

### 9.1 Entry (`client/App.tsx`)

- Loads config, theme, storage.
- Auth gate: if no JWT in localStorage → show login.
- On auth: connect Socket.IO with token; start GPS watcher; render map.

### 9.2 Key modules (`client/lib`)

| Module | Responsibility |
|--------|----------------|
| `api.ts` | fetch wrapper adding `Authorization: Bearer`; base URL from `EXPO_PUBLIC_API_URL` or default. |
| `googleAuth.ts` | Load GIS script, render button, callback with ID token. |
| `storage.ts` | localStorage guards (theme, sound, vibration, custom audio). |
| `theme.ts` | Design tokens (colors, spacing, typography). |
| `alarmEngine.ts` | Web Audio mastering chain, 8 synth presets, escalation (volume 60→100%, tempo -6%), custom MP3 playback, vibration patterns. |

### 9.3 Hooks (`client/hooks`)

- `useWakeEngine`: Socket.IO connection, GPS throttling (2s), alarm trigger handling, audio unlock on gesture.
- `useAlarms`: CRUD alarms via API; refetch on trigger.
- `useFavorites`: CRUD favorites.
- `useSettings`: persisted settings.

### 9.4 Map & GPS

- Leaflet map (OSM/Esri tiles), long-press to drop pin.
- `navigator.geolocation.watchPosition` with high accuracy; throttled updates to server (2s min interval).

---

## 10. Caching Strategy

- Redis key: `alarms:user:${userId}`, TTL 60s.
- On create/update/delete/status change of alarm: `DEL` key.
- On trigger: `DEL` key.
- Cache miss or Redis unavailable → PostgreSQL; log degradation.

---

## 11. Error Handling

- Centralized Express error handler:
  - Zod validation → 400 `{ errors }`.
  - Auth errors → 401/403 `{ error }`.
  - Not found / not owned → 404 `{ error }`.
  - Unhandled → 500 `{ error: "Internal server error" }` (no stack trace).
- Consistent shape: `{ error }` or `{ errors }`.

---

## 12. Security Controls (Implementation)

- JWT HS256 with `JWT_SECRET` (≥32 chars) for HTTP + Socket.
- Google ID token verified via `google-auth-library` (no `jwt.decode` unverified).
- All alarm/favorite queries scoped by `userId` from verified token.
- Conditional update for trigger prevents races.
- Zod bounds: lat/lng, radius 25..50000.
- `.env` git-ignored; client uses `EXPO_PUBLIC_*` only (no secrets).
- CORS configurable; no credentials (Bearer tokens).

---

## 13. Testing

- `server/tests/security.test.ts`: auth, ownership scoping, validation, trigger race.
- Setup: `server/tests/setup.ts` (test DB, env).
- Run: `cd server && npm test` (if configured) / `npm run typecheck`.

---

## 14. Deployment Artifacts

- Server build: `tsc` → `dist/`; start `node dist/server.js`.
- Client build: `expo export --platform web` → `dist/`.
- Migrations: `prisma migrate deploy`.
- Health: `GET /api/health`.

---

## Appendix: Socket Event Payloads

| Event | Direction | Payload |
|-------|-----------|---------|
| `location:update` | C→S | `{ latitude: number, longitude: number }` |
| `alarm:trigger` | S→C | `{ alarmId: string, title: string, distance: number }` |