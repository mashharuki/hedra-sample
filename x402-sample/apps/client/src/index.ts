import "dotenv/config";

import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

import { readClientConfig } from "./config.js";

// 設定を読み込み
const config = readClientConfig();
// Hederaの署名者を作成
const signer = createClientHederaSigner(
  config.payerAccountId,
  PrivateKey.fromStringECDSA(config.payerPrivateKey),
  { network: "hedera:testnet" },
);

console.log("Payer account ID:", config.payerAccountId);

// X402クライアントを作成し、Hederaの署名者を登録
const client = new x402Client().register(
  "hedera:*",
  new ExactHederaScheme(signer),
);

// X402クライアントを使って、リソースサーバーに対して支払い付きのリクエストを送信
const response = await wrapFetchWithPayment(
  fetch,
  client,
)(new URL("/premium", config.resourceServerUrl));

const header = response.headers.get("payment-required");
const details = header ? decodePaymentRequiredHeader(header) : undefined;
console.error(JSON.stringify({ status: response.status, details }, null, 2));

if (!response.ok) {
  throw new Error(
    `Payment request failed (${response.status}): ${await response.json()}`,
  );
}

console.log(await response.json());
console.log(
  "Settlement:",
  new x402HTTPClient(client).getPaymentSettleResponse((name) =>
    response.headers.get(name),
  ),
);
