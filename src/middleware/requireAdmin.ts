import type { Request, Response, NextFunction } from "express";
import { authenticate } from "./requireAuth.ts";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authenticate(req);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    if (result.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.userId = result.id;
    req.userRole = result.role;
    next();
  } catch (error) {
    console.error("Error in requireAdmin:", error);
    res.status(500).json({ error: "Failed to verify admin" });
  }
}
