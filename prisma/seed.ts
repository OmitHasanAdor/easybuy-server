import prisma from "../src/prisma.ts";

const TEST_USER_EMAIL = "eshams05@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({
    where: {
      email: TEST_USER_EMAIL,
    },
  });

  if (!user) {
    console.error(
      `No user found with email ${TEST_USER_EMAIL}. Please create this account first.`
    );
    return;
  }

  const products = await prisma.product.findMany({
    take: 5,
  });

  if (products.length === 0) {
    console.error("No products found. Please add some products first.");
    return;
  }

  const sampleOrders = [
    {
      status: "DELIVERED",
      items: [
        {
          product: products[0],
          quantity: 1,
        },
      ],
    },
    {
      status: "SHIPPED",
      items: [
        {
          product: products[1] ?? products[0],
          quantity: 2,
        },
        {
          product: products[2] ?? products[0],
          quantity: 1,
        },
      ],
    },
    {
      status: "PENDING",
      items: [
        {
          product: products[3] ?? products[0],
          quantity: 1,
        },
      ],
    },
    {
      status: "CANCELLED",
      items: [
        {
          product: products[4] ?? products[0],
          quantity: 1,
        },
      ],
    },
  ];

  for (const order of sampleOrders) {
    const total = order.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );

    await prisma.order.create({
      data: {
        userId: user.id,
        status: order.status,
        total,
        items: {
          create: order.items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            price: item.product.price,
          })),
        },
      },
    });
  }

  console.log(`Seeded ${sampleOrders.length} orders for ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });