import { describe, expect, it } from "vitest";

import { readClientConfig } from "../src/config.js";

describe("readClientConfig", () => {
  it("uses the local resource-server default", () => {
    expect(
      readClientConfig({
        PAYER_ACCOUNT_ID: "0.0.1234",
        PAYER_PRIVATE_KEY: "test-key",
      }),
    ).toEqual({
      payerAccountId: "0.0.1234",
      payerPrivateKey: "test-key",
      resourceServerUrl: "http://localhost:4021",
    });
  });

  it("rejects a missing signer configuration", () => {
    expect(() => readClientConfig({ PAYER_PRIVATE_KEY: "test-key" })).toThrow(
      "PAYER_ACCOUNT_ID",
    );
    expect(() => readClientConfig({ PAYER_ACCOUNT_ID: "0.0.1234" })).toThrow(
      "PAYER_PRIVATE_KEY",
    );
  });
});
