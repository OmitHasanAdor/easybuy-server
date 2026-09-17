// Business rule: the biggest discount a product may carry. Keeping it
// below 100% guarantees the final price is always greater than zero.
export const MAX_DISCOUNT_PERCENT = 90;

type DiscountFields = {
  price: number;
  discountPercent: number | null;
  saleEndsAt: Date | null;
};

// A discount counts while it is set and its sale (if it has an end date)
// has not finished yet. The storefront uses the same rule.
export function isDiscountActive(product: DiscountFields, now = new Date()) {
  return (
    !!product.discountPercent &&
    product.discountPercent > 0 &&
    (!product.saleEndsAt || product.saleEndsAt > now)
  );
}

// Price the buyer pays for one unit: the variant price override (if any),
// minus the product's active discount, rounded to whole taka.
export function unitPrice(
  product: DiscountFields,
  variant?: { price: number | null } | null
) {
  const base = variant?.price ?? product.price;
  if (!isDiscountActive(product)) return base;

  const discounted = Math.round(base * (1 - product.discountPercent! / 100));
  return Math.max(discounted, 1);
}
