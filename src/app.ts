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
        isBestSeller: false,
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

export default app;