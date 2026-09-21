import { GoogleGenAI } from "@google/genai";
import prisma from "../prisma.ts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

type Intent =
  | "specific_item"
  | "outfit"
  | "sale"
  | "general";

type ChatPlan = {
  intent: Intent;
  minPrice?: number;
  maxPrice?: number;
  categories: string[];
  /** must match product name/description (OR) */
  nameContains: string[];
  /** prefer these words in name */
  preferInName: string[];
  /** exclude products whose name matches */
  excludeName: string[];
  onlyDiscounted: boolean;
  gender: "men" | "women" | "any";
  reply: string;
};

const ITEM_RULES: {
  keys: RegExp;
  nameContains: string[];
  preferInName: string[];
  excludeName: string[];
  categories: string[];
}[] = [
  {
    keys: /\b(shirt|t-?shirt|tshirt|top|polo|jersey|শার্ট)\b/i,
    nameContains: ["shirt", "t-shirt", "tshirt", "polo", "top"],
    preferInName: ["shirt"],
    excludeName: ["belt", "shoe", "sneaker", "watch", "pant", "trouser", "jean"],
    categories: ["Men's Fashion", "Women's Fashion"],
  },
  {
    keys: /\b(pant|pants|trouser|chino|jean|jeans|formal pant|প্যান্ট)\b/i,
    nameContains: ["pant", "trouser", "chino", "jean"],
    preferInName: ["pant", "chino", "jean"],
    excludeName: ["shirt", "belt", "shoe", "watch"],
    categories: ["Men's Fashion", "Women's Fashion"],
  },
  {
    keys: /\b(shoe|shoes|sneaker|sneakers|loafer|boot|boots|sandal|জুতা)\b/i,
    nameContains: ["shoe", "sneaker", "loafer", "boot", "sandal"],
    preferInName: ["shoe", "sneaker"],
    excludeName: ["shirt", "belt", "watch", "pant"],
    categories: ["Men's Fashion", "Women's Fashion"],
  },
  {
    keys: /\b(watch|watches|ঘড়ি|ঘড়ি)\b/i,
    nameContains: ["watch"],
    preferInName: ["watch"],
    excludeName: ["shirt", "belt", "shoe", "pant"],
    categories: ["Men's Fashion", "Women's Fashion"],
  },
  {
    keys: /\b(belt|belts|বেল্ট)\b/i,
    nameContains: ["belt"],
    preferInName: ["belt"],
    excludeName: ["shirt", "shoe", "watch", "pant"],
    categories: ["Men's Fashion", "Women's Fashion"],
  },
  {
    keys: /\b(dress|gown|frock|কুর্তি|kurtis?)\b/i,
    nameContains: ["dress", "gown", "kurti", "frock"],
    preferInName: ["dress", "kurti"],
    excludeName: ["shirt", "belt", "shoe", "watch", "pant"],
    categories: ["Women's Fashion"],
  },
  {
    keys: /\b(bag|bags|handbag|wallet|ব্যাগ)\b/i,
    nameContains: ["bag", "wallet", "handbag"],
    preferInName: ["bag", "wallet"],
    excludeName: ["shirt", "shoe", "pant"],
    categories: ["Men's Fashion", "Women's Fashion", "Home & Lifestyle"],
  },
  {
    keys: /\b(lamp|vase|table|decor|cushion|home)\b/i,
    nameContains: ["lamp", "vase", "table", "cushion", "ceramic"],
    preferInName: [],
    excludeName: [],
    categories: ["Home & Lifestyle"],
  },
];

const OCCASION =
  /\b(party|birthday|wedding|marriage|shaadi|biye|reunion|office|casual|eid|puja|date|interview|ceremony|reception)\b/i;

const SALE =
  /\b(sale|offer|offers|discount|discounts|promo|deal|deals|clearance|অফার|সেল|ছাড়|ছাড়)\b/i;

const COLOR =
  /\b(blue|red|black|white|green|pink|navy|grey|gray|brown|beige|maroon|olive|yellow|purple|orange|নীল|লাল|কালো|সাদা)\b/i;

function detectGender(m: string): ChatPlan["gender"] {
  if (/women|woman|girl|ladies|female|মহিলা|মেয়ে|মেয়ে/.test(m)) return "women";
  if (/men|man|boy|male|gents|পুরুষ|ছেলে/.test(m)) return "men";
  return "any";
}

function parseBudget(m: string): { minPrice?: number; maxPrice?: number } {
  const range = m.match(/(\d{3,6})\s*[-–to]+\s*(\d{3,6})/);
  if (range) {
    return { minPrice: Number(range[1]), maxPrice: Number(range[2]) };
  }
  const under = m.match(
    /(?:under|below|max|within|up\s*to|less\s*than)\s*৳?\s*(\d{3,6})/i
  );
  if (under) return { maxPrice: Number(under[1]) };

  const budget = m.match(
    /budget\s*(?:of|is|=|:)?\s*(\d{3,6})|(\d{3,6})\s*(?:tk|taka)/i
  );
  if (budget) {
    const n = Number(budget[1] || budget[2]);
    return { minPrice: Math.floor(n * 0.25), maxPrice: n };
  }
  return {};
}

function ruleBasedPlan(message: string): ChatPlan {
  const m = message.toLowerCase();
  const { minPrice, maxPrice } = parseBudget(m);
  const gender = detectGender(m);
  const color = m.match(COLOR)?.[0];

  // --- SALE / OFFERS ---
  if (SALE.test(m)) {
    const cats =
      gender === "women"
        ? ["Women's Fashion"]
        : gender === "men"
          ? ["Men's Fashion"]
          : ["Men's Fashion", "Women's Fashion", "Home & Lifestyle"];
    return {
      intent: "sale",
      minPrice,
      maxPrice,
      categories: cats,
      nameContains: color ? [color] : [],
      preferInName: color ? [color] : [],
      excludeName: [],
      onlyDiscounted: true,
      gender,
      reply: "Here are products currently on sale / offer.",
    };
  }

  // --- SPECIFIC ITEM (shirt, shoe, …) ---
  for (const rule of ITEM_RULES) {
    if (!rule.keys.test(m)) continue;

    let categories = [...rule.categories];
    if (gender === "men") {
      categories = categories.filter((c) => c !== "Women's Fashion");
      if (!categories.length) categories = ["Men's Fashion"];
    }
    if (gender === "women") {
      categories = categories.filter((c) => c !== "Men's Fashion");
      if (!categories.length) categories = ["Women's Fashion"];
    }

    const nameContains = [...rule.nameContains];
    const preferInName = [...rule.preferInName];
    if (color) {
      nameContains.push(color);
      preferInName.unshift(color);
    }

    return {
      intent: "specific_item",
      minPrice,
      maxPrice,
      categories,
      nameContains,
      preferInName,
      excludeName: rule.excludeName,
      onlyDiscounted: false,
      gender,
      reply: color
        ? `Here are ${color} options that match what you asked for.`
        : "Here are items that match what you asked for.",
    };
  }

  // --- OCCASION → outfit mix (not random accessories only) ---
  if (OCCASION.test(m) || /\b(outfit|full\s*dress|complete\s*look|পোশাক)\b/i.test(m)) {
    const cats =
      gender === "women"
        ? ["Women's Fashion"]
        : gender === "men"
          ? ["Men's Fashion"]
          : ["Men's Fashion", "Women's Fashion"];
    return {
      intent: "outfit",
      minPrice,
      maxPrice,
      categories: cats,
      nameContains: [],
      preferInName: ["shirt", "pant", "dress", "chino", "trouser"],
      excludeName: [],
      onlyDiscounted: false,
      gender,
      reply:
        "For that occasion, here is a mix from our catalogue (tops + bottoms first, then extras if budget allows).",
    };
  }

  // --- GENERAL ---
  return {
    intent: "general",
    minPrice,
    maxPrice,
    categories:
      gender === "women"
        ? ["Women's Fashion"]
        : gender === "men"
          ? ["Men's Fashion"]
          : ["Men's Fashion", "Women's Fashion"],
    nameContains: color ? [color] : [],
    preferInName: color ? [color] : [],
    excludeName: [],
    onlyDiscounted: false,
    gender,
    reply: "Here are some picks from our store.",
  };
}

async function llmRefinePlan(message: string, base: ChatPlan): Promise<ChatPlan> {
  if (!process.env.GEMINI_API_KEY) return base;

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `EasyBuy shop assistant. User message: """${message}"""

Return ONLY JSON:
{
  "intent": "specific_item" | "outfit" | "sale" | "general",
  "minPrice": number|null,
  "maxPrice": number|null,
  "categories": ["Men's Fashion"|"Women's Fashion"|"Home & Lifestyle"],
  "nameContains": string[],
  "preferInName": string[],
  "excludeName": string[],
  "onlyDiscounted": boolean,
  "reply": string
}

Rules:
- If user asks for shirt/pant/shoe/watch/belt/dress, intent=specific_item and nameContains must include that product type. Never mix shoes when user asked shirt.
- If user only mentions occasion (wedding/party), intent=outfit.
- If user asks sale/offer/discount, onlyDiscounted=true.
- Prices in BDT.`,
            },
          ],
        },
      ],
    });

    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("") ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return base;
    const j = JSON.parse(match[0]);

    return {
      intent: j.intent || base.intent,
      minPrice: j.minPrice ?? base.minPrice,
      maxPrice: j.maxPrice ?? base.maxPrice,
      categories:
        Array.isArray(j.categories) && j.categories.length
          ? j.categories
          : base.categories,
      nameContains:
        Array.isArray(j.nameContains) && j.nameContains.length
          ? j.nameContains
          : base.nameContains,
      preferInName: Array.isArray(j.preferInName)
        ? j.preferInName
        : base.preferInName,
      excludeName: Array.isArray(j.excludeName)
        ? j.excludeName
        : base.excludeName,
      onlyDiscounted: Boolean(j.onlyDiscounted) || base.onlyDiscounted,
      gender: base.gender,
      reply: typeof j.reply === "string" && j.reply ? j.reply : base.reply,
    };
  } catch {
    return base;
  }
}

function nameMatchesAny(name: string, words: string[]): boolean {
  if (!words.length) return true;
  const n = name.toLowerCase();
  return words.some((w) => n.includes(w.toLowerCase()));
}

function nameMatchesNone(name: string, words: string[]): boolean {
  if (!words.length) return true;
  const n = name.toLowerCase();
  return words.every((w) => !n.includes(w.toLowerCase()));
}

export async function suggestOutfit(message: string) {
  const base = ruleBasedPlan(message.trim());
  const plan = await llmRefinePlan(message.trim(), base);

  const maxBudget = plan.maxPrice ?? null;
  const minBudget = plan.minPrice ?? 0;
  const now = new Date();

  const products = await prisma.product.findMany({
    where: {
      stock: { gt: 0 },
      category: { in: plan.categories },
      price: {
        gte: minBudget,
        ...(maxBudget != null ? { lte: maxBudget } : {}),
      },
      ...(plan.onlyDiscounted
        ? {
            discountPercent: { not: null, gt: 0 },
            OR: [{ saleEndsAt: null }, { saleEndsAt: { gt: now } }],
          }
        : {}),
    },
    orderBy: plan.onlyDiscounted
      ? [{ discountPercent: "desc" }, { price: "asc" }]
      : [{ price: "asc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      price: true,
      category: true,
      images: true,
      discountPercent: true,
      saleEndsAt: true,
    },
  });

  // text filters (shirt ≠ belt/shoe)
  let filtered = products.filter(
    (p) =>
      nameMatchesNone(p.name, plan.excludeName) &&
      (plan.nameContains.length === 0 ||
        nameMatchesAny(p.name, plan.nameContains) ||
        nameMatchesAny(p.name, plan.preferInName))
  );

  // specific_item: strict — if nothing matched nameContains, don't show random other types
  if (plan.intent === "specific_item" && plan.nameContains.length) {
    const strict = products.filter(
      (p) =>
        nameMatchesAny(p.name, plan.nameContains) &&
        nameMatchesNone(p.name, plan.excludeName)
    );
    filtered = strict.length ? strict : [];
  }

  // rank: preferred words first, then color-ish
  filtered.sort((a, b) => {
    const score = (name: string) =>
      plan.preferInName.reduce(
        (s, w) => s + (name.toLowerCase().includes(w.toLowerCase()) ? 2 : 0),
        0
      );
    return score(b.name) - score(a.name) || a.price - b.price;
  });

  const picked: typeof filtered = [];
  const usedCats = new Set<string>();
  let total = 0;

  if (plan.intent === "outfit") {
    // prefer core clothing first
    const core = filtered.filter((p) =>
      /shirt|pant|dress|chino|trouser|jean|top|kurti/i.test(p.name)
    );
    const rest = filtered.filter((p) => !core.includes(p));
    const ordered = [...core, ...rest];

    for (const p of ordered) {
      if (picked.length >= 6) break;
      if (maxBudget != null && total + p.price > maxBudget) continue;
      if (usedCats.has(p.category) && picked.length < 2) {
        // still ok to add different product types
      }
      picked.push(p);
      usedCats.add(p.category);
      total += p.price;
    }
  } else {
    for (const p of filtered) {
      if (picked.length >= 6) break;
      if (maxBudget != null && total + p.price > maxBudget) continue;
      picked.push(p);
      total += p.price;
    }
  }

  let reply = plan.reply;
  if (picked.length === 0) {
    reply = plan.onlyDiscounted
      ? "No active sale items match that right now. Try without ‘sale’, or another category."
      : plan.intent === "specific_item"
        ? "No matching items in stock for that request. Try another color, budget, or product type."
        : maxBudget
          ? `Nothing in stock under ৳${maxBudget.toLocaleString()} for that. Try a higher budget.`
          : "No matching products right now.";
  } else if (maxBudget != null && plan.intent === "outfit") {
    reply = `${plan.reply} Combined total: ৳${total.toLocaleString()} (budget ৳${maxBudget.toLocaleString()}).`;
  }

  return {
    reply,
    filters: {
      intent: plan.intent,
      minPrice: plan.minPrice ?? null,
      maxPrice: maxBudget,
      categories: plan.categories,
      onlyDiscounted: plan.onlyDiscounted,
    },
    products: picked.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category,
      image: p.images?.[0] ?? null,
      discountPercent: p.discountPercent ?? null,
    })),
  };
}