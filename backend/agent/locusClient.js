import { randomUUID } from 'node:crypto';

const DEFAULT_AUTHORIZE_PATH = '/v1/payment_intents';
const DEFAULT_AUDIT_PATH = '/v1/audit';
const REQUEST_TIMEOUT_MS = 15_000;

const oauthCache = {
  token: null,
  expiresAt: 0
};

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

  const config = getLocusConfig();
  const payload = buildAuthorizePayload({
    config,
    vendor,
    amount,
    currency,
    memo,
    invoiceNonce
  });

  const response = await locusRequest(config, {
    path: config.authorizePath,
    method: 'POST',
    body: payload
  });

  const normalized = normalizeAuthorizeResponse(response);

  return {
    approved: normalized.approved,
    paymentHeader: normalized.paymentHeader,
    auditId: normalized.auditId,
    vendor,
    amount,
    currency,
    memo
  };
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

  if (!auditId) {
    throw new Error('fetchAudit requires the auditId returned by authorizeSpend');
  }

  const config = getLocusConfig();
  const response = await locusRequest(config, {
    path: `${config.auditPath}/${encodeURIComponent(auditId)}`,
    method: 'GET'
  });

  return normalizeAuditResponse(response, auditId);
}

function getLocusConfig() {
  const apiUrl = requiredEnv('LOCUS_API_URL');
  const authorizePath =
    process.env.LOCUS_AUTHORIZE_PATH ?? DEFAULT_AUTHORIZE_PATH;
  const auditPath = process.env.LOCUS_AUDIT_PATH ?? DEFAULT_AUDIT_PATH;
  const agentId = requiredEnv('LOCUS_AGENT_ID');
  const policyId = requiredEnv('LOCUS_POLICY_ID');
  const ownerAddress = requiredEnv('LOCUS_WALLET_ADDRESS');
  const ownerPrivateKey = process.env.LOCUS_WALLET_PRIVATE_KEY;
  const apiKey = process.env.LOCUS_API_KEY;
  const clientId = process.env.LOCUS_CLIENT_ID;
  const clientSecret = process.env.LOCUS_CLIENT_SECRET;
  const oauthTokenUrl = process.env.LOCUS_OAUTH_TOKEN_URL;

  if (!apiKey && !(clientId && clientSecret)) {
    throw new Error(
      'Set LOCUS_API_KEY or the LOCUS_CLIENT_ID/LOCUS_CLIENT_SECRET pair.'
    );
  }
  if (!apiKey && !oauthTokenUrl) {
    throw new Error('LOCUS_OAUTH_TOKEN_URL is required for OAuth credentials.');
  }

  return {
    apiUrl,
    authorizePath,
    auditPath,
    agentId,
    policyId,
    ownerAddress,
    ownerPrivateKey,
    apiKey,
    clientId,
    clientSecret,
    oauthTokenUrl
  };
}

function buildAuthorizePayload({
  config,
  vendor,
  amount,
  currency,
  memo,
  invoiceNonce
}) {
  if (!invoiceNonce) {
    throw new Error('authorizeSpend requires the invoice nonce from the seller');
  }

  return {
    agent_id: config.agentId,
    policy_id: config.policyId,
    vendor,
    invoice_nonce: invoiceNonce,
    owner: {
      address: config.ownerAddress,
      ...(config.ownerPrivateKey
        ? { private_key: config.ownerPrivateKey }
        : {})
    },
    memo,
    amount: {
      currency,
      value: amount
    }
  };
}

function normalizeAuthorizeResponse(raw) {
  if (!raw) {
    throw new Error('Empty response from Locus authorize API');
  }

  const paymentHeader =
    raw.paymentHeader ?? raw.payment_header ?? raw.payment?.header;
  if (!paymentHeader) {
    throw new Error('Locus authorize API did not return a payment header');
  }

  return {
    approved: raw.approved ?? raw.status === 'approved',
    paymentHeader,
    auditId:
      raw.auditId ??
      raw.audit_id ??
      raw.audit?.id ??
      raw.paymentIntentId ??
      raw.payment_intent_id ??
      randomUUID()
  };
}

function normalizeAuditResponse(raw, fallbackAuditId) {
  if (!raw) {
    throw new Error('Empty response from Locus audit API');
  }

  const audit = raw.audit ?? raw;
  const amountRecord = audit.amount ?? {};

  return {
    auditId: audit.auditId ?? audit.id ?? fallbackAuditId,
    spent:
      typeof amountRecord.value !== 'undefined'
        ? String(amountRecord.value)
        : audit.spent ??
          (Number(process.env.JOKE_PRICE_CENTS ?? 1) / 100).toFixed(2),
    currency:
      amountRecord.currency ??
      audit.currency ??
      process.env.JOKE_CURRENCY ??
      'USDC',
    policy:
      audit.policy ??
      audit.policyLabel ??
      process.env.POLICY_LABEL ??
      'daily-$1',
    vendor: audit.vendor ?? audit.payee ?? process.env.SELLER_NAME,
    tx: audit.tx ?? audit.transactionId ?? audit.transaction_id,
    timestamp: audit.timestamp ?? audit.created_at ?? new Date().toISOString(),
    detail: audit
  };
}

async function locusRequest(config, { path, method, body }) {
  const url = new URL(path, config.apiUrl);
  const headers = await buildAuthHeaders(config);
  headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const data = await safeJson(response);
    if (!response.ok) {
      throw new Error(
        `Locus request failed (${response.status}): ${JSON.stringify(data)}`
      );
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Locus request to ${url.pathname} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildAuthHeaders(config) {
  if (config.apiKey) {
    return {
      Authorization: `Bearer ${config.apiKey}`
    };
  }

  const token = await getOAuthToken(config);
  return {
    Authorization: `Bearer ${token}`
  };
}

async function getOAuthToken(config) {
  const now = Date.now();
  if (oauthCache.token && oauthCache.expiresAt > now + 5_000) {
    return oauthCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret
  });

  const response = await fetch(config.oauthTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(
      `Failed to obtain Locus OAuth token (${response.status}): ${JSON.stringify(
        data
      )}`
    );
  }

  oauthCache.token = data.access_token;
  oauthCache.expiresAt = now + (Number(data.expires_in ?? 3600) * 1000);
  return oauthCache.token;
}

async function safeJson(response) {
  if (!response) {
    return {};
  }
  try {
    const raw = await response.text();
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Set the ${key} environment variable to use the Locus client`);
  }
  return value;
}

