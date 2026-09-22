import prisma from "../prisma.ts";

export type PriceSenseResult = {
  category: string;
  sampleSize: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  suggested: number | null; // rounded avg
  message: string;
};

export async function getPriceSense(opts: {
  category: string;
  excludeProductId?: number;
  sellerId?: string; // optional: exclude own listings only from "market" or include all
}): Promise<PriceSenseResult> {
  const category = opts.category.trim();
  if (!category) {
    return {
      category: "",
      sampleSize: 0,
      min: null,
      max: null,
      avg: null,
      suggested: null,
      message: "Enter a category to see market price hints.",
    };
  }

  const products = await prisma.product.findMany({
    where: {
      category,
      stock: { gte: 0 },
      ...(opts.excludeProductId
        ? { id: { not: opts.excludeProductId } }
        : {}),
    },
    select: { price: true },
    take: 200,
  });

  if (products.length === 0) {
    return {
      category,
      sampleSize: 0,
      min: null,
      max: null,
      avg: null,
      suggested: null,
      message: `No other products in “${category}” yet — set a price you think is fair.`,
    };
  }

  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const suggested = Math.round(avg / 10) * 10; // nearest ৳10

  return {
    category,
    sampleSize: prices.length,
    min: Math.round(min),
    max: Math.round(max),
    avg: Math.round(avg),
    suggested,
    message: `Based on ${prices.length} item(s) in ${category}: typically ৳${Math.round(min).toLocaleString()}–৳${Math.round(max).toLocaleString()} (avg ৳${Math.round(avg).toLocaleString()}). Suggested around ৳${suggested.toLocaleString()}.`,
  };
}