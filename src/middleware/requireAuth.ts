import type { Request, Response, NextFunction } from "express";
import prisma from "../prisma.ts";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
    }
  }
}

type AuthSuccess = { ok: true; id: string; role: string };
type AuthFailure = { ok: false; status: 401 | 403; error: string };

type AccountState = {
  status: string;
  banned: boolean;
  banExpires: Date | null;
};

// A user is blocked when an admin deactivated or banned them.
// Bans with an expiry date lift themselves once that date has passed.
export function isAccountBlocked(user: AccountState) {
  if (user.status !== "active") return true;
  if (!user.banned) return false;
  return !user.banExpires || user.banExpires > new Date();
}

// Resolves the Bearer token to its user in a single query. The account
// state is read from the database on every request, so a ban takes
// effect immediately instead of when the session happens to expire.
export async function authenticate(req: Request): Promise<AuthSuccess | AuthFailure> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return { ok: false, status: 401, error: "Sign in required" };
  }

  const session = await prisma.session.findUnique({
    where: { token },
    select: {
      expiresAt: true,
      user: {
        select: { id: true, role: true, status: true, banned: true, banExpires: true },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    return { ok: false, status: 401, error: "Session expired, please sign in again" };
  }

  if (isAccountBlocked(session.user)) {
    return { ok: false, status: 403, error: "Account is not active" };
  }

  return { ok: true, id: session.user.id, role: session.user.role };
}

// Verify Bearer token, check the session and the account status
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authenticate(req);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    req.userId = result.id;
    req.userRole = result.role;
    next();
  } catch (error) {
    console.error("Error verifying session:", error);
    res.status(500).json({ error: "Failed to verify session" });
  }
}
