/**
 * Cheap invite-only gate for early access. Checked at account *creation*
 * time only (registration, first-ever Google sign-in) — never at login, so
 * removing someone from the list later doesn't lock out an existing user.
 * Unset `ALLOWED_SIGNUP_EMAILS` to open signup to everyone without touching
 * this code.
 */
export function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_SIGNUP_EMAILS;
  if (!raw) return true;
  const allowed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}
