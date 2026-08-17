# Repository Guidelines

## Project Structure & Module Organization

The root [README.md](README.md) is a Japanese Hedera research and learning guide. The repository has two independent runnable projects:

- `tutorial-local-hardhat/` is the Hardhat + viem contract tutorial:
  - `contracts/` contains Solidity contracts and Foundry-compatible Solidity tests (`*.t.sol`).
  - `test/` contains TypeScript integration tests using `node:test` and viem.
  - `scripts/` contains Hardhat scripts for Hedera deployment and transactions.
  - `hardhat.config.ts` defines compiler profiles and the Hedera RPC network.
- `x402-sample/` is a pnpm workspace demonstrating a Hedera Testnet x402 v2 payment flow:
  - `apps/server/` is a Hono resource server with free `/health` and paid `/premium` endpoints.
  - `apps/client/` is a CLI client that signs a Hedera payment and retries the paid request.
  - `pnpm-workspace.yaml` and `pnpm-lock.yaml` define the workspace and its locked dependencies.

Run commands from the applicable project directory. Do not mix the tutorial's npm lockfile with the x402 sample's pnpm workspace.

## Build, Test, and Development Commands

From `tutorial-local-hardhat/`:

- `npm install` installs dependencies from `package-lock.json`.
- `npm run build` compiles contracts and performs Hardhat's build/type-check workflow.
- `npm test` runs the complete test suite.
- `npx hardhat test solidity` runs Solidity tests only.
- `npx hardhat test nodejs` runs TypeScript integration tests only.
- `npm run deploy` and `npm run send-tx` interact with Hedera; set `HEDERA_RPC_URL` and `HEDERA_PRIVATE_KEY` first. Do not use these as routine verification because they can broadcast transactions.

From `x402-sample/`:

- `pnpm install` installs workspace dependencies from `pnpm-lock.yaml`.
- `pnpm build` type-checks both applications, and `pnpm test` runs their test suites.
- `pnpm check` runs Biome format/lint checks, Knip, builds, and tests.
- `pnpm dev:server` starts the local resource server.
- `RUN_LIVE_X402=1 pnpm test:live` makes an intentional Hedera Testnet payment; do not run it as routine verification.

## Coding Style & Naming Conventions

Use ESM TypeScript with 2-space indentation, semicolons, trailing commas, and descriptive lowerCamelCase identifiers. Keep imports grouped at the top. The x402 workspace uses Biome for formatting and linting. Solidity uses `pragma solidity ^0.8.28`, SPDX headers, 2-space indentation, PascalCase contract names, and lowerCamelCase functions/state. Keep the `Counter` contract a small test fixture unless a task explicitly expands it.

## Testing Guidelines

Add Solidity unit tests beside contracts as `*.t.sol`; name standard tests `test_...` and fuzz tests `testFuzz_...`. Add tutorial integration tests under `test/` with `describe`/`it`, `node:assert/strict`, and viem. Use bigint literals for EVM values, for example `1n`. For x402 changes, keep configuration and middleware behavior covered by the package Vitest tests. Run the focused suite while iterating, then run the applicable project's build and test commands before submitting.

## Commit & Pull Request Guidelines

Existing history uses short imperative subjects such as `update` and `Update README.md`. Prefer a more specific imperative summary, for example `Add Counter increment validation`. Keep commits narrowly scoped. Pull requests should explain the behavior change, list commands run, link relevant issues, and include deployment addresses or transaction hashes only when a network interaction was intentional. Include screenshots only for user-visible output.

## Security & Configuration

Never commit private keys, RPC credentials, or funded-account data. Supply Hedera configuration through Hardhat variables or environment variables; use the x402 `.env.example` files as templates only. Validate network settings before any live transaction. Treat tutorial deployment/transaction scripts and the x402 live-payment test as transaction-broadcasting operations that require explicit intent.
