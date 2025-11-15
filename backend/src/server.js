import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyPayment, settlePayment } from './facilitatorClient.js';
import { jokes } from './staticJokes.js';

bootstrapEnv();

const config = {
  port: Number(process.env.PORT ?? 3000),
  priceCents: Number(process.env.JOKE_PRICE_CENTS ?? 1),
  currency: process.env.JOKE_CURRENCY ?? 'USDC',
  network: process.env.JOKE_NETWORK ?? 'base-sepolia',
  facilitatorUrl:
    process.env.FACILITATOR_URL ??
    'https://api.demo-facilitator.invalid/x402/facilitator',
  payTo: process.env.SELLER_ID ?? 'demo.seller',
  sellerName: process.env.SELLER_NAME ?? '1¢ Joke Agent',
  policyLabel: process.env.POLICY_LABEL ?? 'daily-$1',
  mockFacilitator: process.env.MOCK_FACILITATOR ?? '1'
};

const pendingPayments = new Map();

const server = createServer(async (req, res) => {
  if (!req.url) {
    return respond(res, 400, { error: 'bad_request' });
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return respond(res, 200, { ok: true, uptime: process.uptime() });
  }

  if (req.method === 'GET' && url.pathname === '/joke') {
    return handleJoke(req, res);
  }

  return respond(res, 404, { error: 'not_found' });
});

server.listen(config.port, () => {
  console.log(
    `⚡️ Paid joke API ready on http://localhost:${config.port} (mock facilitator: ${
      config.mockFacilitator !== '0' ? 'on' : 'off'
    })`
  );
});

setInterval(cleanupExpiredInvoices, 30_000).unref();

async function handleJoke(req, res) {
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  const paymentHeader = req.headers['x-payment'];

  if (!paymentHeader) {
    const requirement = buildPaymentRequirement(requestId);
    pendingPayments.set(requirement.invoice_nonce, requirement);
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId
    });
    res.end(JSON.stringify(requirement, null, 2));
    return;
  }

  const verification = await verifyPayment({
    paymentHeader,
    pendingPayments,
    facilitatorUrl: config.facilitatorUrl
  });

  if (!verification.ok) {
    return respond(
      res,
      402,
      Object.assign(
        { error: 'payment_invalid', reason: verification.reason },
        verification.detail ?? {}
      ),
      { 'X-Request-Id': requestId }
    );
  }

  await settlePayment({ verification });

  const joke = selectJoke();
  const audit = {
    spent: (config.priceCents / 100).toFixed(2),
    currency: config.currency,
    tx: verification.txId,
    policy: config.policyLabel,
    vendor: config.sellerName
  };

  return respond(res, 200, { joke, audit }, { 'X-Request-Id': requestId });
}

function buildPaymentRequirement(requestId) {
  const expiresInMs = Number(process.env.INVOICE_TTL_MS ?? 120_000);
  const expiresAt = Date.now() + expiresInMs;
  const invoiceNonce = randomUUID();
  return {
    error: 'payment_required',
    request_id: requestId,
    invoice_nonce: invoiceNonce,
    price: {
      amount: (config.priceCents / 100).toFixed(2),
      currency: config.currency
    },
    facilitator: {
      url: config.facilitatorUrl,
      pay_to: config.payTo,
      network: config.network
    },
    seller: {
      id: config.payTo,
      name: config.sellerName
    },
    policy: {
      label: config.policyLabel
    },
    expires_at: new Date(expiresAt).toISOString(),
    created_at: new Date().toISOString()
  };
}

function cleanupExpiredInvoices() {
  const now = Date.now();
  for (const [nonce, invoice] of pendingPayments.entries()) {
    const expires = Date.parse(invoice.expires_at);
    if (Number.isFinite(expires) && expires < now) {
      pendingPayments.delete(nonce);
    }
  }
}

function selectJoke() {
  const idx = Math.floor(Math.random() * jokes.length);
  return jokes[idx] ?? jokes[0];
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers
  });
  res.end(JSON.stringify(body, null, 2));
}

function bootstrapEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!key) continue;
    const value = rest.join('=');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

