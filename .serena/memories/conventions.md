# Conventions

- TypeScript uses ESM imports, 2-space indentation, semicolons, trailing commas, and explicit return types where scripts define functions.
- Solidity uses `pragma solidity ^0.8.28`, 2-space indentation, SPDX headers, PascalCase contracts, lowerCamelCase functions/state, and `test_` / `testFuzz_` Foundry tests.
- Node integration tests are named `*.ts` under `test/`; use `describe`/`it`, `node:assert/strict`, viem contract clients, and bigint literals for EVM values.
- Preserve `Counter` as a minimal fixture unless the task specifically extends it.