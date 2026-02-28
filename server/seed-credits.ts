import { getUncachableStripeClient } from './stripeClient';

const CREDIT_PACKAGES = [
  { name: "スタータークレジット 100", credits: 100, amount: 500, description: "100クレジットパック" },
  { name: "スタンダードクレジット 500", credits: 500, amount: 2000, description: "500クレジットパック（20%お得）" },
  { name: "プレミアムクレジット 1000", credits: 1000, amount: 3500, description: "1000クレジットパック（30%お得）" },
];

export async function seedCreditProducts() {
  try {
    const stripe = await getUncachableStripeClient();

    const allProducts = await stripe.products.list({ limit: 100, active: true });
    const existingCreditProducts = allProducts.data.filter(p => p.metadata?.type === 'credit_package');

    if (existingCreditProducts.length >= CREDIT_PACKAGES.length) {
      console.log('[Seed] Credit products already exist, skipping');
      return;
    }

    for (const pkg of CREDIT_PACKAGES) {
      const exists = existingCreditProducts.find(p => p.metadata?.credits === String(pkg.credits));
      if (exists) {
        console.log(`[Seed] Product ${pkg.name} already exists`);
        continue;
      }

      const product = await stripe.products.create({
        name: pkg.name,
        description: pkg.description,
        metadata: {
          type: "credit_package",
          credits: String(pkg.credits),
        },
      });

      await stripe.prices.create({
        product: product.id,
        unit_amount: pkg.amount,
        currency: 'jpy',
      });

      console.log(`[Seed] Created: ${pkg.name} (${pkg.credits}cr / ¥${pkg.amount})`);
    }

    console.log('[Seed] Credit products seeded successfully');
  } catch (err) {
    console.error('[Seed] Error seeding credit products:', err);
  }
}
