# 1¢ Joke Agent

This repository now has two pieces:

1. `backend/` – dependency-free Node backend that exposes a 1¢ `/joke` endpoint (HTTP 402 until paid) plus a buyer/agent script that shows the Locus → x402 payment loop.
2. `frontend/` – the existing Vite playground if you want to surface the joke agent in a UI.

## Quick start (backend)
```bash
cd backend
cp env.sample .env          # optional; tweak price/policy/facilitator
node src/server.js          # starts http://localhost:3000/joke
node agent/agent.js "tell me a joke"
```

You can still `curl -i http://localhost:3000/joke` to see the raw 402 payload. Wire the facilitator + Locus calls per `backend/README.md` once you have credentials.

## Frontend
Inside `frontend/` you can continue to iterate on UI/UX. Run `npm install && npm run dev` from that folder and point it at the backend server.
