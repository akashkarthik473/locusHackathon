#!/usr/bin/env node
import { CdpClient } from "@coinbase/cdp-sdk";
import { toAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config()

const cdp = new CdpClient();
const cdpAccount = await cdp.evm.createAccount();
const account = toAccount(cdpAccount);

const fetchWithPayment = wrapFetchWithPayment(fetch, account);

fetchWithPayment(url, {
  method: 'GET',
})
.then(async response => {
  const body = await response.json();
  console.log(body);

  const paymentHeader = response.headers.get("x-payment-response");
  if (paymentHeader) {
    const paymentResponse = decodeXPaymentResponse(paymentHeader);
    console.log(paymentResponse);
  }
})
.catch(error => {
  console.error(error.response && error.response.data ? error.response.data.error : error.message || error);
})