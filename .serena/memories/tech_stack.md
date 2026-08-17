# Tech stack

- `tutorial-local-hardhat`: ESM TypeScript project, Hardhat 3.13, `@nomicfoundation/hardhat-toolbox-viem`, viem 2.x, Node types 22, TypeScript 6.
- Solidity profile: 0.8.28; production profile enables optimizer (200 runs).
- Hedera HTTP network reads `HEDERA_RPC_URL` and `HEDERA_PRIVATE_KEY` via Hardhat configuration variables.
- Source/tests: `contracts/` holds `.sol` and Foundry-style `.t.sol`; `test/` holds `node:test` TypeScript integration tests; `scripts/` holds Hardhat-run operational scripts.