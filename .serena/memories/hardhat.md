# Hardhat tutorial

- Run Node/Hardhat/npm commands only from `tutorial-local-hardhat/`; dependencies are pinned by `package-lock.json`.
- ESM TypeScript + Hardhat 3.13, toolbox-viem 5.x, viem 2.x, TypeScript 6; Solidity 0.8.28 (production optimizer: 200 runs).
- Layout: `contracts/` source and Foundry-style `*.t.sol`; `test/` TypeScript integration tests; `scripts/` deployment/transaction scripts; `hardhat.config.ts` config.
- Hedera network configuration uses `HEDERA_RPC_URL` and `HEDERA_PRIVATE_KEY`; never expose or commit credentials.
- Commands and test selection: `mem:suggested_commands`.