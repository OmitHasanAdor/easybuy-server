import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.ts";
import { requireSeller } from "../middleware/requireSeller.ts";

const router = Router();

// All seller routes require seller role
router.use(requireSeller);

// ======================
// 1. DASHBOARD OVERVIEW
// ======================
router.get("/dashboard", async (req, res) => {
  const sellerId = req.userId!;

  try {
    const [productCount, lowStockCount, products, orderItems] = await Promise.all([
      prisma.product.count({ where: { sellerId } }),
      prisma.product.count({
        where: { sellerId, stock: { lt: 5 } },
      }),
      prisma.product.findMany({
        where: { sellerId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          price: true,
          stock: true,
          images: true,
          createdAt: true,
        },
      }),
      prisma.orderItem.findMany({
        where: { product: { sellerId } },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              total: true,
              createdAt: true,
              user: { select: { name: true, email: true } },
            },
          },
          product: { select: { id: true, name: true, price: true } },
        },
        orderBy: { order: { createdAt: "desc" } },
        take: 10,
      }),
    ]);

    // Calculate revenue only from DELIVERED orders
    const deliveredItems = await prisma.orderItem.findMany({
      where: {
        product: { sellerId },
        order: { status: "DELIVERED" },
      },
      select: { price: true, quantity: true },
    });

    const totalRevenue = deliveredItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Unique orders count
    const uniqueOrderIds = new Set(orderItems.map((item) => item.order.id));
    const totalOrders = uniqueOrderIds.size;

    // Recent unique orders (last 5)
    const recentOrdersMap = new Map();
    for (const item of orderItems) {
      if (!recentOrdersMap.has(item.order.id) && recentOrdersMap.size < 5) {
        recentOrdersMap.set(item.order.id, {
          id: item.order.id,
          status: item.order.status,
          total: item.order.total,
          createdAt: item.order.createdAt,
          customer: item.order.user,
        });
      }
    }

    res.json({
      summary: {
        totalProducts: productCount,
        totalOrders,
        totalRevenue,
        lowStockCount,
      },
      recentProducts: products,
      recentOrders: Array.from(recentOrdersMap.values()),
    });
  } catch (error) {
    console.error("Error fetching seller dashboard:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// ======================
// 2. MY PRODUCTS
// ======================
router.get("/products", async (req, res) => {
  const sellerId = req.userId!;
  const { search, category } = req.query;

  try {
    const products = await prisma.product.findMany({
      where: {
        sellerId,
        ...(search && typeof search === "string"
          ? { name: { contains: search, mode: "insensitive" } }
          : {}),
        ...(category && typeof category === "string" ? { category } : {}),
      },
      include: {
        variants: true,
        _count: { select: { orderItems: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(products);
  } catch (error) {
    console.error("Error fetching seller products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ======================
// 3. ADD NEW PRODUCT
// ======================
const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1),
  price: z.coerce.number().positive(),
  category: z.string().trim().min(1),
  images: z.array(z.string().url()).default([]),
  stock: z.coerce.number().int().min(0).default(0),
  hasVariants: z.boolean().default(false),
  discountPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  saleEndsAt: z.coerce.date().optional().nullable(),
  isBestSeller: z.boolean().default(false),
  variants: z
    .array(
      z.object({
        size: z.string().optional().nullable(),
        color: z.string().optional().nullable(),
        stock: z.coerce.number().int().min(0).default(0),
        price: z.coerce.number().positive().optional().nullable(),
      })
    )
    .optional()
    .default([]),
});

router.post("/products", async (req, res) => {
  const sellerId = req.userId!;
  const parsed = createProductSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid data",
      details: parsed.error.issues,
    });
  }

  const data = parsed.data;

  try {
    // Check unique name
    const existing = await prisma.product.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      return res.status(409).json({ error: "Product name already exists" });
    }

    const product = await prisma.product.create({
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        category: data.category,
        images: data.images,
        stock: data.hasVariants ? 0 : data.stock, // if variants, main stock = 0
        hasVariants: data.hasVariants,
        discountPercent: data.discountPercent ?? null,
        saleEndsAt: data.saleEndsAt ?? null,
        isBestSeller: data.isBestSeller,
        sellerId,
        ...(data.hasVariants && data.variants.length > 0
          ? {
              variants: {
                create: data.variants.map((v) => ({
                  size: v.size ?? null,
                  color: v.color ?? null,
                  stock: v.stock,
                  price: v.price ?? null,
                })),
              },
            }
          : {}),
      },
      include: { variants: true },
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

// ======================
// 4. DELETE PRODUCT
// ======================
router.delete("/products/:id", async (req, res) => {
  const sellerId = req.userId!;
  const productId = Number(req.params.id);

  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }

  try {
    const product = await prisma.product.findFirst({
      where: { id: productId, sellerId },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found or you don't own it" });
    }

    await prisma.product.delete({ where: { id: productId } });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// ======================
// 5. INVENTORY
// ======================
router.get("/inventory", async (req, res) => {
  const sellerId = req.userId!;

  try {
    const products = await prisma.product.findMany({
      where: { sellerId },
      include: {
        variants: {
          select: {
            id: true,
            size: true,
            color: true,
            stock: true,
            price: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(products);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

// Update product stock
router.patch("/products/:id/stock", async (req, res) => {
  const sellerId = req.userId!;
  const productId = Number(req.params.id);
  const { stock } = req.body;

  if (!Number.isFinite(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }

  const stockNum = Number(stock);
  if (!Number.isFinite(stockNum) || stockNum < 0) {
    return res.status(400).json({ error: "Invalid stock value" });
  }

  try {
    const product = await prisma.product.findFirst({
      where: { id: productId, sellerId },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found or you don't own it" });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { stock: stockNum },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating product stock:", error);
    res.status(500).json({ error: "Failed to update stock" });
  }
});

// Update variant stock
router.patch("/variants/:id/stock", async (req, res) => {
  const sellerId = req.userId!;
  const variantId = Number(req.params.id);
  const { stock } = req.body;

  if (!Number.isFinite(variantId)) {
    return res.status(400).json({ error: "Invalid variant ID" });
  }

  const stockNum = Number(stock);
  if (!Number.isFinite(stockNum) || stockNum < 0) {
    return res.status(400).json({ error: "Invalid stock value" });
  }

  try {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { sellerId: true } } },
    });

    if (!variant || variant.product.sellerId !== sellerId) {
      return res.status(404).json({ error: "Variant not found or you don't own it" });
    }

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: stockNum },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating variant stock:", error);
    res.status(500).json({ error: "Failed to update variant stock" });
  }
});

// ======================
// 6. ORDERS
// ======================
router.get("/orders", async (req, res) => {
  const sellerId = req.userId!;
  const { status } = req.query;

  try {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        product: { sellerId },
        ...(status && typeof status === "string"
          ? { order: { status } }
          : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            total: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
          },
        },
      },
      orderBy: { order: { createdAt: "desc" } },
    });

    // Group by order
    const ordersMap = new Map();

    for (const item of orderItems) {
      const orderId = item.order.id;

      if (!ordersMap.has(orderId)) {
        ordersMap.set(orderId, {
          id: item.order.id,
          status: item.order.status,
          createdAt: item.order.createdAt,
          updatedAt: item.order.updatedAt,
          customer: item.order.user,
          items: [],
          sellerTotal: 0,
        });
      }

      const order = ordersMap.get(orderId);
      order.items.push({
        id: item.id,
        quantity: item.quantity,
        price: item.price,
        product: item.product,
      });
      order.sellerTotal += item.price * item.quantity;
    }

    res.json(Array.from(ordersMap.values()));
  } catch (error) {
    console.error("Error fetching seller orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ======================
// 7. PROFILE
// ======================
router.get("/profile", async (req, res) => {
  const sellerId = req.userId!;

  try {
    const user = await prisma.user.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        role: true,
        createdAt: true,
        seller_request: {
          where: { status: "APPROVED" },
          select: {
            storeName: true,
            description: true,
            phone: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const storeInfo = user.seller_request[0] || null;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || storeInfo?.phone || null,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      storeName: storeInfo?.storeName || null,
      storeDescription: storeInfo?.description || null,
    });
  } catch (error) {
    console.error("Error fetching seller profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ======================
// CUSTOMER REVIEWS
// ======================
router.get("/reviews", async (req, res) => {
  const sellerId = req.userId!;

  try {
    const reviews = await prisma.review.findMany({
      where: {
        product: { sellerId },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(reviews);
  } catch (error) {
    console.error("Error fetching seller reviews:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(20).optional().nullable(),
  image: z.string().url().optional().nullable(),
  storeName: z.string().trim().min(1).max(100).optional(),
  storeDescription: z.string().trim().max(500).optional().nullable(),
});

router.patch("/profile", async (req, res) => {
  const sellerId = req.userId!;
  const parsed = updateProfileSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid data",
      details: parsed.error.issues,
    });
  }

  const data = parsed.data;

  try {
    // Update user basic info
    const updatedUser = await prisma.user.update({
      where: { id: sellerId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.image !== undefined && { image: data.image }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        role: true,
      },
    });

    // Update store info in seller_request if provided
    if (data.storeName || data.storeDescription !== undefined) {
      const existingRequest = await prisma.seller_request.findFirst({
        where: { userId: sellerId, status: "APPROVED" },
      });

      if (existingRequest) {
        await prisma.seller_request.update({
          where: { id: existingRequest.id },
          data: {
            ...(data.storeName && { storeName: data.storeName }),
            ...(data.storeDescription !== undefined && {
              description: data.storeDescription,
            }),
          },
        });
      }
    }

    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating seller profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;