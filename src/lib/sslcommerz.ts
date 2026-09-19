import { createHash } from "node:crypto";

const STORE_ID = process.env.SSLCOMMERZ_STORE_ID!;
const STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD!;
const ENV = process.env.SSLCOMMERZ_ENV || "sandbox";

const isLive = ENV === "live";

const INIT_URL = isLive
  ? "https://securepay.sslcommerz.com/gwprocess/v4/api.php"
  : "https://sandbox.sslcommerz.com/gwprocess/v4/api.php";

const VALIDATION_URL = isLive
  ? "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php"
  : "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php";

export type InitiateSslParams = {
  totalAmount: number;
  tranId: string;
  productName: string;
  cusName: string;
  cusEmail: string;
  cusPhone: string;
  cusAdd1: string;
  cusCity: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  valueA?: string; // orderId
  valueB?: string; // tranId
};

export type InitiateSslResult = {
  status: string;
  GatewayPageURL?: string;
  sessionkey?: string;
  failedreason?: string;
};

export async function initiateSslPayment(
  params: InitiateSslParams
): Promise<InitiateSslResult> {
  if (!STORE_ID || !STORE_PASSWORD) {
    throw new Error("SSLCommerz credentials missing in env");
  }

  const body = new URLSearchParams();
  body.set("store_id", STORE_ID);
  body.set("store_passwd", STORE_PASSWORD);
  body.set("total_amount", params.totalAmount.toFixed(2));
  body.set("currency", "BDT");
  body.set("tran_id", params.tranId);
  body.set("success_url", params.successUrl);
  body.set("fail_url", params.failUrl);
  body.set("cancel_url", params.cancelUrl);
  body.set("ipn_url", params.ipnUrl);
  body.set("shipping_method", "NO");
  body.set("product_name", params.productName.slice(0, 255));
  body.set("product_category", "general");
  body.set("product_profile", "general");
  body.set("cus_name", params.cusName);
  body.set("cus_email", params.cusEmail);
  body.set("cus_add1", params.cusAdd1);
  body.set("cus_city", params.cusCity);
  body.set("cus_country", "Bangladesh");
  body.set("cus_phone", params.cusPhone);
  if (params.valueA) body.set("value_a", params.valueA);
  if (params.valueB) body.set("value_b", params.valueB);

  const res = await fetch(INIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`SSLCommerz init HTTP ${res.status}`);
  }

  return res.json() as Promise<InitiateSslResult>;
}

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

// IPN posts are signed by SSLCommerz: verify_sign is the md5 of the fields
// named in verify_key plus md5(store password), joined as key=value pairs
// sorted by key. Used for FAILED/CANCELLED notifications, which have no
// val_id that could be checked through the validation API instead.
export function verifyIpnSignature(body: Record<string, unknown>) {
  const sign = body.verify_sign;
  const keys = body.verify_key;
  if (typeof sign !== "string" || typeof keys !== "string" || !STORE_PASSWORD) {
    return false;
  }

  const fields: Record<string, string> = {};
  for (const key of keys.split(",")) {
    const value = body[key];
    if (typeof value === "string") fields[key] = value;
  }
  fields.store_passwd = md5(STORE_PASSWORD);

  const hashString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");

  return md5(hashString) === sign;
}

export type ValidateSslResult = {
  status: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  currency?: string;
  card_type?: string;
  store_amount?: string;
};

// A VALID response only proves that *some* payment went through. Before
// trusting it for an order, make sure it is this order's transaction and
// that the full amount was paid in taka — otherwise the val_id of a cheap
// payment could be replayed to mark an expensive order as paid.
export function paymentMatchesOrder(
  validation: ValidateSslResult,
  order: { transactionId: string | null; total: number }
) {
  if (validation.status !== "VALID" && validation.status !== "VALIDATED") {
    return false;
  }
  if (!order.transactionId || validation.tran_id !== order.transactionId) {
    return false;
  }
  if (validation.currency && validation.currency !== "BDT") {
    return false;
  }
  const paid = Number(validation.amount);
  return Number.isFinite(paid) && Math.abs(paid - order.total) < 0.01;
}

export async function validateSslPayment(
  valId: string
): Promise<ValidateSslResult> {
  if (!STORE_ID || !STORE_PASSWORD) {
    throw new Error("SSLCommerz credentials missing in env");
  }

  const url = new URL(VALIDATION_URL);
  url.searchParams.set("val_id", valId);
  url.searchParams.set("store_id", STORE_ID);
  url.searchParams.set("store_passwd", STORE_PASSWORD);
  url.searchParams.set("v", "1");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SSLCommerz validation HTTP ${res.status}`);
  }
  return res.json() as Promise<ValidateSslResult>;
}