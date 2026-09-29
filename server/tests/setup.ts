/**
 * Test bootstrap. MUST be the first import in any test file.
 *
 * `src/config/env.ts` intentionally throws on missing required variables, so the
 * test suite supplies non-secret placeholders before anything else loads. The
 * values are throwaway: no test performs a real Google verification or opens a
 * database connection.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/geowake_test";
process.env.JWT_SECRET ??= "test-only-secret-not-used-in-any-real-deployment";
process.env.GOOGLE_CLIENT_ID ??= "000000000000-testclientid000000000000000000000000.apps.googleusercontent.com";

export {};
