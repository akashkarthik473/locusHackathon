## 1¢ Joke Agent Backend

This folder contains a tiny seller endpoint (`/joke`) plus a matching buyer/agent script that demonstrates the Locus → x402 → merchant loop.

### What's here
- `src/server.js` & `src/facilitatorClient.js`: a one-route HTTP server that protects `GET /joke` behind a 1¢ paywall. It emits standards-style HTTP 402 responses, verifies the retry via a facilitator helper, and returns the joke plus an audit snippet.
- `agent/agent.js`: ~60 lines that replay the buyer quickstart. It calls `/joke`, sees the 402, asks Locus (mocked for now) to authorize the spend, retries with `X-PAYMENT`, and prints the joke + audit trail.
- `agent/policy.json`: copy/paste starter for the Locus policy (per-request ≤ $0.05, daily ≤ $1, vendor allow-list = localhost joke endpoint).
- `env.sample`: drop this to `.env` (or export the variables) to control price, facilitator URL, policy labels, etc.

### Install & run
No third-party dependencies are required; everything uses Node 18+ built-ins.

```bash
cd backend
cp env.sample .env              # optional
node src/server.js              # starts http://localhost:3000/joke
node agent/agent.js "tell me a joke"
```

Expected dev flow:

1. `curl -i http://localhost:3000/joke` → observe `HTTP/1.1 402` with the payment JSON (nonce, facilitator URL, etc.).
2. `node agent/agent.js "tell me a joke"` → the agent auto-pays (mocked), retries with `X-PAYMENT`, and prints something like `spent: 0.01 USDC | tx: mock-tx-... | policy: daily-$1 | vendor: 1¢ Joke Agent`.
3. Run the agent until you hit the `$1/day` limit once you wire Locus; the authorize step will start denying and you can show the audit line.

### Wiring the real facilitator
`src/facilitatorClient.js` currently uses an in-memory mock. Replace the `verifyPayment` and `settlePayment` functions with calls to the Coinbase x402 facilitator endpoints:

1. `POST /verify` with the `X-PAYMENT` header you received. Expect a 200 that includes the proof you need to settle.
2. `POST /settle` with the facilitator token once verification passes.

Keep the `pendingPayments` Map in `server.js`—it already tracks the invoice nonce the facilitator expects.

### Hooking in Locus
`agent/locusClient.js` has two placeholders:

1. `authorizeSpend` should call Locus with the price, vendor, memo, and policy constraints. Return the `X-PAYMENT` header (or payment blob) they give you.
2. `fetchAudit` should read back the audit event (amount, tx hash, policy, timestamp) so the CLI can print it.

Leave `MOCK_LOCUS=1` while you stub; flip it to `0` once the real HTTP calls are in place.

### Demo script (90 seconds)
1. **Show the 402** – `curl -i http://localhost:3000/joke`.
2. **Show the agent** – `node agent/agent.js "tell me a joke"` → highlight the automatic pay + audit line.
3. **Show policy enforcement** – invoke the agent repeatedly (or tweak `JOKE_PRICE_CENTS`) until Locus denies with the `$1/day` ceiling, then display the audit log row.

### Files worth skimming
- `src/server.js`: main request handler, payment requirement builder, mock facilitator integration.
- `src/staticJokes.js`: add as many jokes as you like.
- `agent/agent.js`: buyer quickstart loop with Locus hooks.
- `agent/policy.json`: starter policy.

Feel free to rename the folder or move these pieces into your preferred framework—the code stays dependency-free so you can drop it anywhere. When you're ready to deploy, switch off the mock flags, point `FACILITATOR_URL` to Coinbase, and replace the placeholder calls with the real APIs linked in the README references. 

