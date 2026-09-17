import type { Prisma } from "../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;

export const ORDER_STATUSES = ["PENDING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Allowed status changes. An order moves forward only; DELIVERED and
// CANCELLED are final, and cancelling is only possible before delivery.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: OrderStatus) {
  return (ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to);
}

export type StockLine = {
  productId: number;
  variantId: number | null;
  quantity: number;
};

export class OutOfStockError extends Error {
  constructor(public readonly productId: number) {
    super("Not enough stock");
    this.name = "OutOfStockError";
  }
}

async function changeStock(tx: Tx, line: StockLine, by: "decrement" | "increment") {
  const guard = by === "decrement" ? { stock: { gte: line.quantity } } : {};
  const data =
    by === "decrement"
      ? { stock: { decrement: line.quantity } }
      : { stock: { increment: line.quantity } };

  const result = line.variantId
    ? await tx.productVariant.updateMany({ where: { id: line.variantId, ...guard }, data })
    : await tx.product.updateMany({ where: { id: line.productId, ...guard }, data });

  return result.count > 0;
}

// Takes the ordered quantities out of stock. Every update only matches while
// enough stock is left, so two buyers racing for the last item cannot both
// succeed and push stock below zero. If one line cannot be fulfilled, the
// lines already taken are put back and OutOfStockError is thrown.
export async function deductStock(tx: Tx, lines: StockLine[]) {
  const done: StockLine[] = [];
  for (const line of lines) {
    if (!(await changeStock(tx, line, "decrement"))) {
      await restoreStock(tx, done);
      throw new OutOfStockError(line.productId);
    }
    done.push(line);
  }
}

// Puts ordered quantities back into stock. Products or variants deleted
// since the order was placed are simply skipped.
export async function restoreStock(tx: Tx, lines: StockLine[]) {
  for (const line of lines) {
    await changeStock(tx, line, "increment");
  }
}

// Gives a cancelled order's stock back, at most once. The stockDeducted
// flag is cleared by the same conditional update that grants the restore,
// so a retried or concurrent cancel finds nothing left to give back.
export async function releaseOrderStock(tx: Tx, orderId: number) {
  const released = await tx.order.updateMany({
    where: { id: orderId, stockDeducted: true },
    data: { stockDeducted: false },
  });
  if (released.count === 0) return false;

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, variantId: true, quantity: true },
  });
  await restoreStock(tx, items);
  return true;
}
