import express from "express";
import cors from "cors";
import { z } from "zod";
import prisma from "./prisma.ts";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("EasyBuy Server is Running");
});

// validates query params for the search/filter endpoint below
const productQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});

app.get("/api/products", async (req, res) => {
  try {
    const parsed = productQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query params", errors: parsed.error.issues });
    }
    const { search, category, minPrice, maxPrice } = parsed.data;

    const products = await prisma.product.findMany({
      where: {
        ...(search && { name: { contains: search, mode: "insensitive" } }),
        ...(category && { category }),
        ...((minPrice !== undefined || maxPrice !== undefined) && {
          price: {
            ...(minPrice !== undefined && { gte: minPrice }),
            ...(maxPrice !== undefined && { lte: maxPrice }),
          },
        }),
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// best sellers only
app.get("/api/products/best-sellers", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isBestSeller: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch best sellers" });
  }
});

// products on active sale
app.get("/api/products/flash-sale", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        discountPercent: { gt: 0 },
        saleEndsAt: { gt: new Date() },
      },
      orderBy: { saleEndsAt: "asc" },
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch flash sale products" });
  }
});

// category names, used for navbar + featured categories
app.get("/api/categories", async (req, res) => {
  try {
    const categories = await prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
    });
    res.json(categories.map((c) => c.category));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
});

// single product by id
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

// orders for a given user, with their line items and product details
app.get("/api/orders", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "User ID is required" });
  }
  try {
    const orders = await prisma.order.findMany({
      where: {
        userId,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    return res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({
      error: "Failed to fetch orders",
    });
  }
});

// look up a user's role/status by email
app.get("/user-role", async (req, res) => {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // block banned/inactive accounts from getting a role back
    if (user.status !== "active") {
      return res.status(403).json({ error: "Account is not active" });
    }
    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user role:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default app;