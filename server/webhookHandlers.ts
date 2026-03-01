import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const stripe = await getUncachableStripeClient();
      const event = JSON.parse(payload.toString());

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        if (session.payment_status !== 'paid') {
          console.log(`[Stripe] Session ${session.id} not paid (status: ${session.payment_status}), skipping`);
          return;
        }

        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || '0', 10);

        if (userId && credits > 0) {
          await storage.addCredits(userId, credits, `${credits}クレジット購入`, session.id);

          if (session.customer) {
            await storage.updateUserStripeCustomerId(userId, session.customer);
          }

          console.log(`[Stripe] Added ${credits} credits to user ${userId}`);
        }
      }
    } catch (err) {
      console.error('[Stripe] Error processing webhook event:', err);
    }
  }
}
