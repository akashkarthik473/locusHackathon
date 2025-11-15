#!/usr/bin/env node
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

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
    throw new Error(`Unexpected response: ${firstTry.status} ${JSON.stringify(errorBody)}`);
  }

  // 2️⃣ Parse payment requirement challenge
  const challenge = await firstTry.json();
  console.log('💸 Payment required:', challenge.price);

  // 3️⃣ Set up wallet client (CDP or any EOA private key)
  const account = privateKeyToAccount(process.env.CDP_WALLET_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  // 4️⃣ Construct payment payload per x402 “payment_proof” format
  const message = {
    invoice_nonce: challenge.invoice_nonce,
    facilitator: challenge.facilitator.url,
    amount: challenge.price.amount,
    currency: challenge.price.currency,
    pay_to: challenge.facilitator.pay_to,
    memo: userPrompt,
  };

  const signature = await walletClient.signMessage({
    account,
    message: JSON.stringify(message),
  });

  // Helper for encoding Base64 (no external utils)
  function encodeBase64(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
  }

  // Encode as X-PAYMENT header (Base64)
  const paymentHeader = encodeBase64({
    message,
    signature,
    wallet: account.address,
  });

  // 5️⃣ Retry with X-PAYMENT header
  const paidResponse = await fetchJoke(`x402 ${paymentHeader}`);

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
