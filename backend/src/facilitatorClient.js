import { randomUUID } from 'node:crypto';

/**
 * Pretend to verify an x402 payment. When MOCK_FACILITATOR !== "0",
 * we'll keep everything in-memory and expect headers shaped as
 * "demo <invoice_nonce>".
 */
export async function verifyPayment({
  paymentHeader,
  pendingPayments,
  facilitatorUrl
}) {
  if (!paymentHeader) {
    return { ok: false, reason: 'missing_header' };
  }

  const [scheme, nonce] = `${paymentHeader}`.split(/\s+/);
  if (process.env.MOCK_FACILITATOR !== '0') {
    if (scheme !== 'demo') {
      return { ok: false, reason: 'unsupported_scheme' };
    }
    const invoice = pendingPayments.get(nonce);
    if (!invoice) {
      return { ok: false, reason: 'unknown_invoice' };
    }
    pendingPayments.delete(nonce);
    return {
      ok: true,
      txId: `mock-tx-${randomUUID()}`,
      amount: invoice.price.amount,
      currency: invoice.price.currency,
      invoice_nonce: nonce,
      facilitatorUrl
    };
  }

  throw new Error(
    'Facilitator verification not wired yet. Replace verifyPayment in src/facilitatorClient.js with calls to the Coinbase x402 facilitator.'
  );
}

export async function settlePayment({ verification }) {
  if (process.env.MOCK_FACILITATOR !== '0') {
    return {
      ok: true,
      settlementId: verification.txId,
      mode: 'mock'
    };
  }

  throw new Error(
    'Facilitator settlement not wired yet. Call /settle on the facilitator API.'
  );
}

