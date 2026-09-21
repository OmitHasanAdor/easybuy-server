import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

export type ListingInput = {
  name?: string;
  category?: string;
  price?: number;
  notes?: string; // free text from seller
};

export type ListingOutput = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  seoKeywords: string[];
};

function fallback(input: ListingInput): ListingOutput {
  const title = (input.name || "New product").trim().slice(0, 80);
  const category = (input.category || "Men's Fashion").trim();
  const price =
    input.price != null ? `Priced at ৳${input.price}.` : "";
  return {
    title,
    description: [
      title,
      `Category: ${category}.`,
      price,
      input.notes?.trim() || "Quality product available on EasyBuy.",
      "Fast delivery across Bangladesh.",
    ]
      .filter(Boolean)
      .join(" "),
    category,
    tags: [category, "EasyBuy"].filter(Boolean),
    seoKeywords: [title, category, "Bangladesh", "online shopping"],
  };
}

export async function generateListing(
  input: ListingInput
): Promise<ListingOutput> {
  if (!process.env.GEMINI_API_KEY) return fallback(input);

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You write product listings for EasyBuy, a marketplace in Bangladesh (prices in BDT ৳).

Seller provided:
- Working name: ${input.name || "(none)"}
- Category: ${input.category || "(none)"}
- Price: ${input.price != null ? `৳${input.price}` : "(none)"}
- Notes: ${input.notes || "(none)"}

Return ONLY valid JSON:
{
  "title": "clear product title max 80 chars",
  "description": "2-4 short sentences, honest, no fake claims, English",
  "tags": ["3-6 short tags"],
  "seoKeywords": ["5-8 search keywords buyers might type"]
}`,
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
    if (!match) return fallback(input);
    const j = JSON.parse(match[0]);

 return {
  title: String(j.title || fallback(input).title).slice(0, 120),
  description: String(j.description || fallback(input).description),
  category: String(j.category || input.category || "Men's Fashion"),
  tags: Array.isArray(j.tags) ? j.tags.map(String).slice(0, 8) : fallback(input).tags,
  seoKeywords: Array.isArray(j.seoKeywords)
    ? j.seoKeywords.map(String).slice(0, 10)
    : fallback(input).seoKeywords,
};
  } catch {
    return fallback(input);
  }
}