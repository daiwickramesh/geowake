import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { env } from "./env";

/**
 * Google ID token verification.
 *
 * `google-auth-library`'s `verifyIdToken` validates the RSA signature against
 * Google's rotating public keys and checks `iss`, `aud` and `exp`. Nothing
 * about the caller is trusted before this step, and the resulting claims are
 * the *only* source of the user identity used for sign-in.
 */
const client = new OAuth2Client(env.googleClientId);

export class GoogleAuthError extends Error {
  /** Machine-safe reason; never contains token or user data. */
  readonly reason: string;

  constructor(reason: string) {
    super(`Google credential rejected: ${reason}`);
    this.name = "GoogleAuthError";
    this.reason = reason;
  }
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

const isVerifiedEmail = (payload: TokenPayload): boolean =>
  payload.email_verified === true ||
  (Array.isArray(payload.email_verified) && payload.email_verified.length === 1);

export const verifyGoogleIdToken = async (idToken: string): Promise<GoogleProfile> => {
  let payload: TokenPayload;

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });
    const result = ticket.getPayload();
    if (!result) throw new GoogleAuthError("empty_payload");
    payload = result;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    // google-auth-library errors describe why verification failed (bad
    // signature, wrong audience, expired, wrong issuer) without echoing the
    // token itself, so they are safe to log.
    throw new GoogleAuthError(
      error instanceof Error ? error.message : "verification_failed",
    );
  }

  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new GoogleAuthError("unexpected_issuer");
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new GoogleAuthError("missing_email");
  }
  if (!isVerifiedEmail(payload)) {
    throw new GoogleAuthError("email_not_verified");
  }

  return {
    email: payload.email.toLowerCase(),
    name: (typeof payload.name === "string" && payload.name.trim()) || payload.email.split("@")[0],
    picture: payload.picture,
  };
};
