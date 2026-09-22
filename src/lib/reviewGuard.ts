import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

export type ReviewGuardInput = {
  rating: number;
  title?: string | null;
  comment?: string | null;
  verifiedPurchase?: boolean;
  userReviewCount?: number;
};

export type ReviewGuardResult = {
  risk: "ok" | "suspicious" | "likely_spam";
  score: number;
  reasons: string[];
  aiNote?: string;
};

const GENERIC =
  /^(good|nice|best|love it|great|amazing|excellent|bad|poor|waste|ok|okay|fine|superb|perfect)\.?$/i;

export function analyzeReviewRules(input: ReviewGuardInput): ReviewGuardResult {
  const reasons: string[] = [];
  let score = 0;

  const title = (input.title || "").trim();
  const comment = (input.comment || "").trim();
  const text = `${title} ${comment}`.trim();

  if (!input.verifiedPurchase) {
    score += 25;
    reasons.push("Not a verified purchase");
  }

  if (!comment && !title) {
    score += 30;
    reasons.push("No written feedback");
  }

  if (comment && comment.length < 8) {
    score += 20;
    reasons.push("Very short comment");
  }

  if (comment && GENERIC.test(comment)) {
    score += 25;
    reasons.push("Generic one-word style comment");
  }

  if ((input.rating === 1 || input.rating === 5) && comment.length < 12) {
    score += 15;
    reasons.push("Extreme rating with little explanation");
  }

  if (input.userReviewCount != null && input.userReviewCount >= 15) {
    score += 10;
    reasons.push("User has a very high review volume");
  }

  if (/(.)\1{5,}/.test(text) || /https?:\/\//i.test(text)) {
    score += 35;
    reasons.push("Spam-like patterns or links in text");
  }

  score = Math.min(100, score);

  let risk: ReviewGuardResult["risk"] = "ok";
  if (score >= 55) risk = "likely_spam";
  else if (score >= 30) risk = "suspicious";

  return { risk, score, reasons };
}

/** Rules + optional short AI note (slower) */
export async function analyzeReview(
  input: ReviewGuardInput
): Promise<ReviewGuardResult> {
  const base = analyzeReviewRules(input);

  if (!process.env.GEMINI_API_KEY || base.score < 25) {
    return base;
  }

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You moderate product reviews for EasyBuy.
Reply ONLY JSON: {"aiNote":"one short sentence: genuine, promotional, or spam?"}

rating: ${input.rating}
verifiedPurchase: ${!!input.verifiedPurchase}
title: ${input.title || ""}
comment: ${input.comment || ""}
ruleReasons: ${JSON.stringify(base.reasons)}`,
            },
          ],
        },
      ],
    });

    const raw =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("") ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const j = JSON.parse(match[0]);
      if (typeof j.aiNote === "string" && j.aiNote.trim()) {
        return { ...base, aiNote: j.aiNote.trim().slice(0, 200) };
      }
    }
  } catch {
    // rules only
  }

  return base;
}