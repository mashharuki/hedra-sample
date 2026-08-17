# Repository Guidelines

## Project Structure & Module Organization

The root [README.md](README.md) is a Japanese Hedera research and learning guide. The runnable example lives in `tutorial-local-hardhat/`:

- `contracts/` contains Solidity contracts and Foundry-compatible Solidity tests (`*.t.sol`).
- `test/` contains TypeScript integration tests using `node:test` and viem.
- `scripts/` contains Hardhat scripts for Hedera deployment and transactions.
- `hardhat.config.ts` defines compiler profiles and the Hedera RPC network.

Run Node, Hardhat, and npm commands from `tutorial-local-hardhat/`, not the repository root.

## Build, Test, and Development Commands

From `tutorial-local-hardhat/`:

- `npm install` installs dependencies from `package-lock.json`.
- `npm run build` compiles contracts and performs Hardhat's build/type-check workflow.
- `npm test` runs the complete test suite.
- `npx hardhat test solidity` runs Solidity tests only.
- `npx hardhat test nodejs` runs TypeScript integration tests only.
- `npm run deploy` and `npm run send-tx` interact with Hedera; set `HEDERA_RPC_URL` and `HEDERA_PRIVATE_KEY` first. Do not use these as routine verification because they can broadcast transactions.

## Coding Style & Naming Conventions

Use ESM TypeScript with 2-space indentation, semicolons, trailing commas, and descriptive lowerCamelCase identifiers. Keep imports grouped at the top. Solidity uses `pragma solidity ^0.8.28`, SPDX headers, 2-space indentation, PascalCase contract names, and lowerCamelCase functions/state. Keep the `Counter` contract a small test fixture unless a task explicitly expands it.

## Testing Guidelines

Add Solidity unit tests beside contracts as `*.t.sol`; name standard tests `test_...` and fuzz tests `testFuzz_...`. Add integration tests under `test/` with `describe`/`it`, `node:assert/strict`, and viem. Use bigint literals for EVM values, for example `1n`. Run the focused suite while iterating, then run `npm run build` and `npm test` before submitting.

## Commit & Pull Request Guidelines

Existing history uses short imperative subjects such as `update` and `Update README.md`. Prefer a more specific imperative summary, for example `Add Counter increment validation`. Keep commits narrowly scoped. Pull requests should explain the behavior change, list commands run, link relevant issues, and include deployment addresses or transaction hashes only when a network interaction was intentional. Include screenshots only for user-visible output.

## Security & Configuration

Never commit private keys, RPC credentials, or funded-account data. Supply Hedera configuration through Hardhat variables or environment variables, and validate network settings before any live transaction.
