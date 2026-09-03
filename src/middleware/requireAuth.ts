import type { Request, Response, NextFunction } from "express";
import prisma from "../prisma.ts";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Verify Bearer token and check the session in the shared DB
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Sign in required" });
  }

  try {
    const session = await prisma.session.findUnique({ where: { token } });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: "Session expired, please sign in again" });
    }

    req.userId = session.userId;
    next();
  } catch (error) {
    console.error("Error verifying session:", error);
    res.status(500).json({ error: "Failed to verify session" });
  }
}