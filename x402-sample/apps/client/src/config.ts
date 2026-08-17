const accountIdPattern = /^0\.0\.\d+$/;

export type ClientConfig = {
  payerAccountId: string;
  payerPrivateKey: string;
  resourceServerUrl: string;
};

export function readClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClientConfig {
  const payerAccountId = env.PAYER_ACCOUNT_ID;
  const payerPrivateKey = env.PAYER_PRIVATE_KEY;
  const resourceServerUrl = env.RESOURCE_SERVER_URL ?? "http://localhost:4021";

  if (payerAccountId === undefined || !accountIdPattern.test(payerAccountId)) {
    throw new Error(
      "PAYER_ACCOUNT_ID must be a Hedera account ID such as 0.0.1234.",
    );
  }
  if (payerPrivateKey === undefined || payerPrivateKey.length === 0) {
    throw new Error("PAYER_PRIVATE_KEY must be set.");
  }
  try {
    new URL(resourceServerUrl);
  } catch {
    throw new Error("RESOURCE_SERVER_URL must be a valid URL.");
  }

  return { payerAccountId, payerPrivateKey, resourceServerUrl };
}
