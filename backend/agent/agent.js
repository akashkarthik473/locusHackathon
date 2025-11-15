#!/usr/bin/env node
import { authorizeSpend, fetchAudit } from './locusClient.js';

const API_URL = process.env.JOKE_API_URL ?? 'http://localhost:3000/joke';
const userPrompt = process.argv.slice(2).join(' ') || 'tell me a joke';

async function main() {
  console.log(`🤖 Agent: requesting joke for "${userPrompt}"`);
  const firstTry = await fetchJoke();
  if (firstTry.status === 200) {
    const body = await firstTry.json();
    return printSuccess(body, null);
  }
  if (firstTry.status !== 402) {
    const errorBody = await safeJson(firstTry);
    throw new Error(`Unexpected response: ${firstTry.status} ${JSON.stringify(errorBody)}`);
  }

  const paymentRequirement = await firstTry.json();
  console.log('💸 Payment required:', paymentRequirement.price);

  const approval = await authorizeSpend({
    vendor: paymentRequirement?.seller?.id ?? 'demo.seller',
    amount: paymentRequirement?.price?.amount ?? '0.01',
    currency: paymentRequirement?.price?.currency ?? 'USDC',
    memo: userPrompt,
    invoiceNonce: paymentRequirement?.invoice_nonce
  });

  if (!approval?.paymentHeader) {
    throw new Error('Locus approval did not return an X-PAYMENT header');
  }

  const paidResponse = await fetchJoke(approval.paymentHeader);
  if (paidResponse.status !== 200) {
    const body = await safeJson(paidResponse);
    throw new Error(
      `Payment attempt failed (${paidResponse.status}). Response: ${JSON.stringify(body)}`
    );
  }

  const jokeBody = await paidResponse.json();
  const audit = approval.auditId ? await fetchAudit(approval.auditId) : null;
  printSuccess(jokeBody, audit ?? jokeBody.audit ?? null);
}

main().catch((err) => {
  console.error('Agent failed:', err.message);
  process.exitCode = 1;
});

async function fetchJoke(paymentHeader) {
  return fetch(API_URL, {
    method: 'GET',
    headers: {
      ...(paymentHeader ? { 'X-PAYMENT': paymentHeader } : {})
    }
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text() };
  }
}

function printSuccess(body, audit) {
  console.log('\n🤣 Joke:', body.joke);
  if (audit) {
    console.log(
      `🧾 spent: ${audit.spent ?? body.audit?.spent} ${audit.currency ?? body.audit?.currency} | tx: ${
        audit.tx ?? audit.auditId ?? 'mock'
      } | policy: ${audit.policy ?? 'n/a'} | vendor: ${
        audit.vendor ?? body.audit?.vendor ?? 'demo.seller'
      }`
    );
  }
}

