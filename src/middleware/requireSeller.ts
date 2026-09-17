import type { Request, Response, NextFunction } from "express";
import { authenticate } from "./requireAuth.ts";

export async function requireSeller(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authenticate(req);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    if (result.role !== "seller") {
      return res.status(403).json({ error: "Seller access required" });
    }

    req.userId = result.id;
    req.userRole = result.role;
    next();
  } catch (error) {
    console.error("Error in requireSeller:", error);
    res.status(500).json({ error: "Failed to verify seller" });
  }
}
