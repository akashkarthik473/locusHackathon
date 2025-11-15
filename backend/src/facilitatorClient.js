import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdpEntry = require.resolve('@coinbase/cdp-sdk');
const cdpPackageRoot = join(dirname(cdpEntry), '..');
const {
  configure: configureCoinbaseClient
} = require(
  join(
    cdpPackageRoot,
    '_cjs',
    'openapi-client',
    'cdpApiClient.js'
  )
);
const {
  verifyX402Payment,
  settleX402Payment
} = require(
  join(
    cdpPackageRoot,
    '_cjs',
    'openapi-client',
    'generated',
    'x402-facilitator',
    'x402-facilitator.js'
  )
);

const X402_VERSION = 1;
const DEMO_SCHEME = 'demo';
const X402_SCHEME = 'x402';
let facilitatorConfigured = false;

export async function verifyPayment({
  paymentHeader,
  pendingPayments,
  facilitatorUrl
}) {
  if (!paymentHeader) {
    return { ok: false, reason: 'missing_header' };
  }

  if (process.env.MOCK_FACILITATOR !== '0') {
    return handleMockVerification(paymentHeader, pendingPayments, facilitatorUrl);
  }

  ensureFacilitatorClientConfigured(facilitatorUrl);

  const parsedHeader = parsePaymentHeader(paymentHeader);
  if (!parsedHeader.valid) {
    return {
      ok: false,
      reason: 'invalid_header',
      detail: { error: parsedHeader.error }
    };
  }

  const invoiceNonce = extractInvoiceNonce(parsedHeader.payload);
  if (!invoiceNonce) {
    return {
      ok: false,
      reason: 'missing_invoice_nonce'
    };
  }

  const invoice = pendingPayments.get(invoiceNonce);
  if (!invoice) {
    return { ok: false, reason: 'unknown_invoice' };
  }
  pendingPayments.delete(invoiceNonce);

  const paymentRequirements = buildPaymentRequirements(invoice);

  try {
    const verificationResponse = await verifyX402Payment({
      x402Version: X402_VERSION,
      paymentPayload: parsedHeader.payload,
      paymentRequirements
    });

    if (!verificationResponse.isValid) {
      return {
        ok: false,
        reason: 'facilitator_rejected',
        detail: {
          invalid_reason: verificationResponse.invalidReason
        }
      };
    }

    return {
      ok: true,
      invoice,
      invoiceNonce,
      facilitatorUrl,
      payer: verificationResponse.payer,
      paymentPayload: parsedHeader.payload,
      paymentRequirements
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'facilitator_error',
      detail: serializeError(err)
    };
  }
}

export async function settlePayment({ verification }) {
  if (process.env.MOCK_FACILITATOR !== '0') {
    return {
      ok: true,
      txId: `mock-tx-${randomUUID()}`,
      payer: verification?.payer ?? 'mock-buyer',
      network: verification?.invoice?.facilitator?.network ?? 'mock-network'
    };
  }

  ensureFacilitatorClientConfigured(verification.facilitatorUrl);

  try {
    const settlementResponse = await settleX402Payment({
      x402Version: X402_VERSION,
      paymentPayload: verification.paymentPayload,
      paymentRequirements: verification.paymentRequirements
    });

    if (!settlementResponse.success) {
      throw new Error(
        `Settlement failed: ${settlementResponse.errorReason ?? 'unknown'}`
      );
    }

    return {
      ok: true,
      txId: settlementResponse.transaction,
      payer: settlementResponse.payer ?? verification.payer,
      network: settlementResponse.network
    };
  } catch (err) {
    throw new Error(
      `Facilitator settlement failed: ${JSON.stringify(serializeError(err))}`
    );
  }
}

function handleMockVerification(paymentHeader, pendingPayments, facilitatorUrl) {
  const [scheme, nonce] = `${paymentHeader}`.split(/\s+/);
  if (scheme !== DEMO_SCHEME) {
    return { ok: false, reason: 'unsupported_scheme' };
  }
  const invoice = pendingPayments.get(nonce);
  if (!invoice) {
    return { ok: false, reason: 'unknown_invoice' };
  }
  pendingPayments.delete(nonce);
  const paymentRequirements = buildPaymentRequirements(invoice);
  return {
    ok: true,
    invoice,
    invoiceNonce: nonce,
    facilitatorUrl,
    payer: invoice.seller?.id ?? invoice.seller?.name ?? 'demo-buyer',
    paymentPayload: { scheme: DEMO_SCHEME, invoice_nonce: nonce },
    paymentRequirements
  };
}

function ensureFacilitatorClientConfigured(facilitatorUrl) {
  if (facilitatorConfigured) {
    return;
  }
  const apiKey = requiredEnv('COINBASE_API_KEY');
  const apiSecret = requiredEnv('COINBASE_API_SECRET');

  configureCoinbaseClient({
    apiKeyId: apiKey.trim(),
    apiKeySecret: apiSecret.trim(),
    basePath: deriveFacilitatorBasePath(facilitatorUrl),
    source: 'paid-joke-agent',
    sourceVersion: '0.1.0'
  });

  facilitatorConfigured = true;
}

function parsePaymentHeader(headerValue) {
  const [scheme, encoded] = `${headerValue}`.split(/\s+/);
  if (!scheme || !encoded) {
    return { valid: false, error: 'header_format_invalid' };
  }
  if (scheme.toLowerCase() !== X402_SCHEME) {
    return { valid: false, error: 'scheme_not_x402' };
  }

  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(normalized, 'base64').toString());
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: `header_parse_failed: ${err.message}` };
  }
}

function extractInvoiceNonce(payload) {
  return (
    payload?.payload?.authorization?.nonce ??
    payload?.payload?.nonce ??
    payload?.invoice_nonce ??
    payload?.nonce ??
    payload?.extra?.invoice_nonce ??
    null
  );
}

function buildPaymentRequirements(invoice) {
  const decimals = Number(invoice?.payment?.asset?.decimals ?? 6);
  const priceCents = Number(
    invoice?.price_cents ??
      Math.round(Number(invoice?.price?.amount ?? 0) * 100)
  );
  const amountAtomic = convertCentsToAtomic(priceCents, decimals);
  let description = 'Paid resource';
  try {
    const url = new URL(invoice.resource);
    description = `GET ${url.pathname} (${url.hostname})`;
  } catch {
    // ignore parse errors
  }
  return {
    scheme: 'exact',
    network: invoice.facilitator?.network,
    maxAmountRequired: amountAtomic,
    resource: invoice.resource,
    description,
    mimeType: invoice.mime_type ?? 'application/json',
    payTo: invoice.facilitator?.pay_to,
    maxTimeoutSeconds: Math.ceil((invoice.ttl_ms ?? 120_000) / 1000),
    asset: invoice.payment?.asset?.address ?? invoice.facilitator?.pay_to,
    extra: {
      invoice_nonce: invoice.invoice_nonce,
      policy_label: invoice.policy?.label,
      seller_id: invoice.seller?.id
    }
  };
}

function convertCentsToAtomic(priceCents, decimals) {
  const cents = BigInt(Math.round(priceCents ?? 0));
  const delta = decimals - 2;
  if (delta >= 0) {
    return (cents * 10n ** BigInt(delta)).toString();
  }
  const divisor = 10n ** BigInt(Math.abs(delta));
  return (cents / divisor).toString();
}

function deriveFacilitatorBasePath(facilitatorUrl) {
  if (!facilitatorUrl) {
    return 'https://api.cdp.coinbase.com/platform';
  }
  try {
    const url = new URL(facilitatorUrl);
    if (url.pathname.includes('/x402/facilitator')) {
      return `${url.origin}/platform`;
    }
    return `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return 'https://api.cdp.coinbase.com/platform';
  }
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Set ${key} before using the Coinbase facilitator.`);
  }
  return value;
}

function serializeError(err) {
  if (!err) return {};
  if (err.response?.data) {
    return err.response.data;
  }
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

