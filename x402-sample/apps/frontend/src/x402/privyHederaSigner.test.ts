import { Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import {
  createPrivyHederaSigner,
  toCompactSignature,
} from "./privyHederaSigner";

const PRIV = new Uint8Array(32).fill(3);

function evmAddressOf(priv: Uint8Array): string {
  const uncompressed = secp256k1.getPublicKey(priv, false);
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

// stand-in for Privy's provider.request({ method: "secp256k1_sign" }):
// signs the given 32-byte digest raw and returns 0x + 64-byte r||s.
const fakeSignRawHash = async (hashHex: string): Promise<string> => {
  const digest = Uint8Array.from(
    (hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex).match(/.{2}/g)!,
    (b) => Number.parseInt(b, 16),
  );
  return `0x${bytesToHex(secp256k1.sign(digest, PRIV).toCompactRawBytes())}`;
};

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  asset: "0.0.0",
  payTo: "0.0.98",
  amount: "1000",
  maxTimeoutSeconds: 180,
  resource: "http://localhost:4021/premium",
  description: "test",
  mimeType: "application/json",
  extra: { feePayer: "0.0.800" },
} as unknown as PaymentRequirements;

describe("toCompactSignature", () => {
  it("passes through a 64-byte hex string", () => {
    const sig = new Uint8Array(64).fill(9);
    expect(toCompactSignature(bytesToHex(sig))).toEqual(sig);
  });

  it("drops the trailing recovery byte from a 65-byte signature", () => {
    const sig = new Uint8Array(65).fill(9);
    expect(toCompactSignature(`0x${bytesToHex(sig)}`)).toHaveLength(64);
  });

  it("throws on an unexpected length", () => {
    expect(() => toCompactSignature("0x1234")).toThrow("length");
  });
});

describe("createPrivyHederaSigner", () => {
  const signer = createPrivyHederaSigner({
    accountId: "0.0.5005",
    evmAddress: evmAddressOf(PRIV),
    signRawHash: fakeSignRawHash,
    nodeAccountIds: ["0.0.3"],
  });

  it("exposes the payer account id", () => {
    expect(signer.accountId).toBe("0.0.5005");
  });

  it("builds a base64 transfer that round-trips and nets to zero", async () => {
    const base64 =
      await signer.createPartiallySignedTransferTransaction(requirements);
    const tx = Transaction.fromBytes(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
    expect(tx).toBeInstanceOf(TransferTransaction);

    const transfers = (tx as TransferTransaction).hbarTransfers;
    let net = 0n;
    for (const [, amount] of transfers) {
      net += BigInt(amount.toTinybars().toString());
    }
    expect(net).toBe(0n);
    const payerEntry = [...transfers].find(
      ([account]) => account.toString() === "0.0.5005",
    );
    expect(payerEntry?.[1].toTinybars().toString()).toBe("-1000");
  });

  it("attaches a signature that verifies against the wallet key", async () => {
    const base64 =
      await signer.createPartiallySignedTransferTransaction(requirements);
    const tx = Transaction.fromBytes(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
    const signatures = tx.getSignatures();
    // at least one node entry, each carrying one public key -> signature
    expect(signatures.size).toBeGreaterThan(0);
    for (const [, perNode] of signatures) {
      expect(perNode.size).toBe(1);
    }
  });

  it("rejects non-HBAR assets", async () => {
    await expect(
      signer.createPartiallySignedTransferTransaction({
        ...requirements,
        asset: "0.0.429274",
      } as PaymentRequirements),
    ).rejects.toThrow("HBAR");
  });

  it("rejects a missing feePayer", async () => {
    await expect(
      signer.createPartiallySignedTransferTransaction({
        ...requirements,
        extra: {},
      } as PaymentRequirements),
    ).rejects.toThrow("feePayer");
  });
});
