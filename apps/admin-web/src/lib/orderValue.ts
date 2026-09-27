/** Pure helpers behind the order Value auto-fill (New order form) and the "Populate cost"
 * button (order edit form). Kept framework-free so they can be unit-tested without React -
 * see apps/admin-web/test/orderValue.test.ts. Behaviour is unchanged from the inline logic
 * these replaced (2026-09-09 features).
 */

/** customer-pricing lookup: productId -> negotiated unit price (decimal string from the API). */
export type CustomerProductPrices = Record<string, string | undefined>;

export interface PricedPart {
  /** Negotiated unit price for this product, or undefined/"" when the customer has no override. */
  price?: string;
  quantity: number;
}

export interface PricedCost {
  /** Sum of price x quantity over the parts that have a price. */
  total: number;
  /** At least one part has a customer price. */
  anyPriced: boolean;
  /** Every part has a customer price (vacuously true for an empty list). */
  allPriced: boolean;
}

/** Cumulative customer-price cost across several products (order edit "Populate cost"). */
export function computePricedCost(parts: PricedPart[]): PricedCost {
  const total = parts.reduce((sum, part) => sum + (part.price ? parseFloat(part.price) * part.quantity : 0), 0);
  return {
    total,
    anyPriced: parts.some((part) => !!part.price),
    allPriced: parts.every((part) => !!part.price),
  };
}

export interface ProductLine {
  productId: string;
  /** Raw text from the quantity input; blank/invalid is treated as 1. */
  quantity: string;
}

/** Suggested Value for the New order form: price x quantity summed across every selected
 * product line that has a customer price, formatted to 2 decimals. Returns "" (leave Value
 * blank) when none of the selected products has a customer price override. Lines with no
 * product picked yet are ignored. */
export function suggestNewOrderValue(lines: ProductLine[], prices: CustomerProductPrices): string {
  const parts = lines
    .filter((l) => l.productId)
    .map((l) => ({ price: prices[l.productId], quantity: parseFloat(l.quantity) || 1 }));
  const { total, anyPriced } = computePricedCost(parts);
  return anyPriced ? total.toFixed(2) : "";
}
