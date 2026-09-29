import { Request, Response, NextFunction } from "express";
import {
  extractAuthorizationHeader,
  TokenError,
  type UserRole,
  verifyAuthToken,
} from "../config/jwt";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export const authenticateJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const token = extractAuthorizationHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    req.user = verifyAuthToken(token);
    next();
  } catch (error) {
    const reason =
      error instanceof TokenError ? error.message : "Invalid or expired token.";
    res.status(401).json({ error: reason });
  }
};

/**
 * Role-based authorization check. Always runs after {@link authenticateJWT}
 * and re-reads the role from the *verified* token, never from request input.
 */
export const requireRole = (role: UserRole) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: `Forbidden: requires ${role} role.` });
      return;
    }
    next();
  };
};

/**
 * Guards handlers that must not run without a verified subject.
 * Returns the user id, or `null` after having already sent a 401.
 */
export const requireUserId = (req: AuthRequest, res: Response): string | null => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  return req.user.id;
};
