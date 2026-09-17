import express from "express";
import cors from "cors";
import { z } from "zod";
import prisma from "./prisma.ts";
import { requireAuth } from "./middleware/requireAuth.ts";
import sellerRoutes from "./routes/seller.ts";
import adminRoutes from "./routes/admin.ts";
import {
  initiateSslPayment,
  paymentMatchesOrder,
  validateSslPayment,
} from "./lib/sslcommerz.ts";
import { parseId } from "./lib/params.ts";
import { corsOptions } from "./config/cors.ts";
import { unitPrice } from "./lib/pricing.ts";
import { deductStock, OutOfStockError } from "./lib/orders.ts";

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // SSLCommerz IPN

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
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: "Product not found" });
  }
  try {
    const product = await prisma.product.findUnique({
      where: { id },
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
  const productId = parseId(req.params.id);
  if (productId === null) {
    return res.status(404).json({ message: "Product not found" });
  }
  try {
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

// orders of the signed-in user. The user always comes from the session,
// never from the query string; admins list everyone's orders through
// /api/admin/orders instead.
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        userId: req.userId!,
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

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
} as const;

// the signed-in user's own profile and role
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: publicUserSelect,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching current user:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// user role route (kept for older clients). Returns the caller's own role;
// only admins may look up another account by email.
app.get("/user-role", requireAuth, async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";

  try {
    const user = await prisma.user.findUnique({
      where: email && req.userRole === "admin" ? { email } : { id: req.userId! },
      select: publicUserSelect,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (email && req.userRole !== "admin" && user.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "You can only look up your own account" });
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
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

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

// get reviews written by the logged-in user
app.get("/api/reviews/my", requireAuth, async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      where: {
        userId: req.userId!,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(reviews);
  } catch (error) {
    console.error("Error fetching my reviews:", error);
    res.status(500).json({
      error: "Failed to fetch your reviews",
    });
  }
});

// remove a product from a user's wishlist
app.delete("/api/wishlist/:productId", requireAuth, async (req, res) => {
  const productId = parseId(req.params.productId);
  if (productId === null) {
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

function stockErrorMessage(stock: number, alreadyInCart: number) {
  if (stock <= 0) return "This item is out of stock";
  if (alreadyInCart > 0) {
    return `Only ${stock} in stock and you already have ${alreadyInCart} in your cart`;
  }
  return `Only ${stock} in stock`;
}

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
    const existing = await prisma.cartItem.findFirst({
      where: { userId, productId, variantId },
    });
    // what the cart row would hold after this request
    const requestedTotal = (existing?.quantity ?? 0) + quantity;

    if (variantId) {
      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId) {
        return res.status(400).json({ error: "Variant does not belong to this product" });
      }
      if (variant.stock < requestedTotal) {
        return res.status(409).json({
          error: stockErrorMessage(variant.stock, existing?.quantity ?? 0),
          available: variant.stock,
        });
      }
    } else {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      if (product.hasVariants) {
        return res.status(400).json({ error: "Please choose a size or color first" });
      }
      if (product.stock < requestedTotal) {
        return res.status(409).json({
          error: stockErrorMessage(product.stock, existing?.quantity ?? 0),
          available: product.stock,
        });
      }
    }

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
  const id = parseId(req.params.id);
  const parsed = updateCartBodySchema.safeParse(req.body);
  if (id === null) {
    return res.status(400).json({ error: "Invalid cart item ID" });
  }
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  try {
    const existing = await prisma.cartItem.findUnique({
      where: { id },
      include: {
        product: { select: { stock: true } },
        variant: { select: { stock: true } },
      },
    });
    if (!existing || existing.userId !== req.userId) {
      return res.status(404).json({ error: "Cart item not found" });
    }
    const stock = existing.variant ? existing.variant.stock : existing.product.stock;
    if (parsed.data.quantity > stock) {
      return res.status(409).json({
        error: stockErrorMessage(stock, 0),
        available: stock,
      });
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
  const id = parseId(req.params.id);
  if (id === null) {
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
  const productId = parseId(req.params.id);
  if (productId === null) {
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
  const productId = parseId(req.params.id);
  if (productId === null) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  const parsed = reviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { rating, title, comment } = parsed.data;
  const userId = req.userId!;

  try {
    // Only buyers who actually received the product may review it,
    // which keeps ratings from being padded with fake reviews.
    const purchased = await prisma.orderItem.findFirst({
      where: { productId, order: { userId, status: "DELIVERED" } },
      select: { id: true },
    });
    if (!purchased) {
      return res.status(403).json({
        error: "You can review this product after your order has been delivered",
      });
    }

    // one review per user per product: posting again edits the existing one
    const review = await prisma.review.upsert({
      where: { userId_productId: { userId, productId } },
      update: { rating, title, comment, verifiedPurchase: true },
      create: { userId, productId, rating, title, comment, verifiedPurchase: true },
      include: { user: { select: { name: true } } },
    });
    res.status(201).json(review);
  } catch (error) {
    console.error("Error saving review:", error);
    res.status(500).json({ error: "Failed to save review" });
  }
});

// whether the signed-in user may review a product
app.get("/api/products/:id/reviews/eligibility", requireAuth, async (req, res) => {
  const productId = parseId(req.params.id);
  if (productId === null) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  try {
    const purchased = await prisma.orderItem.findFirst({
      where: { productId, order: { userId: req.userId!, status: "DELIVERED" } },
      select: { id: true },
    });
    res.json({ canReview: !!purchased });
  } catch (error) {
    console.error("Error checking review eligibility:", error);
    res.status(500).json({ error: "Failed to check review eligibility" });
  }
});

// delete your own review
app.delete("/api/products/:id/reviews", requireAuth, async (req, res) => {
  const productId = parseId(req.params.id);
  if (productId === null) {
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


const addressSchema = z.object({
  label: z.string().trim().max(50).optional().nullable(),
  fullName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(20),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

// List
app.get("/api/addresses", requireAuth, async (req, res) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.userId! },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    res.json(addresses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch addresses" });
  }
});

// Create
app.post("/api/addresses", requireAuth, async (req, res) => {
  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
  }

  const userId = req.userId!;
  const data = parsed.data;

  try {
    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        userId,
        label: data.label ?? null,
        fullName: data.fullName,
        phone: data.phone,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,
        city: data.city,
        postalCode: data.postalCode ?? null,
        isDefault: data.isDefault ?? false,
      },
    });

    res.status(201).json(address);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create address" });
  }
});

// Update
app.patch("/api/addresses/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid address ID" });
  }

  const parsed = addressSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
  }

  const userId = req.userId!;

  try {
    const existing = await prisma.address.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Address not found" });
    }

    if (parsed.data.isDefault === true) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.address.update({
      where: { id },
      data: parsed.data,
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update address" });
  }
});

// Delete
app.delete("/api/addresses/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid address ID" });
  }

  try {
    const existing = await prisma.address.findFirst({
      where: { id, userId: req.userId! },
    });
    if (!existing) {
      return res.status(404).json({ error: "Address not found" });
    }

    await prisma.address.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete address" });
  }
});



const checkoutSchema = z.object({
  paymentMethod: z.enum(["COD", "SSLCOMMERZ"]),
  addressId: z.coerce.number().int().positive().optional(),
  fullName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  addressLine1: z.string().trim().min(1).max(200).optional(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100).optional(),
  postalCode: z.string().trim().max(20).optional().nullable(),
});

app.post("/api/checkout", requireAuth, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
  }

  const userId = req.userId!;
  const { paymentMethod, addressId } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    const cartItems = await prisma.cartItem.findMany({
      where: { userId },
      include: { product: true, variant: true },
    });

    if (cartItems.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Shipping
    let shippingName = parsed.data.fullName ?? null;
    let shippingPhone = parsed.data.phone ?? null;
    let shippingAddress = parsed.data.addressLine1 ?? null;
    let shippingCity = parsed.data.city ?? null;

    if (addressId) {
      const addr = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });
      if (!addr) return res.status(404).json({ error: "Address not found" });
      shippingName = addr.fullName;
      shippingPhone = addr.phone;
      shippingAddress = [addr.addressLine1, addr.addressLine2].filter(Boolean).join(", ");
      shippingCity = addr.city;
    }

    if (!shippingName || !shippingPhone || !shippingAddress || !shippingCity) {
      return res.status(400).json({ error: "Shipping address is required" });
    }

    // Stock check
    for (const item of cartItems) {
      const stock = item.variant ? item.variant.stock : item.product.stock;
      if (stock < item.quantity) {
        return res.status(409).json({
          error: `Not enough stock for "${item.product.name}"`,
        });
      }
    }

    // Prices are always worked out here from the product row, including any
    // running sale, so the buyer pays what the storefront showed them.
    const lineItems = cartItems.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: unitPrice(item.product, item.variant),
    }));
    const total = lineItems.reduce((sum, line) => sum + line.price * line.quantity, 0);

    const productName = cartItems
      .map((i) => i.product.name)
      .join(", ")
      .slice(0, 200);

    // ── COD ──────────────────────────────────────────
    if (paymentMethod === "COD") {
      const order = await prisma.$transaction(async (tx) => {
        // throws OutOfStockError (and rolls everything back) if another
        // buyer got the last units after the check above
        await deductStock(tx, lineItems);

        const newOrder = await tx.order.create({
          data: {
            userId,
            total,
            status: "PENDING",
            paymentMethod: "COD",
            paymentStatus: "UNPAID",
            stockDeducted: true,
            shippingName,
            shippingPhone,
            shippingAddress,
            shippingCity,
            items: { create: lineItems },
          },
        });

        // only the rows that went into this order
        await tx.cartItem.deleteMany({
          where: { id: { in: cartItems.map((item) => item.id) } },
        });
        return newOrder;
      });

      return res.status(201).json({
        type: "cod",
        orderId: order.id,
        total: order.total,
        message: "Order placed successfully. Pay on delivery.",
      });
    }

    // ── SSLCOMMERZ ───────────────────────────────────
    const tranId = `EASYBUY_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          userId,
          total,
          status: "PENDING",
          paymentMethod: "SSLCOMMERZ",
          paymentStatus: "UNPAID",
          transactionId: tranId,
          shippingName,
          shippingPhone,
          shippingAddress,
          shippingCity,
          items: { create: lineItems },
        },
      });

      // Stock: pay হলে কমাবে — অথবা এখন reserve করতে চাইলে এখানে decrement
      // Assignment: pay success-এ stock কমাও (IPN/validate এ)
      return newOrder;
    });

    const frontend = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
    const serverPublic =
      process.env.SERVER_PUBLIC_URL ||
      `http://localhost:${process.env.PORT || 5000}`;

    const ssl = await initiateSslPayment({
      totalAmount: total,
      tranId,
      productName,
      cusName: shippingName,
      cusEmail: user.email,
      cusPhone: shippingPhone,
      cusAdd1: shippingAddress,
      cusCity: shippingCity,
      successUrl: `${frontend}/checkout/success?tran_id=${tranId}&orderId=${order.id}`,
      failUrl: `${frontend}/checkout/fail?tran_id=${tranId}&orderId=${order.id}`,
      cancelUrl: `${frontend}/checkout/cancel?tran_id=${tranId}&orderId=${order.id}`,
      ipnUrl: `${serverPublic}/api/payments/sslcommerz/ipn`,
      valueA: String(order.id),
      valueB: tranId,
    });

    if (ssl.status !== "SUCCESS" || !ssl.GatewayPageURL) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "FAILED", status: "CANCELLED" },
      });
      return res.status(502).json({
        error: ssl.failedreason || "Payment gateway rejected the request",
      });
    }

    return res.status(201).json({
      type: "redirect",
      orderId: order.id,
      tranId,
      url: ssl.GatewayPageURL,
    });
  } catch (error) {
    if (error instanceof OutOfStockError) {
      return res.status(409).json({ error: "Some items in your cart just sold out" });
    }
    console.error("Checkout error:", error);
    return res.status(500).json({ error: "Failed to place order" });
  }
});
async function markOrderPaid(tranId: string, valId?: string) {
  const order = await prisma.order.findFirst({
    where: { transactionId: tranId },
    include: { items: true },
  });
  if (!order) return null;
  if (order.paymentStatus === "PAID") return order; // idempotent

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "PAID",
        status: "PENDING", // or PROCESSING
        paidAt: new Date(),
      },
    });

    // Reduce stock + clear cart (SSL path)
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }
    await tx.cartItem.deleteMany({ where: { userId: order.userId } });

    return updated;
  });
}

// IPN (webhook from SSLCommerz)
app.post("/api/payments/sslcommerz/ipn", async (req, res) => {
  try {
    const body = req.body || {};
    const tranId = body.tran_id as string | undefined;
    const valId = body.val_id as string | undefined;
    const status = body.status as string | undefined;

    if (!tranId || !valId) {
      return res.status(400).send("Invalid IPN");
    }

    if (status === "VALID" || status === "VALIDATED") {
      const [order, validation] = await Promise.all([
        prisma.order.findUnique({ where: { transactionId: tranId } }),
        validateSslPayment(valId),
      ]);
      if (order && paymentMatchesOrder(validation, order)) {
        await markOrderPaid(tranId, valId);
      } else {
        console.warn("IPN ignored: validation does not match order", { tranId });
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("IPN error:", error);
    res.status(500).send("ERROR");
  }
});

// Success page backup validation
app.post("/api/payments/sslcommerz/confirm", requireAuth, async (req, res) => {
  try {
    const { tran_id, val_id } = req.body as {
      tran_id?: string;
      val_id?: string;
    };

    if (!tran_id) {
      return res.status(400).json({ error: "tran_id required" });
    }

    const order = await prisma.order.findFirst({
      where: { transactionId: tran_id, userId: req.userId! },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.paymentStatus === "PAID") {
      return res.json({ ok: true, orderId: order.id, paymentStatus: "PAID" });
    }

    if (val_id) {
      const validation = await validateSslPayment(val_id);
      if (paymentMatchesOrder(validation, order)) {
        await markOrderPaid(tran_id, val_id);
        return res.json({ ok: true, orderId: order.id, paymentStatus: "PAID" });
      }
    }

    // Soft confirm: still UNPAID — frontend can poll or show pending
    return res.json({
      ok: true,
      orderId: order.id,
      paymentStatus: order.paymentStatus,
    });
  } catch (error) {
    console.error("Confirm error:", error);
    res.status(500).json({ error: "Confirmation failed" });
  }
});

app.use("/api/seller", sellerRoutes);
app.use("/api/admin", adminRoutes);

export default app;