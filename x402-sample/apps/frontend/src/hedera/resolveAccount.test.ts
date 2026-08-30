import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHederaAccount } from "./resolveAccount";

const MIRROR = "https://testnet.mirrornode.hedera.com";
const EVM = "0x1234567890abcdef1234567890abcdef12345678";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveHederaAccount", () => {
  it("returns the account id and balance when the account exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          account: "0.0.5005",
          balance: { balance: 499_000_000 },
        }),
        { status: 200 },
      ),
    );
    const result = await resolveHederaAccount(EVM, MIRROR);
    expect(result).toEqual({
      accountId: "0.0.5005",
      balanceTinybars: 499_000_000n,
    });
  });

  it("calls the mirror node with the lowercased evm address path", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ account: "0.0.1", balance: { balance: 0 } }),
          { status: 200 },
        ),
      );
    await resolveHederaAccount(EVM.toUpperCase(), MIRROR);
    expect(spy).toHaveBeenCalledWith(
      `${MIRROR}/api/v1/accounts/${EVM.toLowerCase()}`,
    );
  });

  it("returns null when the account is not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    expect(await resolveHederaAccount(EVM, MIRROR)).toBeNull();
  });

  it("throws on other error statuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    await expect(resolveHederaAccount(EVM, MIRROR)).rejects.toThrow("500");
  });
});
