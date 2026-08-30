import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { ServerConfig } from "./config.js";

/**
 * Honoインスタンスを生成
 * @param config
 * @returns
 */
export function createApp(config: ServerConfig): Hono {
  // Facilitatorクライアントとリソースサーバーを生成
  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });

  // x402リソースサーバーを生成(hedra:*スキームをサポート)
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    "hedera:*",
    new ExactHederaScheme(),
  );
  // Honoインスタンスを生成
  const app = new Hono();

  // ブラウザからのクロスオリジン呼び出しに対応するためCORSを追加
  const corsMiddleware = cors({
    origin: config.allowedOrigins,
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-PAYMENT"],
    exposeHeaders: [
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE",
    ],
  });
  app.use("/health", corsMiddleware);
  app.use("/premium", corsMiddleware);

  // ヘルスチェック用のエンドポイントを追加
  app.get("/health", (context) => context.json({ status: "ok" }));

  // /premiumエンドポイントに対して、x402の支払いミドルウェアを追加
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
                asset: "0.0.0", // HBAR
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
