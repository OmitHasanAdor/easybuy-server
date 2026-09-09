import type { Request, Response, NextFunction } from "express";
import prisma from "../prisma.ts";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
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

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, status: true },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (user.status !== "active") {
      return res.status(403).json({ error: "Account is not active" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.userId = user.id;
    next();
  } catch (error) {
    console.error("Error in requireAdmin:", error);
    res.status(500).json({ error: "Failed to verify admin" });
  }
}