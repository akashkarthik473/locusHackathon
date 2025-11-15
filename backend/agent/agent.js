#!/usr/bin/env node
import fetch from 'node-fetch';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authorizeSpend, fetchAudit } from './locusClient.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(moduleDir, '..', '.env');
loadEnvFile(envPath);

const API_URL = process.env.JOKE_API_URL ?? 'http://localhost:3000/joke';
const userPrompt = process.argv.slice(2).join(' ') || 'tell me a joke';

async function main() {
  console.log(`🤖 Agent: requesting joke for "${userPrompt}"`);

  // 1️⃣ First request — expect HTTP 402 Payment Required
  const firstTry = await fetchJoke();
  if (firstTry.status === 200) {
    const body = await firstTry.json();
    return printSuccess(body);
  }
  if (firstTry.status !== 402) {
    const errorBody = await safeJson(firstTry);
    throw new Error(
      `Unexpected response: ${firstTry.status} ${JSON.stringify(errorBody)}`
    );
  }

  // 2️⃣ Parse payment requirement challenge
  const challenge = await firstTry.json();
  console.log('💸 Payment required:', challenge.price);

  // 3️⃣ Ask Locus to authorize the spend + build the X-PAYMENT header
  const approval = await authorizeSpend({
    vendor: challenge.seller?.id ?? challenge.facilitator?.pay_to,
    amount: challenge.price.amount,
    currency: challenge.price.currency,
    memo: userPrompt,
    invoiceNonce: challenge.invoice_nonce
  });

  if (!approval?.approved || !approval.paymentHeader) {
    throw new Error(
      `Locus denied the spend${approval?.reason ? ` (${approval.reason})` : ''}`
    );
  }

  const paymentHeader = formatPaymentHeader(approval.paymentHeader);

  // 4️⃣ Retry with X-PAYMENT header
  const paidResponse = await fetchJoke(paymentHeader);

  if (paidResponse.status !== 200) {
    const body = await safeJson(paidResponse);
    throw new Error(
      `Payment attempt failed (${paidResponse.status}): ${JSON.stringify(body)}`
    );
  }

  const jokeBody = await paidResponse.json();
  const locusAudit = await maybeFetchAudit(approval.auditId);
  printSuccess(jokeBody, locusAudit);
}

main().catch((err) => {
  console.error('Agent failed:', err.message);
  process.exitCode = 1;
});

async function fetchJoke(paymentHeader) {
  return fetch(API_URL, {
    method: 'GET',
    headers: paymentHeader ? { 'X-PAYMENT': paymentHeader } : {}
  });
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

async function maybeFetchAudit(auditId) {
  if (!auditId) {
    return null;
  }
  try {
    return await fetchAudit(auditId);
  } catch (err) {
    console.warn('⚠️  Failed to fetch Locus audit:', err.message ?? err);
    return null;
  }
}

function printSuccess(body, locusAudit) {
  console.log('\n🤣 Joke:', body.joke);
  const audit = locusAudit ?? body.audit;
  if (audit) {
    console.log(
      `🧾 spent: ${audit.spent} ${audit.currency} | tx: ${
        audit.tx ?? audit.transaction ?? 'n/a'
      } | vendor: ${audit.vendor ?? 'unknown'}`
    );
  }
}

function formatPaymentHeader(rawHeader) {
  if (rawHeader.toLowerCase().startsWith('x402 ')) {
    return rawHeader;
  }
  if (rawHeader.toLowerCase().startsWith('demo ')) {
    return rawHeader;
  }
  return `x402 ${rawHeader}`;
}

function loadEnvFile(path) {
  try {
    if (!existsSync(path)) {
      return;
    }
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (!key) continue;
      const value = rest.join('=');
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn('⚠️  Failed to load .env:', err.message);
  }
}
