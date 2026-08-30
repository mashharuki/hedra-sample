import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";

// Reuse the funded testnet payer already configured for the CLI client.
loadEnv({ path: new URL("../../client/.env", import.meta.url).pathname });

const MIRROR = "https://testnet.mirrornode.hedera.com";

async function main(): Promise<void> {
  const [evmAddressArg, amountArg] = process.argv.slice(2);
  if (!evmAddressArg || !/^0x[0-9a-fA-F]{40}$/.test(evmAddressArg)) {
    throw new Error(
      "usage: pnpm --filter frontend fund <0x-evm-address> [hbarAmount]",
    );
  }
  const hbarAmount = Number(amountArg ?? "5");
  if (!Number.isFinite(hbarAmount) || hbarAmount <= 0) {
    throw new Error("hbarAmount must be a positive number");
  }

  const payerId = process.env.PAYER_ACCOUNT_ID;
  const payerKey = process.env.PAYER_PRIVATE_KEY;
  if (!payerId || !payerKey) {
    throw new Error(
      "PAYER_ACCOUNT_ID / PAYER_PRIVATE_KEY must be set in apps/client/.env",
    );
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(payerId),
    PrivateKey.fromStringECDSA(payerKey),
  );

  const evmAddress = evmAddressArg.toLowerCase();
  const recipient = AccountId.fromEvmAddress(0, 0, evmAddress);

  console.log(`Sending ${hbarAmount} ℏ to ${evmAddress} …`);
  const response = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(payerId), new Hbar(-hbarAmount))
    .addHbarTransfer(recipient, new Hbar(hbarAmount))
    .execute(client);
  const receipt = await response.getReceipt(client);
  console.log("Transfer status:", receipt.status.toString());

  const lookup = await fetch(`${MIRROR}/api/v1/accounts/${evmAddress}`);
  if (lookup.ok) {
    const body = (await lookup.json()) as { account: string };
    console.log("Hedera account id:", body.account);
    console.log(
      "→ この口座は hollow account です。アプリで「アカウントを有効化」を押して",
    );
    console.log(
      "  オンチェーンに鍵を登録してから支払ってください（x402 の検証に必要）。",
    );
  } else {
    console.log(
      "Mirror node にまだ反映されていません。数秒後に画面の「再確認」を押してください。",
    );
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
