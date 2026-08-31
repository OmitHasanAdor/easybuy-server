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

export default app;

