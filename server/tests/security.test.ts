/**
 * Dependency-free checks for the security-critical pure logic.
 *
 * Run with:  npm test        (or: npx tsx tests/security.test.ts)
 *
 * These cover the failure modes that otherwise require a live database or a real
 * Google client: privilege escalation, forged tokens, schema boundaries and the
 * authorization-header contract.
 */
import "./setup";
import assert from "node:assert/strict";

import {
  extractAuthorizationHeader,
  extractBearerToken,
  signAuthToken,
  verifyAuthToken,
} from "../src/config/jwt";
import { containsRoleField, googleAuthSchema, registerSchema } from "../src/schemas/auth.schema";
import { createAlarmSchema, updateAlarmStatusSchema } from "../src/schemas/alarm.schema";
import { createFavoriteSchema } from "../src/schemas/favorite.schema";
import { clampRadius } from "../src/controllers/ai.controller";
import { MAX_RADIUS_METERS, MIN_RADIUS_METERS } from "../src/schemas/common.schema";
import { env } from "../src/config/env";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}

console.log("\nprivilege escalation");

test("a registration body declaring a role is refused", () => {
  assert.equal(containsRoleField({ name: "M", email: "m@e.com", password: "hunter2", role: "ADMIN" }), true);
  assert.equal(containsRoleField({ name: "B", email: "b@e.com", password: "hunter2" }), false);
  assert.equal(containsRoleField(null), false);
  assert.equal(containsRoleField("role"), false);
  assert.equal(containsRoleField(undefined), false);
});

test("registerSchema never forwards a role to the database layer", () => {
  const parsed = registerSchema.parse({
    name: "Bob",
    email: "b@example.com",
    password: "hunter2",
    role: "ADMIN",
  });
  assert.equal("role" in parsed, false);
  assert.deepEqual(Object.keys(parsed).sort(), ["email", "name", "password"]);
});

test("registerSchema rejects weak or malformed input", () => {
  const cases = [
    { name: "B", email: "b@e.com", password: "123456" },
    { name: "Bob", email: "nope", password: "123456" },
    { name: "Bob", email: "b@e.com", password: "12345" },
    { name: "Bob", email: "b@e.com", password: "x".repeat(201) },
    { name: "x".repeat(121), email: "b@e.com", password: "123456" },
    {},
  ];
  for (const body of cases) {
    assert.equal(registerSchema.safeParse(body).success, false, `expected rejection: ${JSON.stringify(body)}`);
  }
});

console.log("\ngoogle credential validation");

test("non-string and oversized credentials are rejected", () => {
  assert.equal(googleAuthSchema.safeParse({ credential: 12345 }).success, false);
  assert.equal(googleAuthSchema.safeParse({}).success, false);
  assert.equal(googleAuthSchema.safeParse({ credential: "a".repeat(20_001) }).success, false);
});

console.log("\njwt signing and verification");

test("a server-signed token verifies and yields its claims", () => {
  const claims = verifyAuthToken(signAuthToken({ id: "user-1", email: "a@b.com", role: "USER" }));
  assert.equal(claims.id, "user-1");
  assert.equal(claims.email, "a@b.com");
  assert.equal(claims.role, "USER");
});

test("a tampered signature is rejected", () => {
  const token = signAuthToken({ id: "user-1", email: "a@b.com", role: "USER" });
  assert.throws(() => verifyAuthToken(`${token.slice(0, -3)}abc`));
});

test("garbage tokens are rejected", () => {
  for (const bad of ["", "   ", "not.a.token", "a", "....", "null", "undefined"]) {
    assert.throws(() => verifyAuthToken(bad), `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("an unsigned alg:none token claiming ADMIN is rejected", () => {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = b64({ alg: "none", typ: "JWT" });
  const payload = b64({ id: "attacker", email: "a@b.com", role: "ADMIN", exp: 9999999999 });
  assert.throws(() => verifyAuthToken(`${header}.${payload}.`));
});

test("an expired token is rejected", () => {
  assert.throws(() => verifyAuthToken(signAuthToken({ id: "u", email: "a@b.com", role: "USER" }, "-1s")));
});

test("a token missing a role claim is rejected", () => {
  // Forge with the real secret so only the claim shape is wrong.
  const jwt = require("jsonwebtoken");
  const token = jwt.sign({ id: "u", email: "a@b.com" }, env.jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
  assert.throws(() => verifyAuthToken(token));
});

test("a token with an unknown role is rejected", () => {
  const jwt = require("jsonwebtoken");
  const token = jwt.sign({ id: "u", email: "a@b.com", role: "SUPERUSER" }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  assert.throws(() => verifyAuthToken(token));
});

console.log("\nauthorization header contract");

test("only a well-formed Bearer header authenticates over HTTP", () => {
  assert.equal(extractAuthorizationHeader("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractAuthorizationHeader("bearer abc.def.ghi"), "abc.def.ghi");
  for (const bad of [
    undefined,
    null,
    42,
    "",
    "   ",
    "abc.def.ghi",
    "Basic abc",
    "Bearer",
    "Bearer    ",
    "Bearer a b",
    "Bearer abc, Bearer def",
    "Token abc",
    "abc.def.ghi Bearer",
  ]) {
    assert.equal(extractAuthorizationHeader(bad), null, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("the socket handshake still accepts a raw token", () => {
  assert.equal(extractBearerToken("abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken({}), null);
});

console.log("\ncoordinate and radius boundaries");

test("Null Island (0,0) is a legitimate destination", () => {
  assert.equal(createAlarmSchema.safeParse({ title: "Null Island", latitude: 0, longitude: 0, radiusMeters: 500 }).success, true);
  assert.equal(createFavoriteSchema.safeParse({ label: "Null Island", latitude: 0, longitude: 0 }).success, true);
});

test("out-of-range, non-numeric and missing coordinates are rejected", () => {
  for (const body of [
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: "abc", longitude: 0 },
    { latitude: "", longitude: 0 },
    { latitude: null, longitude: 0 },
    { longitude: 0 },
    { latitude: 1 },
  ]) {
    assert.equal(
      createAlarmSchema.safeParse({ ...body, title: "x", radiusMeters: 500 }).success,
      false,
      `expected rejection: ${JSON.stringify(body)}`,
    );
  }
  assert.equal(
    createAlarmSchema.safeParse({ title: "x", latitude: Number.NaN, longitude: 0, radiusMeters: 500 }).success,
    false,
  );
  assert.equal(
    createAlarmSchema.safeParse({ title: "x", latitude: 0, longitude: Number.POSITIVE_INFINITY, radiusMeters: 500 }).success,
    false,
  );
});

test("radius bounds are enforced and the default is applied when omitted", () => {
  for (const radiusMeters of [0, -1, MIN_RADIUS_METERS - 1, MAX_RADIUS_METERS + 1, Number.NaN, "x"]) {
    assert.equal(
      createAlarmSchema.safeParse({ title: "x", latitude: 1, longitude: 1, radiusMeters }).success,
      false,
      `expected rejection for radius ${radiusMeters}`,
    );
  }
  const omitted = createAlarmSchema.parse({ title: "x", latitude: 1, longitude: 1 });
  assert.equal(omitted.radiusMeters, 500);
  assert.equal(createAlarmSchema.safeParse({ title: "x", latitude: 1, longitude: 1, radiusMeters: MIN_RADIUS_METERS }).success, true);
  assert.equal(createAlarmSchema.safeParse({ title: "x", latitude: 1, longitude: 1, radiusMeters: MAX_RADIUS_METERS }).success, true);
});

test("titles and labels are length bounded", () => {
  assert.equal(createAlarmSchema.safeParse({ title: "", latitude: 1, longitude: 1 }).success, false);
  assert.equal(createAlarmSchema.safeParse({ title: "x".repeat(121), latitude: 1, longitude: 1 }).success, false);
  assert.equal(createFavoriteSchema.safeParse({ label: "", latitude: 1, longitude: 1 }).success, false);
  assert.equal(createFavoriteSchema.safeParse({ label: "x".repeat(81), latitude: 1, longitude: 1 }).success, false);
});

test("status transitions are constrained to the alarm lifecycle", () => {
  for (const status of ["ACTIVE", "TRIGGERED", "DISMISSED", "INACTIVE"]) {
    assert.equal(updateAlarmStatusSchema.safeParse({ status }).success, true, `expected ${status} to be allowed`);
  }
  for (const status of ["PENDING", "", "active", 1, null, undefined, "TRIGGERED' OR 1=1"]) {
    assert.equal(updateAlarmStatusSchema.safeParse({ status }).success, false, `expected ${String(status)} to be rejected`);
  }
});

console.log("\nai radius sanitising");

test("clampRadius keeps model output inside the supported range", () => {
  assert.equal(clampRadius(3000), 3000);
  assert.equal(clampRadius(MIN_RADIUS_METERS), MIN_RADIUS_METERS);
  assert.equal(clampRadius(MAX_RADIUS_METERS), MAX_RADIUS_METERS);
  for (const bad of [0, -500, 999_999, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
    assert.equal(clampRadius(bad), 500, `expected fallback for ${String(bad)}`);
  }
});

console.log("\nstartup configuration");

test("the configured JWT secret meets the minimum length", () => {
  assert.ok(env.jwtSecret.length >= 32, "JWT_SECRET must be at least 32 characters");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
