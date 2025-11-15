# x402 Joke Endpoint (testnet)

## Setup
1. `npm i`
2. `cp .env.example .env` and fill:
   - RECEIVER_ADDRESS = your EVM wallet to receive funds
   - PRIVATE_KEY      = test wallet key for the buyer helper
   - NETWORK          = base-sepolia
   - FACILITATOR_URL  = https://x402.org/facilitator

## Run
- `npm start`

## Test
- Unpaid 402: `curl -i http://localhost:3000/joke`
- Paid via helper: `curl http://localhost:3000/buy/joke`

Deploy this server anywhere (Render/Railway/another Repl). Point your Replit front-end at `/buy/joke`.
