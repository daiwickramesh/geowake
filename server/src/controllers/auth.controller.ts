import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import prisma from "../config/db";
import { env } from "../config/env";
import { signAuthToken, type UserRole } from "../config/jwt";
import {
  containsRoleField,
  googleAuthSchema,
  loginSchema,
  registerSchema,
} from "../schemas/auth.schema";
import { formatIssues } from "../schemas/common.schema";
import { AuthRequest, requireUserId } from "../middleware/auth.middleware";
import { verifyGoogleIdToken, GoogleAuthError } from "../config/google";

/**
 * bcrypt hash of a value nobody knows, used to keep the "unknown email" login
 * path the same cost as the "wrong password" path.
 */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Google sign-in.
 *
 * The ID token is verified with `google-auth-library`: RSA signature against
 * Google's published keys, `iss`, `aud` (the configured client ID) and `exp`.
 * `jwt.decode()` is never trusted — it performs no verification at all.
 */
export const googleAuth = async (req: Request, res: Response) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: formatIssues(parsed.error) });
    return;
  }

  try {
    const profile = await verifyGoogleIdToken(parsed.data.credential);

    // Single round-trip upsert keyed on the Google-verified email address.
    const user = await prisma.user.upsert({
      where: { email: profile.email },
      update: { name: profile.name },
      create: {
        name: profile.name,
        email: profile.email,
        // Google accounts never use the password flow. Store a hash of random
        // bytes so the column is never a usable/guessable credential.
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
        role: "USER",
      },
    });

    const token = signAuthToken(
      { id: user.id, email: user.email, role: user.role as UserRole },
      env.googleJwtExpiresIn,
    );

    // No emails, tokens or credential material are logged.
    console.log(`✅ Google sign-in accepted (user ${user.id}, role ${user.role})`);

    res.status(200).json({
      message: "Google sign-in successful.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      console.warn(`⚠️ Rejected Google sign-in: ${error.reason}`);
      res.status(401).json({ error: "Invalid Google credential." });
      return;
    }
    console.error("Google sign-in failed:", error);
    res.status(500).json({ error: "Failed to authenticate." });
  }
};

/** Public registration. Always creates a `USER`; `role` is not accepted. */
export const register = async (req: Request, res: Response) => {
  // Checked against the raw body: `registerSchema` strips unknown keys, so a
  // `role` field would otherwise be silently discarded instead of refused.
  if (containsRoleField(req.body)) {
    res.status(400).json({ error: "Role cannot be set through public registration." });
    return;
  }

  const validation = registerSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ errors: formatIssues(validation.error) });
    return;
  }

  const { name, email, password } = validation.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) {
      res.status(409).json({ error: "Email already exists." });
      return;
    }

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, 10),
        // Hard-coded: privilege can never be requested by the client.
        role: "USER",
      },
    });

    const token = signAuthToken({ id: user.id, email: user.email, role: user.role });

    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};

export const login = async (req: Request, res: Response) => {
  const validation = loginSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ errors: formatIssues(validation.error) });
    return;
  }

  const { email, password } = validation.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Compare against a dummy hash when the user is missing so that the
    // response time does not reveal whether the address is registered.
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(password, passwordHash);

    if (!user || !matches) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const token = signAuthToken({ id: user.id, email: user.email, role: user.role });

    res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error("Profile lookup failed:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};
