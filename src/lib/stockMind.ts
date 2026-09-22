import { GoogleGenAI } from "@google/genai";
import prisma from "../prisma.ts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

const LOOKBACK_DAYS = 30;

export type StockMindItem = {
  productId: number;
  name: string;
  stock: number;
  category: string;
  soldLast30Days: number;
  avgPerDay: number;
  daysUntilStockOut: number | null; // null = no sales / unknown
  risk: "high" | "medium" | "low" | "ok";
};

export type StockMindResult = {
  items: StockMindItem[];
  summary: string;
};

function riskOf(
  stock: number,
  daysUntil: number | null,
  sold: number
): StockMindItem["risk"] {
  if (stock <= 0) return "high";
  if (sold === 0) return stock <= 5 ? "medium" : "ok";
  if (daysUntil == null) return stock <= 5 ? "medium" : "ok";
  if (daysUntil <= 7) return "high";
  if (daysUntil <= 14) return "medium";
  if (daysUntil <= 30) return "low";
  return "ok";
}

async function aiSummary(items: StockMindItem[]): Promise<string> {
  const hot = items.filter((i) => i.risk === "high" || i.risk === "medium");
  if (hot.length === 0) {
    return "Stock levels look stable. No urgent restock needed based on the last 30 days of sales.";
  }

  const fallback = `Restock priority: ${hot
    .slice(0, 5)
    .map((i) => i.name)
    .join(", ")}.`;

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const payload = hot.slice(0, 8).map((i) => ({
      name: i.name,
      stock: i.stock,
      soldLast30Days: i.soldLast30Days,
      daysUntilStockOut: i.daysUntilStockOut,
      risk: i.risk,
    }));

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are StockMind for EasyBuy sellers in Bangladesh.
Given these products (sales last 30 days), write 1-2 short sentences:
- which items to restock first
- rough timing if daysUntilStockOut is set
Be practical. No markdown. No fake numbers.

Data: ${JSON.stringify(payload)}`,
            },
          ],
        },
      ],
    });

    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("")
        ?.trim() ?? "";
    return text || fallback;
  } catch {
    return fallback;
  }
}

/** sellerId = logged-in seller user id */
export async function buildStockMind(sellerId: string): Promise<StockMindResult> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const products = await prisma.product.findMany({
    where: { sellerId },
    select: {
      id: true,
      name: true,
      stock: true,
      category: true,
      hasVariants: true,
      variants: { select: { stock: true } },
    },
    orderBy: { name: "asc" },
  });

  if (products.length === 0) {
    return {
      items: [],
      summary: "You have no products yet. Add products to see stock predictions.",
    };
  }

  const productIds = products.map((p) => p.id);

  const soldGroups = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: productIds },
      order: {
        createdAt: { gte: since },
        // count paid / non-cancelled if you have status fields:
        // status: { not: "CANCELLED" },
      },
    },
    _sum: { quantity: true },
  });

  const soldMap = new Map(
    soldGroups.map((g) => [g.productId, g._sum.quantity ?? 0])
  );

  const items: StockMindItem[] = products.map((p) => {
    const stock = p.hasVariants
      ? p.variants.reduce((s, v) => s + v.stock, 0)
      : p.stock;
    const soldLast30Days = soldMap.get(p.id) ?? 0;
    const avgPerDay = soldLast30Days / LOOKBACK_DAYS;
    const daysUntilStockOut =
      avgPerDay > 0 ? Math.floor(stock / avgPerDay) : null;

    return {
      productId: p.id,
      name: p.name,
      stock,
      category: p.category,
      soldLast30Days,
      avgPerDay: Math.round(avgPerDay * 100) / 100,
      daysUntilStockOut,
      risk: riskOf(stock, daysUntilStockOut, soldLast30Days),
    };
  });

  items.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, ok: 3 };
    return order[a.risk] - order[b.risk] || a.stock - b.stock;
  });

  const summary = await aiSummary(items);
  return { items, summary };
}