// Postgres INT columns top out at 2^31 - 1; anything bigger makes Prisma throw.
const MAX_INT_ID = 2_147_483_647;

// Parses a route param like "42" into a positive integer id.
// Returns null for anything else ("abc", "1.5", "-3", "99999999999"),
// so callers can answer with 400/404 instead of letting Prisma blow up.
export function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return id > 0 && id <= MAX_INT_ID ? id : null;
}
