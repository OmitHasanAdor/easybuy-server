import express from "express";
import cors from "cors";
import prisma from "./prisma.ts";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("EasyBuy Server is Running");
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isBestSeller: false },
      orderBy: { createdAt: "desc" },
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// only returns products flagged as best sellers
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

// user data pete use korte hat dilam(omit)
// Add this near your other app.get(...) routes in src/app.ts
// (right below the "/api/products" route works well)

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

    // Optional: block banned/inactive accounts from getting a role back
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

