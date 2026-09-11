import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.ts";
import { requireAdmin } from "../middleware/requireAdmin.ts";

const router = Router();
router.use(requireAdmin);

// ======================
// DASHBOARD
// ======================
router.get("/dashboard", async (_req, res) => {
  try {
    const [
      totalBuyers,
      totalSellers,
      totalProducts,
      totalOrders,
      pendingOrders,
      revenueAgg,
      recentOrders,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "buyer" } }),
      prisma.user.count({ where: { role: "seller" } }),
      prisma.product.count(),
      prisma.order.count(),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.aggregate({
        where: { status: "DELIVERED" },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, email: true } },
          items: { select: { id: true } },
        },
      }),
      prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      summary: {
        totalBuyers,
        totalSellers,
        totalProducts,
        totalOrders,
        pendingOrders,
        totalRevenue: revenueAgg._sum.total ?? 0,
      },
      recentOrders,
      recentUsers,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard" });
  }
});

// ======================
// BUYERS
// ======================
router.get("/buyers", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const buyers = await prisma.user.findMany({
      where: {
        role: "buyer",
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        banned: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(buyers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch buyers" });
  }
});

// ======================
// SELLERS
// ======================
router.get("/sellers", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const sellers = await prisma.user.findMany({
      where: {
        role: "seller",
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        banned: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(sellers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch sellers" });
  }
});

// Ban / unban / status (buyers or sellers)
const userStatusSchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
  banned: z.boolean().optional(),
  banReason: z.string().trim().max(500).optional().nullable(),
});

router.patch("/users/:id", async (req, res) => {
  const userId = req.params.id;
  const parsed = userStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role === "admin") {
      return res.status(403).json({ error: "Cannot modify admin accounts" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
        ...(parsed.data.banned !== undefined && { banned: parsed.data.banned }),
        ...(parsed.data.banReason !== undefined && { banReason: parsed.data.banReason }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        banned: true,
        banReason: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ======================
// PRODUCTS (moderation)
// ======================
router.get("/products", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const products = await prisma.product.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { category: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      include: {
        seller: { select: { id: true, name: true, email: true } },
        _count: { select: { orderItems: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.delete("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }

  try {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await prisma.product.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// ======================
// ALL ORDERS
// ======================
router.get("/orders", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  try {
    const orders = await prisma.order.findMany({
      where: status ? { status } : {},
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, price: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "SHIPPED", "DELIVERED", "CANCELLED"]),
});

router.patch("/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid order ID" });
  }

  const parsed = orderStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: parsed.data.status },
      include: {
        user: { select: { name: true, email: true } },
        items: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// ======================
// REVIEW MODERATION
// ======================
router.get("/reviews", async (_req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      include: {
        product: {
          select: { id: true, name: true, images: true, sellerId: true },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(reviews);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

router.delete("/reviews/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid review ID" });
  }

  try {
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }
    await prisma.review.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

// ======================
// REPORTS & ANALYTICS
// ======================
router.get("/reports", async (_req, res) => {
  try {
    const [
      totalRevenue,
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      totalBuyers,
      totalSellers,
      totalProducts,
      orders,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: { status: "DELIVERED" },
        _sum: { total: true },
      }),
      prisma.order.count(),
      prisma.order.count({ where: { status: "DELIVERED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.user.count({ where: { role: "buyer" } }),
      prisma.user.count({ where: { role: "seller" } }),
      prisma.product.count(),
      prisma.order.findMany({
        where: { status: "DELIVERED" },
        select: { total: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Last 6 months revenue
    const monthMap = new Map<string, number>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
      monthMap.set(key, 0);
    }
    for (const o of orders) {
      const d = new Date(o.createdAt);
      const key = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (monthMap.has(key)) {
        monthMap.set(key, (monthMap.get(key) ?? 0) + o.total);
      }
    }

    // Top products by order count
    const topProducts = await prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      _count: { id: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });

    const productIds = topProducts.map((t) => t.productId);
    const productDetails = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, images: true, price: true },
    });
    const productMap = new Map(productDetails.map((p) => [p.id, p]));

    const topProductsDetailed = topProducts.map((t) => ({
      product: productMap.get(t.productId) ?? null,
      quantitySold: t._sum.quantity ?? 0,
      orderCount: t._count.id,
    }));

    // Status breakdown
    const statusGroups = await prisma.order.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    res.json({
      summary: {
        totalRevenue: totalRevenue._sum.total ?? 0,
        totalOrders,
        deliveredOrders,
        cancelledOrders,
        totalBuyers,
        totalSellers,
        totalProducts,
        avgOrderValue:
          deliveredOrders > 0
            ? (totalRevenue._sum.total ?? 0) / deliveredOrders
            : 0,
      },
      monthlyRevenue: Array.from(monthMap.entries()).map(([month, value]) => ({
        month,
        value,
      })),
      statusBreakdown: statusGroups.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
      topProducts: topProductsDetailed,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// ======================
// CATEGORIES
// ======================
router.get("/categories", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      select: { category: true, stock: true, id: true },
    });

    const map = new Map<
      string,
      { name: string; productCount: number; totalStock: number }
    >();

    for (const p of products) {
      const name = p.category?.trim() || "Uncategorized";
      const row = map.get(name) ?? { name, productCount: 0, totalStock: 0 };
      row.productCount += 1;
      row.totalStock += p.stock;
      map.set(name, row);
    }

    const categories = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    res.json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

export default router;