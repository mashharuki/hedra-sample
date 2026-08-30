import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const config: ServerConfig = {
  facilitatorUrl: "https://x402.org/facilitator",
  payToAccountId: "0.0.1234",
  port: 4021,
  priceTinybars: "1000",
  allowedOrigins: ["http://localhost:5173"],
};

describe("createApp CORS", () => {
  it("reflects an allowed origin and exposes x402 headers on /health", async () => {
    const app = createApp(config);
    const res = await app.request("/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    const expose = res.headers.get("access-control-expose-headers") ?? "";
    expect(expose).toContain("PAYMENT-REQUIRED");
    expect(expose).toContain("X-PAYMENT-RESPONSE");
  });

  it("allows the X-PAYMENT request header on a /premium preflight", async () => {
    const app = createApp(config);
    const res = await app.request("/premium", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-payment",
      },
    });
    expect(res.status).toBe(204);
    expect(
      (res.headers.get("access-control-allow-headers") ?? "").toLowerCase(),
    ).toContain("x-payment");
  });

  it("does not send CORS headers for a disallowed origin", async () => {
    const app = createApp(config);
    const res = await app.request("/health", {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe(
      "https://evil.example",
    );
  });
});
