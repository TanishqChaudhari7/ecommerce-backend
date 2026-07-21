import * as bcrypt from 'bcrypt';
import { pool } from '../src/config/db';

const PASSWORD = 'Test@1234';

function seedUuid(group: number, index: number): string {
  return `${group.toString().padStart(8, '0')}-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

const USERS = [
  {
    id: seedUuid(1, 1),
    email: 'admin@test.com',
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'admin',
  },
  {
    id: seedUuid(1, 2),
    email: 'seller@test.com',
    firstName: 'Sam',
    lastName: 'Seller',
    role: 'seller',
  },
  {
    id: seedUuid(1, 3),
    email: 'customer@test.com',
    firstName: 'Cara',
    lastName: 'Customer',
    role: 'customer',
  },
];

const CATEGORIES = [
  { id: seedUuid(2, 1), name: 'Electronics', slug: 'electronics' },
  { id: seedUuid(2, 2), name: 'Clothing', slug: 'clothing' },
  { id: seedUuid(2, 3), name: 'Home & Kitchen', slug: 'home-kitchen' },
  { id: seedUuid(2, 4), name: 'Books', slug: 'books' },
  { id: seedUuid(2, 5), name: 'Sports & Outdoors', slug: 'sports-outdoors' },
];

interface ProductTemplate {
  name: string;
  description: string;
  price: number;
  brand: string;
  categoryIndex: number;
}

const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse with adjustable DPI.',
    price: 24.99,
    brand: 'Logitech',
    categoryIndex: 0,
  },
  {
    name: 'Mechanical Keyboard',
    description: 'Tactile mechanical keyboard with RGB backlight.',
    price: 79.99,
    brand: 'Corsair',
    categoryIndex: 0,
  },
  {
    name: 'USB-C Hub',
    description: '7-in-1 USB-C hub with HDMI and card reader.',
    price: 34.5,
    brand: 'Anker',
    categoryIndex: 0,
  },
  {
    name: 'Bluetooth Speaker',
    description: 'Portable waterproof Bluetooth speaker.',
    price: 59.99,
    brand: 'JBL',
    categoryIndex: 0,
  },
  {
    name: 'Cotton T-Shirt',
    description: 'Classic fit 100% cotton t-shirt.',
    price: 14.99,
    brand: 'Hanes',
    categoryIndex: 1,
  },
  {
    name: 'Denim Jacket',
    description: 'Classic blue denim jacket.',
    price: 64.0,
    brand: "Levi's",
    categoryIndex: 1,
  },
  {
    name: 'Running Shoes',
    description: 'Lightweight breathable running shoes.',
    price: 89.99,
    brand: 'Nike',
    categoryIndex: 1,
  },
  {
    name: 'Wool Sweater',
    description: 'Warm merino wool sweater.',
    price: 54.5,
    brand: 'Uniqlo',
    categoryIndex: 1,
  },
  {
    name: 'Stainless Steel Pan',
    description: 'Non-stick stainless steel frying pan.',
    price: 39.99,
    brand: 'Tefal',
    categoryIndex: 2,
  },
  {
    name: 'Coffee Maker',
    description: '12-cup programmable drip coffee maker.',
    price: 49.99,
    brand: 'Breville',
    categoryIndex: 2,
  },
  {
    name: 'Blender',
    description: 'High-speed countertop blender.',
    price: 69.99,
    brand: 'Ninja',
    categoryIndex: 2,
  },
  {
    name: 'Cutting Board Set',
    description: 'Set of 3 bamboo cutting boards.',
    price: 22.99,
    brand: 'OXO',
    categoryIndex: 2,
  },
  {
    name: 'The Pragmatic Programmer',
    description: 'A guide to becoming a better programmer.',
    price: 42.0,
    brand: 'Addison-Wesley',
    categoryIndex: 3,
  },
  {
    name: 'Clean Code',
    description: 'A handbook of agile software craftsmanship.',
    price: 38.5,
    brand: 'Prentice Hall',
    categoryIndex: 3,
  },
  {
    name: 'Atomic Habits',
    description: 'An easy and proven way to build good habits.',
    price: 27.0,
    brand: 'Penguin Random House',
    categoryIndex: 3,
  },
  {
    name: 'Sapiens',
    description: 'A brief history of humankind.',
    price: 29.99,
    brand: 'Harper',
    categoryIndex: 3,
  },
  {
    name: 'Yoga Mat',
    description: 'Non-slip extra thick yoga mat.',
    price: 25.99,
    brand: 'Gaiam',
    categoryIndex: 4,
  },
  {
    name: 'Camping Tent',
    description: '4-person waterproof camping tent.',
    price: 129.99,
    brand: 'Coleman',
    categoryIndex: 4,
  },
  {
    name: 'Dumbbell Set',
    description: 'Adjustable dumbbell set, 5-25 lbs.',
    price: 149.99,
    brand: 'Bowflex',
    categoryIndex: 4,
  },
  {
    name: 'Hiking Backpack',
    description: '40L waterproof hiking backpack.',
    price: 74.99,
    brand: 'Osprey',
    categoryIndex: 4,
  },
];

interface SeededProduct {
  id: string;
  price: number;
}

async function seedUsers(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const user of USERS) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      [user.id, user.email, passwordHash, user.firstName, user.lastName, user.role],
    );
  }
}

async function seedCategories(): Promise<void> {
  for (const category of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [category.id, category.name, category.slug],
    );
  }
}

async function seedProducts(): Promise<SeededProduct[]> {
  const sellerId = USERS[1].id;

  const products = PRODUCT_TEMPLATES.map((template, index) => ({
    id: seedUuid(3, index + 1),
    sku: `SEED-SKU-${(index + 1).toString().padStart(3, '0')}`,
    categoryId: CATEGORIES[template.categoryIndex].id,
    ...template,
  }));

  for (const product of products) {
    await pool.query(
      `INSERT INTO products (id, seller_id, category_id, name, description, price, sku, brand)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sku) DO NOTHING`,
      [
        product.id,
        sellerId,
        product.categoryId,
        product.name,
        product.description,
        product.price,
        product.sku,
        product.brand,
      ],
    );
  }

  return products.map((product) => ({ id: product.id, price: product.price }));
}

async function seedInventory(products: SeededProduct[]): Promise<void> {
  for (const [index, product] of products.entries()) {
    const totalStock = 10 + ((index * 13) % 91);

    await pool.query(
      `INSERT INTO inventory (id, product_id, total_stock, low_stock_threshold)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO NOTHING`,
      [seedUuid(4, index + 1), product.id, totalStock, 10],
    );
  }
}

async function seedCart(products: SeededProduct[]): Promise<void> {
  const customerId = USERS[2].id;
  const cartId = seedUuid(5, 1);

  await pool.query(
    `INSERT INTO shopping_carts (id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [cartId, customerId],
  );

  const items = [
    { id: seedUuid(6, 1), productId: products[0].id, quantity: 1 },
    { id: seedUuid(6, 2), productId: products[1].id, quantity: 2 },
  ];

  for (const item of items) {
    await pool.query(
      `INSERT INTO cart_items (id, cart_id, product_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cart_id, product_id) DO NOTHING`,
      [item.id, cartId, item.productId, item.quantity],
    );
  }
}

async function seedOrders(products: SeededProduct[]): Promise<void> {
  const customerId = USERS[2].id;
  const statuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
  const paidStatuses: ReadonlySet<string> = new Set(['confirmed', 'shipped', 'delivered']);

  for (const [index, status] of statuses.entries()) {
    const orderId = seedUuid(7, index + 1);
    const product = products[index];
    const quantity = 1;
    const totalAmount = product.price * quantity;

    await pool.query(
      `INSERT INTO orders (id, user_id, status, total_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [orderId, customerId, status, totalAmount],
    );

    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [seedUuid(8, index + 1), orderId, product.id, quantity, product.price],
    );

    if (paidStatuses.has(status)) {
      await pool.query(
        `INSERT INTO payments (id, order_id, user_id, amount, status, payment_key)
         VALUES ($1, $2, $3, $4, 'completed', $5)
         ON CONFLICT (payment_key) DO NOTHING`,
        [
          seedUuid(9, index + 1),
          orderId,
          customerId,
          totalAmount,
          `SEED-PAY-${(index + 1).toString().padStart(3, '0')}`,
        ],
      );
    }
  }
}

export async function seed(): Promise<void> {
  await seedUsers();
  await seedCategories();
  const products = await seedProducts();
  await seedInventory(products);
  await seedCart(products);
  await seedOrders(products);
}
