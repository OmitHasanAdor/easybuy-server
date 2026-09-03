import prisma from "../src/prisma";

// Trending Products 
const trendingProducts = [
  { name: "Classic Oxford Shirt", price: 1450, description: "A crisp, breathable oxford shirt built for everyday wear.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600"], stock: 25, isBestSeller: false },
  { name: "Linen Summer Dress", price: 2100, description: "Lightweight linen dress, perfect for warm days.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600"], stock: 15, isBestSeller: false },
  { name: "Minimalist Table Lamp", price: 980, description: "A soft-glow ceramic lamp that fits any room.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600"], stock: 12, isBestSeller: false },
  { name: "Leather Weekend Bag", price: 3250, description: "Durable leather bag with room for a short trip.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600"], stock: 8, isBestSeller: false },
  { name: "Ceramic Vase Set", price: 750, description: "Set of two handmade ceramic vases.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=600"], stock: 20, isBestSeller: false },
  { name: "Slim Fit Chinos", price: 1350, description: "Comfortable stretch-cotton chinos for daily wear.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=600"], stock: 18, isBestSeller: false },
  { name: "Wool Blend Overcoat", price: 4200, description: "Warm, tailored overcoat for the cooler months.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=600"], stock: 6, isBestSeller: false },
  { name: "Silk Wrap Blouse", price: 1850, description: "Elegant silk blouse with a flattering wrap fit.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?w=600"], stock: 14, isBestSeller: false },
  { name: "High-Waist Denim Jeans", price: 1600, description: "Classic high-waist jeans with a comfortable stretch fit.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600"], stock: 22, isBestSeller: false },
  { name: "Knit Cardigan", price: 1400, description: "Soft knit cardigan, perfect for layering.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600"], stock: 16, isBestSeller: false },
  { name: "Leather Ankle Boots", price: 2800, description: "Handcrafted leather boots built to last.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=600"], stock: 10, isBestSeller: false },
  { name: "Canvas Sneakers", price: 1200, description: "Everyday canvas sneakers with a cushioned sole.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600"], stock: 30, isBestSeller: false },
  { name: "Handwoven Area Rug", price: 3800, description: "Handwoven rug that adds warmth to any living space.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1600166898405-da9535204843?w=600"], stock: 5, isBestSeller: false },
  { name: "Wooden Coffee Table", price: 5200, description: "Solid wood coffee table with a natural finish.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1567016432779-094069958ea5?w=600"], stock: 4, isBestSeller: false },
  { name: "Scented Soy Candle Set", price: 650, description: "Set of three hand-poured soy candles.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1603006905003-be475563bc59?w=600"], stock: 25, isBestSeller: false },
  { name: "Linen Throw Pillow Cover", price: 420, description: "Natural linen cover that softens any sofa or bed.", category: "Home & Lifestyle", images: ["https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600"], stock: 28, isBestSeller: false },
  { name: "Woven Storage Basket", price: 890, description: "Handwoven basket for stylish, practical storage.", category: "New Arrivals", images: ["https://img.kwcdn.com/product/fancy/6dd59dd3-f8cf-4921-8584-91f405b404e7.jpg?imageView2/2/w/500/q/60/format/webp"], stock: 17, isBestSeller: false },
  { name: "Stainless Steel Water Bottle", price: 550, description: "Insulated bottle that keeps drinks cold for hours.", category: "New Arrivals", images: ["https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600"], stock: 40, isBestSeller: false },
  { name: "Leather Card Wallet", price: 780, description: "Slim leather wallet with a minimalist design.", category: "New Arrivals", images: ["https://images.unsplash.com/photo-1627123424574-724758594e93?w=600"], stock: 24, isBestSeller: false },
  { name: "Cotton Bucket Hat", price: 480, description: "Lightweight cotton hat for sunny days out.", category: "New Arrivals", images: ["https://images.unsplash.com/photo-1521369909029-2afed882baee?w=600"], stock: 19, isBestSeller: false },
];

// Best Sellers
const bestSellerProducts = [
  { name: "Merino Wool Sweater", price: 2650, description: "Premium merino wool crewneck, warm without the bulk.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1614975059251-992f11792b9f?w=600"], stock: 20, isBestSeller: true },
  { name: "Structured Tote Bag", price: 2200, description: "Everyday tote with a sturdy structured shape and interior pockets.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=600"], stock: 16, isBestSeller: true },
  { name: "Aviator Sunglasses", price: 1450, description: "Classic aviator frame with UV-protective polarized lenses.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600"], stock: 27, isBestSeller: true },
  { name: "Chrono Steel Watch", price: 3900, description: "Stainless steel chronograph watch with a scratch-resistant face.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=600"], stock: 9, isBestSeller: true },
  { name: "Minimal Gold Necklace", price: 1350, description: "Delicate gold-plated chain necklace for everyday layering.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600"], stock: 23, isBestSeller: true },
  { name: "Linen Casual Shirt", price: 1250, description: "Breathable linen shirt with a relaxed everyday fit.", category: "Men's Fashion", images: ["https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600"], stock: 21, isBestSeller: true },
  { name: "Suede Ankle Sneakers", price: 2650, description: "Soft suede sneakers with a cushioned everyday sole.", category: "Women's Fashion", images: ["https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600"], stock: 13, isBestSeller: true },
  { name: "Woven Leather Belt", price: 890, description: "Hand-woven genuine leather belt with a brushed buckle.", category: "Men's Fashion", images: ["https://m.media-amazon.com/images/I/71mUb4cu8bL._AC_UY1000_.jpg"], stock: 31, isBestSeller: true },
  { name: "Handmade Ceramic Mug Set", price: 990, description: "Set of two artisan ceramic mugs, each subtly one of a kind.", category: "Home & Lifestyle", images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQPGuFyNjr49vpjAdxtU9UbQd3xZOh_h1SpMCWBgEwkewm0ohQZhGhEN8Y&s=10"], stock: 18, isBestSeller: true },
  { name: "Marble Coasters Set", price: 750, description: "Set of four polished marble coasters with cork backing.", category: "Home & Lifestyle", images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTkwHbCBq70jIgfTq-qddZzVE9QYVy7edVBwsqTiK7B8Q&s"], stock: 22, isBestSeller: true },
];

// ---- Order seeding config  ----
const TEST_USER_EMAIL = "eshams05@gmail.com";

async function seedProducts() {
  const all = [...trendingProducts, ...bestSellerProducts];
  console.log(`Seeding ${all.length} products (${trendingProducts.length} trending + ${bestSellerProducts.length} best sellers)...`);

  for (const product of all) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: { isBestSeller: product.isBestSeller, images: product.images },
      create: product,
    });
  }

  console.log(`Done. ${bestSellerProducts.length} products marked as best sellers.`);
}

async function seedOrders() {
  const user = await prisma.user.findUnique({
    where: {
      email: TEST_USER_EMAIL,
    },
  });

  if (!user) {
    console.error(
      `No user found with email ${TEST_USER_EMAIL}. Please create this account first. Skipping order seeding.`
    );
    return;
  }

// Don't re-seed orders if this user already has some — avoids creating duplicates
  const existingOrderCount = await prisma.order.count({ where: { userId: user.id } });
  if (existingOrderCount > 0) {
    console.log(`${user.email} already has ${existingOrderCount} order(s). Skipping order seeding.`);
    return;
  }

  const products = await prisma.product.findMany({
    take: 5,
  });

  if (products.length === 0) {
    console.error("No products found. Please add some products first. Skipping order seeding.");
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

async function seedReviews() {
  const user = await prisma.user.findUnique({
    where: { email: TEST_USER_EMAIL },
  });

  if (!user) {
    console.error(
      `No user found with email ${TEST_USER_EMAIL}. Skipping review seeding.`
    );
    return;
  }

// Don't re-seed reviews if this user already has some — avoids creating
  const sampleReviews = [
    { productName: "Classic Oxford Shirt", rating: 5, title: "Great everyday shirt", comment: "Fits true to size and the fabric feels much better than the price suggests. Wearing it weekly now." },
    { productName: "Merino Wool Sweater", rating: 4, title: "Warm but runs slightly large", comment: "Quality is excellent, very soft. I'd size down if you're between sizes." },
    { productName: "Leather Weekend Bag", rating: 5, title: "Sturdy and looks premium", comment: "Used it for two trips already, straps are holding up well and the leather is thick." },
    { productName: "Aviator Sunglasses", rating: 3, title: "Decent, but arm hinges are loose", comment: "Look and tint are good, but the hinge on one arm was slightly loose out of the box." },
    { productName: "Wooden Coffee Table", rating: 5, title: "Beautiful finish", comment: "Solid wood, no wobble, assembly was straightforward. Looks great in the living room." },
    { productName: "Chrono Steel Watch", rating: 4, title: "Good value chronograph", comment: "Face is a bit busy but the build quality feels solid for this price range." },
  ];

  console.log(`Seeding ${sampleReviews.length} sample reviews for ${user.email}...`);

  for (const r of sampleReviews) {
    const product = await prisma.product.findUnique({ where: { name: r.productName } });
    if (!product) {
      console.warn(`Product "${r.productName}" not found, skipping its review.`);
      continue;
    }
    await prisma.review.upsert({
      where: { userId_productId: { userId: user.id, productId: product.id } },
      update: { rating: r.rating, title: r.title, comment: r.comment },
      create: {
        userId: user.id,
        productId: product.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        verifiedPurchase: false,
      },
    });
  }

  console.log(`Done seeding reviews.`);
}

async function main() {
  await seedProducts();
  await seedOrders();
  await seedReviews();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });