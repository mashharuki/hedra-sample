# Suggested commands

## Hardhat tutorial

Run in `tutorial-local-hardhat/`:

- `npm install` — install locked dependencies.
- `npm run build` — compile and type-check through Hardhat.
- `npm test` — execute complete Hardhat suite.
- `npx hardhat test solidity` / `npx hardhat test nodejs` — target one suite.
- `npm run deploy` / `npm run send-tx` — interact with Hedera after configuring credentials.

## x402 sample

Run in `x402-sample/`:

- `pnpm install`, `pnpm build`, `pnpm test`.
- `pnpm check` — Biome format/lint, Knip, builds, tests.
- `pnpm dev:server` — run the local resource server.
- `RUN_LIVE_X402=1 pnpm test:live` — paid Testnet smoke test; use only when intentionally authorized.