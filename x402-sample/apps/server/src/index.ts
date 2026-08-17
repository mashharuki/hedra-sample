import "dotenv/config";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { readServerConfig } from "./config.js";

// 設定を読み込む
const config = readServerConfig();

// サーバー起動
serve({ fetch: createApp(config).fetch, port: config.port }, (info) => {
  console.log(
    `x402 resource server listening on http://localhost:${info.port}`,
  );
});
