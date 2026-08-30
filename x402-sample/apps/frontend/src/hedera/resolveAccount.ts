type MirrorAccountResponse = {
  account: string;
  balance?: { balance?: number };
};

export type ResolvedHederaAccount = {
  accountId: string;
  balanceTinybars: bigint;
};

/**
 * Resolves the Hedera account that a Privy embedded wallet's EVM address maps
 * to, using the public Mirror Node REST API. Returns `null` when no account
 * exists yet (HTTP 404 — the wallet has not been funded / lazy-created).
 */
export async function resolveHederaAccount(
  evmAddress: string,
  mirrorNodeUrl: string,
): Promise<ResolvedHederaAccount | null> {
  const address = evmAddress.toLowerCase();
  const response = await fetch(
    `${mirrorNodeUrl}/api/v1/accounts/${address}`,
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Mirror Node request failed with status ${response.status}`,
    );
  }

  const body = (await response.json()) as MirrorAccountResponse;
  return {
    accountId: body.account,
    balanceTinybars: BigInt(body.balance?.balance ?? 0),
  };
}
