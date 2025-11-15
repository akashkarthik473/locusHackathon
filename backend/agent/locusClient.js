import { randomUUID } from 'node:crypto';

/**
 * Placeholder for calling the Locus policy engine to authorize a spend.
 * Replace the mock branch with a real HTTP call once you have Locus
 * credentials. Return an object that includes the X-PAYMENT header
 * you should send back to the seller.
 */
export async function authorizeSpend({
  vendor,
  amount,
  currency,
  memo,
  invoiceNonce
}) {
  if (process.env.MOCK_LOCUS !== '0') {
    return {
      approved: true,
      paymentHeader: `demo ${invoiceNonce}`,
      auditId: `mock-audit-${randomUUID()}`,
      vendor,
      amount,
      currency,
      memo
    };
  }

  throw new Error(
    'Hook up the Locus authorizeSpend API in agent/locusClient.js once credentials are available.'
  );
}

/**
 * Placeholder for retrieving the audit log entry from Locus after a
 * spend is approved/settled.
 */
export async function fetchAudit(auditId) {
  if (process.env.MOCK_LOCUS !== '0') {
    return {
      auditId,
      spent: (Number(process.env.JOKE_PRICE_CENTS ?? 1) / 100).toFixed(2),
      currency: process.env.JOKE_CURRENCY ?? 'USDC',
      policy: process.env.POLICY_LABEL ?? 'daily-$1',
      tx: `mock-tx-${auditId.split('-').pop()}`,
      vendor: process.env.SELLER_NAME ?? '1¢ Joke Agent',
      timestamp: new Date().toISOString()
    };
  }

  throw new Error('Implement fetchAudit with the Locus audit API.');
}

