# EasyBuy Server

Express + Prisma (PostgreSQL) API for the [EasyBuy](https://github.com/OmitHasanAdor/EasyBuy) marketplace.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npx prisma generate
npx prisma migrate deploy    # apply migrations to your database
npm run dev                  # http://localhost:5000
```

| Script          | What it does                          |
| --------------- | ------------------------------------- |
| `npm run dev`   | Start with auto-reload (tsx watch)    |
| `npm run build` | Compile TypeScript to `dist/`         |
| `npm start`     | Run the compiled server               |
| `npx prisma db seed` | Seed demo products, a seller, orders and reviews |

See [.env.example](.env.example) for every environment variable.

## Authentication

The Next.js app signs users in with Better-Auth. Requests to protected
routes send the session token as `Authorization: Bearer <token>`.
Every request re-reads the account from the database, so banned or
deactivated users get `403` immediately and their sessions are revoked
when an admin bans them.

| Guard           | Used for                                  |
| --------------- | ----------------------------------------- |
| `requireAuth`   | cart, wishlist, reviews, addresses, orders, checkout |
| `requireSeller` | `/api/seller/*`                           |
| `requireAdmin`  | `/api/admin/*`                            |

## Main endpoints

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/products`, `/api/products/:id` | Public. Invalid ids return 404. |
| GET | `/api/me` | Signed-in user's profile and role |
| GET | `/api/orders` | Signed-in user's own orders |
| POST | `/api/orders/:id/cancel` | Buyer cancels a pending, unpaid order |
| POST | `/api/checkout` | `COD` or `SSLCOMMERZ` |
| POST | `/api/payments/sslcommerz/ipn` | SSLCommerz webhook |
| POST | `/api/products/:id/reviews` | Only after a delivered order |
| PATCH | `/api/seller/products/:id` | Listing details only (no Best Seller flag) |
| PATCH | `/api/admin/products/:id` | Admin sets `isBestSeller` |
| PATCH | `/api/admin/orders/:id` | Status change, see rules below |

## Business rules

- **Order status:** `PENDING → SHIPPED → DELIVERED`. `CANCELLED` is only
  possible before delivery. `DELIVERED` and `CANCELLED` are final.
  Unpaid online orders cannot be shipped.
- **Stock:** COD orders take stock at checkout, online orders once
  SSLCommerz confirms the payment. Cancelling puts the stock back, once.
- **Prices:** always calculated on the server, including running sales.
- **Discounts:** at most 90% (`MAX_DISCOUNT_PERCENT` in `src/lib/pricing.ts`).
- **Product names:** unique per seller, not across the marketplace.
- **Reviews:** one per buyer per product, only for delivered purchases.
- **CORS:** only the EasyBuy frontend, `FRONTEND_URL` and `CORS_ORIGINS`.
