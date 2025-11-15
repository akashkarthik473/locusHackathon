# Agents Guide (Cursor)

**Purpose:** Keep this repo lean and working. We ship a tiny paid API (x402-style) with a CLI buyer. No random docs, no framework rewrites, minimal diffs.

---

## Repo Topology (single source of truth)

- `backend/`
  - `src/server.js` → HTTP server. **GET `/joke`** returns **402** until paid; on success returns **200 { joke, audit }`. Also serves `GET /healthz`.
  - `src/facilitatorClient.js` → mock facilitator in dev; swap to real Coinbase x402 `/verify` + `/settle` in prod.
  - `env.sample` → all tunables (price, currency, network, facilitator URL, invoice TTL, `MOCK_*` flags).
- `backend/agent/`
  - `agent.js` → CLI “buyer” loop: hits `/joke`, gets **402**, calls (mocked) Locus, retries with `X-PAYMENT`, prints joke + audit.
  - `locusClient.js` → mocked `authorizeSpend` / `fetchAudit` (enable real calls when `MOCK_LOCUS=0`).
  - `policy.json` → starter Locus policy (per-call ≤ $0.05, daily ≤ $1, vendor allow-list).
- `frontend/`
  - Vite/React placeholder. **Not wired** to the backend contract yet (ports/verbs mismatch). Don’t touch unless a bug/task row authorizes it.
- `bugreport.csv` → the **only** tracker for bugs/tasks.
- `README.md` → minimal, strictly necessary instructions.

**Do not add** other docs (`docs/*`, ADRs, architecture writeups) unless a row in `bugreport.csv` explicitly authorizes it.

---

## API & Protocol Invariants (do not change without a bug row)

- **Endpoint contract**
  - `GET /joke`  
    - Without `X-PAYMENT`: respond **HTTP 402** with a requirement document that includes an **invoice nonce** and pricing fields.
    - With valid `X-PAYMENT`: respond **HTTP 200** with JSON `{ joke, audit }`. Include an `X-Request-Id` header.  
  - `GET /healthz`: readiness probe.

- **Payment handshake**
  - Request header: `X-PAYMENT: ...`
  - 402 body: includes `invoice_nonce` and the data the buyer needs to construct payment.
  - Pending invoices are stored and **GC’d every ~30s** (configurable).
  - On success, record settlement and produce an `audit` payload in the response body (amount, currency, policy label, vendor, tx id if available).

- **Ports/verbs**  
  - Keep `backend` on its current port (default **3000**) and verbs as-is (`GET /joke`). Do **not** introduce new endpoints (e.g., `/buy/joke`) unless authorized via `bugreport.csv`.

---

## Mock Modes & Environment

- `MOCK_FACILITATOR=1` → `verifyPayment` / `settlePayment` short-circuit with mock tx ids.  
  `MOCK_FACILITATOR=0` → implement real Coinbase x402 calls before flipping this.
- `MOCK_LOCUS=1` → `authorizeSpend` returns `paymentHeader: "demo <invoice_nonce>"`.  
  `MOCK_LOCUS=0` → integrate real Locus (respect policy caps and denial cases).
- Don’t flip mocks to `0` unless credentials are present **and** there’s a bug row that authorizes network changes.

---

## Mandatory Workflow (Cursor MUST follow)

**Before any change**
1. **Open `bugreport.csv`** and **summarize all rows** with `status in {open, blocked}`. If the file is missing, create it from the template below and **stop** until the user adds at least one row.
2. Validate environment: check `.env`/`env.sample` for required keys (**price, ttl, facilitator URL, mock flags**). If missing, propose a plan; do not guess.

**When implementing**
3. Write a 3–6 bullet **plan** referencing bug IDs (e.g., `BUG-7`).
4. Make **minimal, surgical diffs**. Do not reformat unrelated files.
5. Do **not** add dependencies to the backend. It intentionally uses Node built-ins. Any dep addition requires a bug row with `allowed_deps`.
6. Only touch files listed in the bug row’s `allowed_files`. Do not create new files unless explicitly permitted there.

**Testing (must pass)**
7. Start the backend: `node backend/src/server.js`
8. 402 probe: `curl -i http://localhost:3000/joke` → **HTTP 402** with requirement JSON (contains `invoice_nonce`).
9. Agent flow: `node backend/agent/agent.js "tell me a joke"` → should print a joke and an audit block.
10. Health: `curl -i http://localhost:3000/healthz` → **200**.

**Afterward**
11. Update `bugreport.csv`:
    - `status=in_review` (then `fixed` once verified)
    - fill `fix_commit`, `verified_by`, `verified_at`
12. Commit message format:

