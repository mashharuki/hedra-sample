import { describe, expect, it } from "vitest";

import { readServerConfig } from "../src/config.js";

describe("readServerConfig", () => {
  it("uses testnet-safe defaults", () => {
    expect(readServerConfig({ PAY_TO_ACCOUNT_ID: "0.0.1234" })).toEqual({
      facilitatorUrl: "https://x402.org/facilitator",
      payToAccountId: "0.0.1234",
      port: 4021,
      priceTinybars: "1000",
    });
  });

  it("rejects invalid payment configuration", () => {
    expect(() => readServerConfig({ PAY_TO_ACCOUNT_ID: "invalid" })).toThrow(
      "PAY_TO_ACCOUNT_ID",
    );
    expect(() =>
      readServerConfig({ PAY_TO_ACCOUNT_ID: "0.0.1234", PRICE_TINYBARS: "0" }),
    ).toThrow("PRICE_TINYBARS");
  });
});
