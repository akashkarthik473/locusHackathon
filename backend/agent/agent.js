#!/usr/bin/env node
import { X402Buyer } from '@coinbase/x402';

const API_URL = process.env.JOKE_API_URL ?? 'http://localhost:3000/joke';
const userPrompt = process.argv.slice(2).join(' ') || 'tell me a joke';

async function main() {
  console.log(`🤖 Agent: requesting joke for "${userPrompt}"`);

  // First attempt — expect 402
  const firstTry = await fetchJoke();
  if (firstTry.status === 200) {
    const body = await firstTry.json();
    return printSuccess(body);
  }
  if (firstTry.status !== 402) {
    const errorBody = await safeJson(firstTry);
    throw new Error(`Unexpected response: ${firstTry.status} ${JSON.stringify(errorBody)}`);
  }

  // Parse 402 payment requirement
  const paymentRequirement = await firstTry.json();
  console.log('💸 Payment required:', paymentRequirement.price);

  // Create X402 Buyer tied to your CDP wallet
  const buyer = new X402Buyer({
    walletId: process.env.CDP_WALLET_ID,             // note: lowercase "Id"
    walletPrivateKey: process.env.CDP_WALLET_PRIVATE_KEY,
    facilitatorUrl: process.env.FACILITATOR_URL,
  });

  // Pay the 402 challenge
  const paymentHeader = await buyer.pay(paymentRequirement);

  // Retry with X-PAYMENT header
  const paidResponse = await fetchJoke(paymentHeader);

  if (paidResponse.status !== 200) {
    const body = await safeJson(paidResponse);
    throw new Error(`Payment attempt failed (${paidResponse.status}): ${JSON.stringify(body)}`);
  }

  const jokeBody = await paidResponse.json();
  printSuccess(jokeBody);
}

main().catch((err) => {
  console.error('Agent failed:', err.message);
  process.exitCode = 1;
});

async function fetchJoke(paymentHeader) {
  return fetch(API_URL, {
    method: 'GET',
    headers: paymentHeader ? { 'X-PAYMENT': paymentHeader } : {},
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text() };
  }
}

function printSuccess(body) {
  console.log('\n🤣 Joke:', body.joke);
  if (body.audit) {
    console.log(
      `🧾 spent: ${body.audit.spent} ${body.audit.currency} | tx: ${body.audit.tx} | vendor: ${body.audit.vendor}`
    );
  }
}
