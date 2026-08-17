import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";

import type { ServerConfig } from "./config.js";

export function createApp(config: ServerConfig): Hono {
  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    "hedera:*",
    new ExactHederaScheme(),
  );
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.use(
    "/premium",
    paymentMiddleware(
      {
        "GET /premium": {
          accepts: [
            {
              scheme: "exact",
              network: "hedera:testnet",
              price: {
                amount: config.priceTinybars,
                asset: "0.0.0",
              },
              payTo: config.payToAccountId,
              maxTimeoutSeconds: 180,
            },
          ],
          description: "A paid Hedera x402 testnet response.",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );
  app.get("/premium", (context) =>
    context.json({
      message: "Payment settled on Hedera testnet.",
      priceTinybars: config.priceTinybars,
    }),
  );

  return app;
}
