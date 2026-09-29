import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "./env";

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthTokenClaims {
  id: string;
  email: string;
  role: UserRole;
}

/** Only ever sign with HS256 so a token can never be verified as "none". */
const ALGORITHM: jwt.Algorithm = "HS256";

/**
 * Single source of truth for issuing and validating GeoWake session tokens.
 * Signing (auth controller) and verification (HTTP + Socket.IO middleware)
 * both go through this module, so they can never drift onto different secrets.
 */
export const signAuthToken = (
  claims: AuthTokenClaims,
  expiresIn: string = env.jwtExpiresIn,
): string =>
  jwt.sign(
    { id: claims.id, email: claims.email, role: claims.role },
    env.jwtSecret,
    { algorithm: ALGORITHM, expiresIn } as SignOptions,
  );

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * Verifies signature, algorithm, issuer-independent expiry and claim shape.
 * Throws {@link TokenError} for anything that is not a well-formed, unexpired
 * token signed with the configured secret.
 */
export const verifyAuthToken = (token: string): AuthTokenClaims => {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new TokenError("Token is empty.");
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, env.jwtSecret, { algorithms: [ALGORITHM] });
  } catch {
    // Never surface jwt's error message: it can echo token material.
    throw new TokenError("Token is invalid or expired.");
  }

  if (typeof decoded === "string" || decoded === null) {
    throw new TokenError("Token payload is not an object.");
  }

  const { id, email, role } = decoded as JwtPayload;
  if (typeof id !== "string" || id.length === 0) {
    throw new TokenError("Token is missing a subject.");
  }
  if (typeof email !== "string" || email.length === 0) {
    throw new TokenError("Token is missing an email claim.");
  }
  if (!isUserRole(role)) {
    throw new TokenError("Token is missing a valid role claim.");
  }

  return { id, email, role };
};

/**
 * Lenient extraction for the Socket.IO handshake, where clients send the raw
 * token (`auth: { token }`) as well as an optional Authorization header.
 */
export const extractBearerToken = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const withoutScheme = trimmed.replace(/^Bearer\s+/i, "").trim();
  return withoutScheme.length > 0 ? withoutScheme : null;
};

/**
 * Strict extraction for HTTP requests: the `Authorization: Bearer <token>`
 * scheme is required, so a token pasted into another header cannot authenticate.
 */
export const extractAuthorizationHeader = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
};
