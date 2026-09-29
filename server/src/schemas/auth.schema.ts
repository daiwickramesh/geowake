import { z } from "zod";

/**
 * Public registration payload.
 *
 * `role` is intentionally NOT part of this schema. Public sign-up always
 * creates a `USER`; elevation to `ADMIN` must be performed out-of-band by the
 * project owner (Prisma Studio / `prisma db execute`), never from request
 * input. `containsRoleField` is checked against the raw body by the controller,
 * because Zod strips unknown keys before any refinement runs.
 */
export const registerSchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name must be at most 120 characters"),
  email: z
    .string({ message: "Email is required." })
    .trim()
    .email("Invalid email address")
    .max(254, "Email is too long"),
  password: z
    .string({ message: "Password is required." })
    .min(6, "Password must be at least 6 characters long")
    .max(200, "Password must be at most 200 characters"),
});

/** True when a caller tried to choose its own role. */
export const containsRoleField = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "role" in (body as object);

export const loginSchema = z.object({
  email: z
    .string({ message: "Email is required." })
    .trim()
    .email("Invalid email address")
    .max(254, "Email is too long"),
  password: z.string({ message: "Password is required." }).min(1, "Password is required").max(200),
});

/** Google Identity Services hands back an OIDC ID token in `credential`. */
export const googleAuthSchema = z.object({
  credential: z
    .string({ message: "Google credential is required." })
    .trim()
    .min(20, "Google credential is required.")
    .max(8192, "Google credential is too long."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
