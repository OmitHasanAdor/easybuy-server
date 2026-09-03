import express from "express";
import cors from "cors";
import { z } from "zod";
import prisma from "./prisma.ts";
import { requireAuth } from "./middleware/requireAuth.ts";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("EasyBuy Server is Running");
});

// validates query params for the search filter 
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
      include: { reviews: { select: { rating: true } } },
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
      include: { reviews: { select: { rating: true } } },
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
      include: { reviews: { select: { rating: true } } },
      orderBy: { saleEndsAt: "asc" },
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch flash sale products" });
  }
});

// categories list
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

// product details, including variants and reviews
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        variants: true,
        reviews: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } },
        },
      },
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

// related products
app.get("/api/products/:id/related", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const current = await prisma.product.findUnique({ where: { id: productId } });
    if (!current) {
      return res.status(404).json({ message: "Product not found" });
    }
    const related = await prisma.product.findMany({
      where: {
        category: current.category,
        id: { not: productId },
      },
      include: { reviews: { select: { rating: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    res.json(related);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch related products" });
  }
});

//orders routes
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

// user role route
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

// wishlist routes
app.get("/api/wishlist", requireAuth, async (req, res) => {
  try {
    const wishlist = await prisma.wishlist.findMany({
      where: { userId: req.userId! },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(wishlist);
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    res.status(500).json({ error: "Failed to fetch wishlist" });
  }
});

const wishlistBodySchema = z.object({
  productId: z.coerce.number().int().positive(),
});

// add a product to a user's wishlist
app.post("/api/wishlist", requireAuth, async (req, res) => {
  const parsed = wishlistBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { productId } = parsed.data;
  const userId = req.userId!;
  try {
    const entry = await prisma.wishlist.upsert({
      where: { userId_productId: { userId, productId } },
      update: {},
      create: { userId, productId },
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error("Error adding to wishlist:", error);
    res.status(500).json({ error: "Failed to add to wishlist" });
  }
});

// remove a product from a user's wishlist
app.delete("/api/wishlist/:productId", requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  try {
    await prisma.wishlist.deleteMany({ where: { userId: req.userId!, productId } });
    res.status(204).send();
  } catch (error) {
    console.error("Error removing from wishlist:", error);
    res.status(500).json({ error: "Failed to remove from wishlist" });
  }
});

// cart routes
app.get("/api/cart", requireAuth, async (req, res) => {
  try {
    const cart = await prisma.cartItem.findMany({
      where: { userId: req.userId! },
      include: { product: true, variant: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(cart);
  } catch (error) {
    console.error("Error fetching cart:", error);
    res.status(500).json({ error: "Failed to fetch cart" });
  }
});

const addCartBodySchema = z.object({
  productId: z.coerce.number().int().positive(),
  variantId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().int().positive().default(1),
});

// add a product to a user's cart
app.post("/api/cart", requireAuth, async (req, res) => {
  const parsed = addCartBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { productId, quantity } = parsed.data;
  const variantId = parsed.data.variantId ?? null;
  const userId = req.userId!;

  try {
    if (variantId) {
      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId) {
        return res.status(400).json({ error: "Variant does not belong to this product" });
      }
      if (variant.stock < quantity) {
        return res.status(409).json({ error: "Not enough stock for this variant" });
      }
    } else {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      if (product.stock < quantity) {
        return res.status(409).json({ error: "Not enough stock" });
      }
    }

    const existing = await prisma.cartItem.findFirst({
      where: { userId, productId, variantId },
    });

    const item = existing
      ? await prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + quantity },
          include: { product: true, variant: true },
        })
      : await prisma.cartItem.create({
          data: { userId, productId, variantId, quantity },
          include: { product: true, variant: true },
        });

    res.status(201).json(item);
  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({ error: "Failed to add to cart" });
  }
});

const updateCartBodySchema = z.object({
  quantity: z.coerce.number().int().positive(),
});

// update quantity of one cart row 
app.patch("/api/cart/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateCartBodySchema.safeParse(req.body);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid cart item ID" });
  }
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  try {
    const existing = await prisma.cartItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.userId) {
      return res.status(404).json({ error: "Cart item not found" });
    }
    const item = await prisma.cartItem.update({
      where: { id },
      data: { quantity: parsed.data.quantity },
      include: { product: true, variant: true },
    });
    res.json(item);
  } catch (error) {
    console.error("Error updating cart item:", error);
    res.status(500).json({ error: "Failed to update cart item" });
  }
});

// remove one cart row 
app.delete("/api/cart/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid cart item ID" });
  }
  try {
    const existing = await prisma.cartItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.userId) {
      return res.status(404).json({ error: "Cart item not found" });
    }
    await prisma.cartItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("Error removing cart item:", error);
    res.status(500).json({ error: "Failed to remove cart item" });
  }
});

// reviews routes 
app.get("/api/products/:id/reviews", async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  try {
    const reviews = await prisma.review.findMany({
      where: { productId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(reviews);
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

const reviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(2000).optional(),
});

// create or update review
app.post("/api/products/:id/reviews", requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  const parsed = reviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { rating, title, comment } = parsed.data;
  const userId = req.userId!;

  try {
    const purchased = await prisma.orderItem.findFirst({
      where: { productId, order: { userId } },
    });

    const review = await prisma.review.upsert({
      where: { userId_productId: { userId, productId } },
      update: { rating, title, comment, verifiedPurchase: !!purchased },
      create: { userId, productId, rating, title, comment, verifiedPurchase: !!purchased },
      include: { user: { select: { name: true } } },
    });
    res.status(201).json(review);
  } catch (error) {
    console.error("Error saving review:", error);
    res.status(500).json({ error: "Failed to save review" });
  }
});

// delete your own review
app.delete("/api/products/:id/reviews", requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  try {
    await prisma.review.deleteMany({ where: { userId: req.userId!, productId } });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

export default app;