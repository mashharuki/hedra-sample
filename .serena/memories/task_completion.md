# Task completion

- First identify which runnable project changed; their package managers and verification commands differ.
- For `tutorial-local-hardhat/` changes: while iterating, run the relevant `npx hardhat test solidity` or `npx hardhat test nodejs`; before handoff, run `npm run build` and `npm test`.
- For `x402-sample/` changes: run the focused package test while iterating where applicable; before handoff, run `pnpm build` and `pnpm test` (or `pnpm check` when formatting/lint/unused-dependency validation is in scope).
- Do not routinely run Hardhat `deploy` / `send-tx`, x402 `test:live`, or direct client payment commands: each can broadcast a real Testnet transaction and needs explicit authorization/configuration.