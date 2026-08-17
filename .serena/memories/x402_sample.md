# Hedera x402 sample

- `x402-sample/` is a pnpm 10.33 workspace (Node 22+) with `@x402-sample/server` and `@x402-sample/client`; lockfile: `pnpm-lock.yaml`.
- Server: Hono resource server; free `GET /health`, paid `GET /premium`; supports Hedera exact-payment through the x402 facilitator (default `https://x402.org/facilitator`).
- Client: signs an exact HBAR transfer, retries `/premium`, and reports settlement. Environment templates are local `.env.example` files; do not commit real private keys or funded account data.
- Run pnpm commands from `x402-sample/`: `pnpm build`, `pnpm test`, `pnpm check`, `pnpm dev:server`.
- `RUN_LIVE_X402=1 pnpm test:live` deliberately initiates a Testnet payment; never use it as ordinary verification.