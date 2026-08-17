import "dotenv/config";

import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

import { readClientConfig } from "./config.js";

const config = readClientConfig();
const signer = createClientHederaSigner(
  config.payerAccountId,
  PrivateKey.fromString(config.payerPrivateKey),
  { network: "hedera:testnet" },
);
const client = new x402Client().register(
  "hedera:*",
  new ExactHederaScheme(signer),
);
const response = await wrapFetchWithPayment(
  fetch,
  client,
)(new URL("/premium", config.resourceServerUrl));

if (!response.ok) {
  throw new Error(
    `Payment request failed (${response.status}): ${await response.text()}`,
  );
}

console.log(await response.json());
console.log(
  "Settlement:",
  new x402HTTPClient(client).getPaymentSettleResponse((name) =>
    response.headers.get(name),
  ),
);
