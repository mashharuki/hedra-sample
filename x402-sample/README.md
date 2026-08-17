# Hedera x402 Testnet Sample

This monorepo demonstrates the smallest complete Hedera x402 v2 payment flow: a Hono resource server returns `402 Payment Required`, and a CLI client signs an exact HBAR transfer and retries the request. The official x402 facilitator verifies, signs as the fee payer, and settles on Hedera Testnet.

## Prerequisites

- Node.js 22+ and pnpm 10+
- A funded Hedera Testnet payer account and private key
- A separate Hedera Testnet payout account ID for the resource server

Get test HBAR from the [Hedera Testnet faucet](https://docs.hedera.com/learn/getting-started/testnet-faucet). Never commit a private key.

## Run

```sh
cd x402-sample
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env
```

Set `PAY_TO_ACCOUNT_ID` in `apps/server/.env`, then set `PAYER_ACCOUNT_ID` and `PAYER_PRIVATE_KEY` in `apps/client/.env`. Start the server in one terminal:

```sh
pnpm dev:server
```

Run the explicitly authorized live payment check in another terminal:

```sh
RUN_LIVE_X402=1 pnpm test:live
```

The client pays `PRICE_TINYBARS` (default: `1000`) of HBAR and prints the paid JSON response and settlement information. The normal test suite never sends a transaction. `pnpm run:client` is also available for direct CLI use.

## Checks

```sh
pnpm check
```

`pnpm check` runs Biome, Knip, TypeScript builds, and tests. `GET /health` is free; `GET /premium` is x402-protected.
