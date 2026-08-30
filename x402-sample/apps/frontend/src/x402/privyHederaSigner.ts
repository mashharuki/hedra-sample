import {
  AccountId,
  Hbar,
  type PublicKey,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientHederaSigner } from "@x402/hedera";
import { recoverEcdsaPublicKey } from "../hedera/recoverPublicKey";
import { bytesToBase64 } from "../lib/encoding";

/** Testnet consensus nodes used to freeze the transfer offline (no gRPC client). */
const DEFAULT_NODE_ACCOUNT_IDS = ["0.0.3", "0.0.4", "0.0.5"];

export type SignRawHash = (hashHex: string) => Promise<string>;

export type PrivyHederaSignerOptions = {
  accountId: string;
  evmAddress: string;
  signRawHash: SignRawHash;
  nodeAccountIds?: string[];
};

/** Normalizes a hex signature (0x-prefixed or not, 64 or 65 bytes) to 64-byte r||s. */
export function toCompactSignature(sigHex: string): Uint8Array {
  const bytes = hexToBytes(sigHex.startsWith("0x") ? sigHex.slice(2) : sigHex);
  if (bytes.length === 64) {
    return bytes;
  }
  if (bytes.length === 65) {
    return bytes.slice(0, 64);
  }
  throw new Error(`unexpected signature length: ${bytes.length}`);
}

/**
 * Builds a `ClientHederaSigner` backed by a Privy embedded EVM wallet.
 *
 * Mirrors `@x402/hedera`'s default `createClientHederaSigner`, except the
 * signing step goes through Privy's raw secp256k1 hash signing instead of a
 * local `PrivateKey`. The transaction is frozen with explicit node account ids
 * so no live gRPC client is needed in the browser.
 */
export function createPrivyHederaSigner(
  options: PrivyHederaSignerOptions,
): ClientHederaSigner {
  const { accountId, evmAddress, signRawHash } = options;
  const payer = AccountId.fromString(accountId);
  const nodeAccountIds = (
    options.nodeAccountIds ?? DEFAULT_NODE_ACCOUNT_IDS
  ).map((id) => AccountId.fromString(id));

  let cachedPublicKey: PublicKey | undefined;

  const resolvePublicKey = async (): Promise<PublicKey> => {
    if (cachedPublicKey) {
      return cachedPublicKey;
    }
    const probe = new Uint8Array(32);
    const probeDigest = keccak_256(probe);
    const probeSig = toCompactSignature(
      await signRawHash(`0x${bytesToHex(probeDigest)}`),
    );
    cachedPublicKey = recoverEcdsaPublicKey(probe, probeSig, evmAddress);
    return cachedPublicKey;
  };

  return {
    accountId: payer.toString(),
    createPartiallySignedTransferTransaction: async (
      requirements: PaymentRequirements,
    ): Promise<string> => {
      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== "string") {
        throw new Error("feePayer is required in paymentRequirements.extra");
      }
      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new Error("amount must be greater than zero");
      }
      if (requirements.asset !== "0.0.0") {
        throw new Error("only native HBAR (asset 0.0.0) is supported");
      }

      const publicKey = await resolvePublicKey();
      const payTo = AccountId.fromString(requirements.payTo);

      const tx = new TransferTransaction()
        .addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()))
        .addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()))
        .setTransactionId(
          TransactionId.generate(AccountId.fromString(feePayer)),
        )
        .setNodeAccountIds(nodeAccountIds)
        .freeze();

      await tx.signWith(publicKey, async (bodyBytes) => {
        const digest = keccak_256(bodyBytes);
        const sigHex = await signRawHash(`0x${bytesToHex(digest)}`);
        return toCompactSignature(sigHex);
      });

      return bytesToBase64(tx.toBytes());
    },
  };
}
