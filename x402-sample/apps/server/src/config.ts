const accountIdPattern = /^0\.0\.\d+$/;

export type ServerConfig = {
  facilitatorUrl: string;
  payToAccountId: string;
  port: number;
  priceTinybars: string;
};

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set.`);
  }

  return value;
}

export function readServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const payToAccountId = required(env.PAY_TO_ACCOUNT_ID, "PAY_TO_ACCOUNT_ID");
  if (!accountIdPattern.test(payToAccountId)) {
    throw new Error(
      "PAY_TO_ACCOUNT_ID must be a Hedera account ID such as 0.0.1234.",
    );
  }

  const priceTinybars = env.PRICE_TINYBARS ?? "1000";
  if (!/^\d+$/.test(priceTinybars) || BigInt(priceTinybars) <= 0n) {
    throw new Error("PRICE_TINYBARS must be a positive integer.");
  }

  const port = Number(env.PORT ?? "4021");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const facilitatorUrl = env.FACILITATOR_URL ?? "https://x402.org/facilitator";
  try {
    new URL(facilitatorUrl);
  } catch {
    throw new Error("FACILITATOR_URL must be a valid URL.");
  }

  return { facilitatorUrl, payToAccountId, port, priceTinybars };
}
