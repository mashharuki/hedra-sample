# Conventions

- TypeScript uses ESM imports, 2-space indentation, semicolons, trailing commas, and descriptive lowerCamelCase identifiers. Scripts that define functions use explicit return types.
- Solidity uses `pragma solidity ^0.8.28`, 2-space indentation, SPDX headers, PascalCase contracts, lowerCamelCase functions/state, and `test_` / `testFuzz_` Foundry tests.
- Hardhat integration tests: `*.ts` under `tutorial-local-hardhat/test/`, use `describe`/`it`, `node:assert/strict`, viem clients, and bigint EVM values (for example `1n`).
- Keep `Counter` a minimal test fixture unless explicitly expanding it.
- x402 sample formatting/linting uses Biome; keep its server/client configuration validation testable without live credentials.