# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (latest) | ✅ |
| older commits | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email the maintainer at **daiwickramesh1999@gmail.com** with:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

You will receive an acknowledgment within 72 hours. We aim to release a fix
within 14 days for confirmed issues and will coordinate disclosure.

## Security Notes

- JWTs are signed/verified with `JWT_SECRET` (HS256); keep it ≥32 chars.
- Google ID tokens are verified via `google-auth-library` (signature, aud,
  iss, exp); `jwt.decode()` is never used for verification.
- All alarm/favorite access is scoped by the authenticated user's ID.
- Secrets belong in `.env` (git-ignored) or the platform secret store, never
  in the client bundle (`EXPO_PUBLIC_*` is public).