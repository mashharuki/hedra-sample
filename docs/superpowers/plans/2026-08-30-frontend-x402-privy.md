# フロントエンド x402 × Privy 支払い 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザ（`apps/frontend`）から x402 保護リソース `/premium` にアクセスし、Privy 内蔵 EVM ウォレットで部分署名済み Hedera `TransferTransaction`（x402 支払いデータ）を生成して 402 → 支払い → リトライを完了し、有料 JSON と決済トランザクション情報を表示する。

**Architecture:** 既存 CLI クライアント（`apps/client`）と同じ `@x402/fetch` 経路をブラウザで再利用し、`ClientHederaSigner` だけを Privy 版に差し替える。署名は「`keccak256(bodyBytes)` を Privy の `secp256k1_sign` に渡し 64 バイト r‖s を SDK トランザクションに添付」する。Hedera 口座は Privy ウォレットの EVM アドレスから mirror node で解決し、資金投入は別 CLI スクリプトで行う。サーバーには CORS を追加する。

**Tech Stack:** React 19 + Vite 8、`@privy-io/react-auth` v3、`@x402/core`/`@x402/fetch`/`@x402/hedera` 2.18.0、`@hiero-ledger/sdk` 2.85.0、`@noble/curves` / `@noble/hashes`、Hono 4（サーバー CORS）、vitest 4。

**Spec:** `docs/superpowers/specs/2026-08-30-frontend-x402-privy-design.md`

## Global Constraints

- x402 系パッケージは既存 client と同一ピン: `@x402/core@2.18.0`, `@x402/fetch@2.18.0`, `@x402/hedera@2.18.0`。
- `@hiero-ledger/sdk` は lockfile と同じ `2.85.0` を明示依存に追加。
- `@noble/curves@^1.9.0`, `@noble/hashes@^1.8.0`（v1 系 API 前提。v2 は API 破壊があるため使わない）。
- フロントエンド TS 設定は `verbatimModuleSyntax: true` / `erasableSyntaxOnly: true`：型は必ず `import type`、enum・namespace 禁止。
- フォーマッタは Biome（`indentWidth: 2`, スペース）。フロントの lint は oxlint。ルート lint は `biome check .`。
- ネットワーク識別子は CAIP-2 `hedera:testnet`。HBAR のみ対応（`asset === "0.0.0"`）。他アセットは明示的に throw。
- ブラウザ JS が読む x402 レスポンスヘッダ: `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `X-PAYMENT-RESPONSE`。リクエストヘッダ: `X-PAYMENT`。
- 秘密鍵・App Secret はコミットしない。`.env.*` は `.env.example` を除き gitignore 済み。
- 完了ゲート: `cd x402-sample && pnpm check`（Biome / Knip / 各 workspace の build / test）が通ること。

---

## ファイル構成

### 新規（`apps/frontend/`）

| パス | 責務 |
|---|---|
| `src/config.ts` | `import.meta.env` から `VITE_PRIVY_APP_ID` / `VITE_RESOURCE_SERVER_URL` を読み検証。network・mirror URL 定数を公開 |
| `src/lib/encoding.ts` | `bytesToBase64(Uint8Array): string`（`btoa` ベース、Buffer 非依存） |
| `src/hedera/resolveAccount.ts` | `resolveHederaAccount(evmAddress, mirrorNodeUrl): Promise<{ accountId, balanceTinybars } \| null>` |
| `src/hedera/recoverPublicKey.ts` | `recoverEcdsaPublicKey(message, signature64, expectedEvmAddress): PublicKey` |
| `src/x402/privyHederaSigner.ts` | `createPrivyHederaSigner(options): ClientHederaSigner`、`toCompactSignature`、`SignRawHash` 型 |
| `src/x402/payPremium.ts` | `payPremium(signer, resourceServerUrl): Promise<{ body, settlement }>` |
| `src/components/PremiumPanel.tsx` | 支払い状態機械 UI。Privy ウォレット → signer 組み立て → `payPremium` |
| `scripts/fund-wallet.ts` | tsx スクリプト。資金済み testnet 口座から EVM エイリアス宛に HBAR 送金し `0.0.X` を lazy-create |
| `vitest.config.ts` | フロントの vitest 設定（node 環境） |
| `.env.example` | `VITE_PRIVY_APP_ID=` / `VITE_RESOURCE_SERVER_URL=http://localhost:4021` |

### 変更

| パス | 変更内容 |
|---|---|
| `apps/frontend/package.json` | 依存追加、`test` / `fund` スクリプト追加 |
| `apps/frontend/vite.config.ts` | `vite-plugin-node-polyfills`（Buffer/global） |
| `apps/frontend/tsconfig.app.json` | `exclude` にテストファイル追加、`types` に `vitest/importMeta`（任意） |
| `apps/frontend/src/main.tsx` | `<PrivyProvider>` でラップ |
| `apps/frontend/src/App.tsx` | ログインゲート + `<PremiumPanel/>` |
| `apps/frontend/src/css/index.css` | 最小レイアウト追記 |
| `apps/frontend/README.md` | セットアップ + E2E 手順書 |
| `apps/server/src/config.ts` | `allowedOrigins: string[]` を追加 |
| `apps/server/src/app.ts` | `hono/cors` を `/health` `/premium` に適用 |
| `apps/server/test/config.test.ts` | 既存 `toEqual` を更新、`ALLOWED_ORIGINS` ケース追加 |
| `apps/server/test/app.test.ts` | 新規: CORS ヘッダ検証 |
| `apps/server/.env.example` / `.env` | `ALLOWED_ORIGINS=http://localhost:5173` |
| `x402-sample/knip.json` | `apps/frontend` workspace を追加 |
| `README.md`（ルート） | フロントエンド節へのリンク追記 |

---

## Task 1: サーバー CORS

**Files:**
- Modify: `x402-sample/apps/server/src/config.ts`
- Modify: `x402-sample/apps/server/src/app.ts`
- Modify: `x402-sample/apps/server/test/config.test.ts`
- Create: `x402-sample/apps/server/test/app.test.ts`
- Modify: `x402-sample/apps/server/.env.example`, `x402-sample/apps/server/.env`

**Interfaces:**
- Consumes: 既存 `readServerConfig(env)`, `createApp(config)`。
- Produces:
  - `ServerConfig` に `allowedOrigins: string[]` を追加（既定 `["http://localhost:5173"]`）。
  - `createApp` のシグネチャは不変（`(config: ServerConfig) => Hono`）。

作業ディレクトリは `x402-sample/`。テスト実行は `pnpm --filter @x402-sample/server exec vitest run`。

- [ ] **Step 1: 既存テストを新しい期待値に更新（失敗させる）**

`apps/server/test/config.test.ts` を次の内容に置き換える:

```ts
import { describe, expect, it } from "vitest";

import { readServerConfig } from "../src/config.js";

describe("readServerConfig", () => {
  it("uses testnet-safe defaults", () => {
    expect(readServerConfig({ PAY_TO_ACCOUNT_ID: "0.0.1234" })).toEqual({
      facilitatorUrl: "https://x402.org/facilitator",
      payToAccountId: "0.0.1234",
      port: 4021,
      priceTinybars: "1000",
      allowedOrigins: ["http://localhost:5173"],
    });
  });

  it("parses a comma-separated ALLOWED_ORIGINS list", () => {
    const config = readServerConfig({
      PAY_TO_ACCOUNT_ID: "0.0.1234",
      ALLOWED_ORIGINS: "http://localhost:5173, https://example.com",
    });
    expect(config.allowedOrigins).toEqual([
      "http://localhost:5173",
      "https://example.com",
    ]);
  });

  it("rejects invalid payment configuration", () => {
    expect(() => readServerConfig({ PAY_TO_ACCOUNT_ID: "invalid" })).toThrow(
      "PAY_TO_ACCOUNT_ID",
    );
    expect(() =>
      readServerConfig({ PAY_TO_ACCOUNT_ID: "0.0.1234", PRICE_TINYBARS: "0" }),
    ).toThrow("PRICE_TINYBARS");
  });

  it("rejects a malformed origin", () => {
    expect(() =>
      readServerConfig({
        PAY_TO_ACCOUNT_ID: "0.0.1234",
        ALLOWED_ORIGINS: "not a url",
      }),
    ).toThrow("ALLOWED_ORIGINS");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter @x402-sample/server exec vitest run`
Expected: FAIL（`allowedOrigins` が返らない / パース関数が無い）

- [ ] **Step 3: `readServerConfig` に `allowedOrigins` を追加**

`apps/server/src/config.ts` の `ServerConfig` 型に `allowedOrigins: string[];` を追加し、`readServerConfig` の `return` 直前に次を挿入、`return` オブジェクトへ `allowedOrigins` を追加:

```ts
  const allowedOriginsRaw = env.ALLOWED_ORIGINS ?? "http://localhost:5173";
  const allowedOrigins = allowedOriginsRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS must contain at least one origin.");
  }
  for (const origin of allowedOrigins) {
    try {
      new URL(origin);
    } catch {
      throw new Error(`ALLOWED_ORIGINS entry is not a valid URL: ${origin}`);
    }
  }
```

- [ ] **Step 4: テストを実行して config テストが通ることを確認**

Run: `pnpm --filter @x402-sample/server exec vitest run config`
Expected: PASS

- [ ] **Step 5: CORS のテストを書く（失敗させる）**

`apps/server/test/app.test.ts` を新規作成:

```ts
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
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `pnpm --filter @x402-sample/server exec vitest run app`
Expected: FAIL（CORS ヘッダが無い）

- [ ] **Step 7: `createApp` に CORS を追加**

`apps/server/src/app.ts` の import に追加:

```ts
import { cors } from "hono/cors";
```

`const app = new Hono();` の直後に挿入:

```ts
  const corsMiddleware = cors({
    origin: config.allowedOrigins,
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-PAYMENT"],
    exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
  });
  app.use("/health", corsMiddleware);
  app.use("/premium", corsMiddleware);
```

（`app.use("/premium", ...)` は既存の `paymentMiddleware` 登録より前に置くこと。Hono はミドルウェアを登録順に適用する。）

- [ ] **Step 8: テストを実行して全て通ることを確認**

Run: `pnpm --filter @x402-sample/server exec vitest run`
Expected: PASS（config + app）

- [ ] **Step 9: `.env` 追記**

`apps/server/.env.example` と `apps/server/.env` の末尾に追加:

```
ALLOWED_ORIGINS=http://localhost:5173
```

- [ ] **Step 10: サーバー build を確認**

Run: `pnpm --filter @x402-sample/server run build`
Expected: PASS（`tsc --noEmit` がエラーなし）

- [ ] **Step 11: コミット**

```bash
git add x402-sample/apps/server
git commit -m "feat(server): ブラウザ向けCORSを/health,/premiumに追加"
```

---

## Task 2: フロントエンド土台（依存・polyfill・Privy Provider・config）

**Files:**
- Modify: `x402-sample/apps/frontend/package.json`
- Modify: `x402-sample/apps/frontend/vite.config.ts`
- Modify: `x402-sample/apps/frontend/tsconfig.app.json`
- Create: `x402-sample/apps/frontend/vitest.config.ts`
- Create: `x402-sample/apps/frontend/.env.example`（既存は空。内容を記述）
- Create: `x402-sample/apps/frontend/src/config.ts`
- Create: `x402-sample/apps/frontend/src/lib/encoding.ts`
- Modify: `x402-sample/apps/frontend/src/main.tsx`
- Modify: `x402-sample/apps/frontend/src/App.tsx`
- Modify: `x402-sample/knip.json`
- Test: `x402-sample/apps/frontend/src/lib/encoding.test.ts`, `x402-sample/apps/frontend/src/config.test.ts`

**Interfaces:**
- Produces:
  - `config`（`src/config.ts`）: `{ privyAppId: string; resourceServerUrl: string; network: "hedera:testnet"; mirrorNodeUrl: string }`
  - `bytesToBase64(bytes: Uint8Array): string`（`src/lib/encoding.ts`）
  - `loadConfig(env?: Record<string, string | undefined>): Config` も export（テスト用に env 注入可能に）

作業ディレクトリは `x402-sample/`。

- [ ] **Step 1: 依存を追加**

Run:
```bash
pnpm --filter frontend add @privy-io/react-auth@^3.38.0 @x402/core@2.18.0 @x402/fetch@2.18.0 @x402/hedera@2.18.0 @hiero-ledger/sdk@2.85.0 @noble/curves@^1.9.0 @noble/hashes@^1.8.0
pnpm --filter frontend add -D vitest@^4.0.14 vite-plugin-node-polyfills@^0.24.0 tsx@^4.21.0 dotenv@^17.2.3
```
Expected: `pnpm-lock.yaml` 更新、エラーなし

- [ ] **Step 2: `package.json` にスクリプト追加**

`apps/frontend/package.json` の `scripts` に追加:

```json
    "test": "vitest run",
    "fund": "tsx scripts/fund-wallet.ts"
```

- [ ] **Step 3: vite polyfill 設定**

`apps/frontend/vite.config.ts` を置き換え:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer"],
      globals: { Buffer: true, global: true },
    }),
  ],
});
```

- [ ] **Step 4: vitest 設定**

`apps/frontend/vitest.config.ts` を新規作成:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 5: テストファイルをビルド対象から除外**

`apps/frontend/tsconfig.app.json` に次のキーを追加（`include` と同階層）:

```json
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
```

- [ ] **Step 6: `.env.example` を記述**

`apps/frontend/.env.example`:

```
VITE_PRIVY_APP_ID=
VITE_RESOURCE_SERVER_URL=http://localhost:4021
```

- [ ] **Step 7: `bytesToBase64` のテストを書く**

`apps/frontend/src/lib/encoding.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "./encoding";

describe("bytesToBase64", () => {
  it("encodes bytes to standard base64", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  it("encodes an empty array", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });

  it("round-trips through atob", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) =>
      c.charCodeAt(0),
    );
    expect([...decoded]).toEqual([...bytes]);
  });
});
```

- [ ] **Step 8: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/lib/encoding.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 9: `bytesToBase64` を実装**

`apps/frontend/src/lib/encoding.ts`:

```ts
/**
 * Encodes bytes as standard (non-URL) base64 without depending on Node's Buffer.
 * Works in browsers and in Node 16+ (global `btoa`).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
```

- [ ] **Step 10: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/lib/encoding.test.ts`
Expected: PASS

- [ ] **Step 11: `config` のテストを書く**

`apps/frontend/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const base = {
  VITE_PRIVY_APP_ID: "app-123",
  VITE_RESOURCE_SERVER_URL: "http://localhost:4021",
};

describe("loadConfig", () => {
  it("reads values and fills Hedera testnet defaults", () => {
    expect(loadConfig(base)).toEqual({
      privyAppId: "app-123",
      resourceServerUrl: "http://localhost:4021",
      network: "hedera:testnet",
      mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
    });
  });

  it("throws when the Privy app id is missing", () => {
    expect(() => loadConfig({ ...base, VITE_PRIVY_APP_ID: "" })).toThrow(
      "VITE_PRIVY_APP_ID",
    );
  });

  it("throws when the resource server URL is invalid", () => {
    expect(() =>
      loadConfig({ ...base, VITE_RESOURCE_SERVER_URL: "nope" }),
    ).toThrow("VITE_RESOURCE_SERVER_URL");
  });
});
```

- [ ] **Step 12: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/config.test.ts`
Expected: FAIL

- [ ] **Step 13: `config` を実装**

`apps/frontend/src/config.ts`:

```ts
import { HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_MIRROR_NODE_URL } from "@x402/hedera";

export type Config = {
  privyAppId: string;
  resourceServerUrl: string;
  network: typeof HEDERA_TESTNET_CAIP2;
  mirrorNodeUrl: string;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const privyAppId = env.VITE_PRIVY_APP_ID ?? "";
  if (privyAppId.length === 0) {
    throw new Error("VITE_PRIVY_APP_ID must be set.");
  }

  const resourceServerUrl = env.VITE_RESOURCE_SERVER_URL ?? "";
  try {
    new URL(resourceServerUrl);
  } catch {
    throw new Error("VITE_RESOURCE_SERVER_URL must be a valid URL.");
  }

  return {
    privyAppId,
    resourceServerUrl,
    network: HEDERA_TESTNET_CAIP2,
    mirrorNodeUrl: HEDERA_TESTNET_MIRROR_NODE_URL,
  };
}

export const config: Config = loadConfig(
  import.meta.env as unknown as Env,
);
```

（`HEDERA_TESTNET_CAIP2` は `"hedera:testnet"`、`HEDERA_TESTNET_MIRROR_NODE_URL` は `"https://testnet.mirrornode.hedera.com"`。`@x402/hedera` の index から export 済み — Task 前提の `node_modules` で確認可能。）

- [ ] **Step 14: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/config.test.ts`
Expected: PASS

- [ ] **Step 15: Privy Provider でラップ**

`apps/frontend/src/main.tsx` を置き換え:

```tsx
import { PrivyProvider } from "@privy-io/react-auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { config } from "./config.ts";
import "./css/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);
```

- [ ] **Step 16: `App.tsx` を最小プレースホルダに**

`apps/frontend/src/App.tsx` を置き換え（Task 7 で本実装。ここではビルドを通すだけ）:

```tsx
import { usePrivy } from "@privy-io/react-auth";

function App() {
  const { ready, authenticated, login, logout } = usePrivy();

  if (!ready) {
    return <p>Loading…</p>;
  }

  return (
    <main>
      <h1>x402 × Privy</h1>
      {authenticated ? (
        <button type="button" onClick={() => logout()}>
          Log out
        </button>
      ) : (
        <button type="button" onClick={() => login()}>
          Log in
        </button>
      )}
    </main>
  );
}

export default App;
```

- [ ] **Step 17: knip にフロントエンド workspace を追加**

`x402-sample/knip.json` の `workspaces` に追加:

```json
    "apps/frontend": {
      "entry": ["src/main.tsx", "scripts/fund-wallet.ts", "vite.config.ts", "vitest.config.ts"],
      "project": ["src/**/*.{ts,tsx}", "scripts/**/*.ts"]
    }
```

- [ ] **Step 18: build と lint を確認**

Run:
```bash
pnpm --filter frontend run build
pnpm --filter frontend run lint
pnpm knip
```
Expected: いずれも PASS。`vite build` が `@hiero-ledger/sdk` を含めて成功すること（polyfill 警告は許容、エラー不可）。knip が未使用依存を報告しないこと（`tsx`/`dotenv`/`vite-plugin-node-polyfills` は entry から参照される）。

> polyfill で `vite build` が失敗する場合の代替: `nodePolyfills` の `include` に `"crypto"`, `"stream"` を追加。それでも解決しない場合はスペック §9 のフォールバック（アプローチ C）を検討する前に、`@hiero-ledger/sdk` の `optimizeDeps.exclude` を試す。

- [ ] **Step 19: コミット**

```bash
git add x402-sample/apps/frontend x402-sample/knip.json x402-sample/pnpm-lock.yaml
git commit -m "feat(frontend): 依存・polyfill・PrivyProvider・configを追加"
```

---

## Task 3: Hedera 口座解決（mirror node）

**Files:**
- Create: `x402-sample/apps/frontend/src/hedera/resolveAccount.ts`
- Test: `x402-sample/apps/frontend/src/hedera/resolveAccount.test.ts`

**Interfaces:**
- Consumes: なし（`fetch` のみ）。
- Produces: `resolveHederaAccount(evmAddress: string, mirrorNodeUrl: string): Promise<{ accountId: string; balanceTinybars: bigint } | null>`
  - 口座が存在すれば `{ accountId: "0.0.X", balanceTinybars }`、mirror node が 404 なら `null`。
  - その他の非 2xx は throw。

- [ ] **Step 1: テストを書く**

`apps/frontend/src/hedera/resolveAccount.test.ts`:

```ts
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
        JSON.stringify({ account: "0.0.5005", balance: { balance: 499_000_000 } }),
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/hedera/resolveAccount.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`apps/frontend/src/hedera/resolveAccount.ts`:

```ts
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
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/hedera/resolveAccount.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add x402-sample/apps/frontend/src/hedera/resolveAccount.ts x402-sample/apps/frontend/src/hedera/resolveAccount.test.ts
git commit -m "feat(frontend): mirror nodeでEVMアドレス→Hedera口座を解決"
```

---

## Task 4: secp256k1 公開鍵の復元

**Files:**
- Create: `x402-sample/apps/frontend/src/hedera/recoverPublicKey.ts`
- Test: `x402-sample/apps/frontend/src/hedera/recoverPublicKey.test.ts`

**Interfaces:**
- Consumes: `@noble/curves/secp256k1`（`secp256k1`）、`@noble/hashes/sha3`（`keccak_256`）、`@noble/hashes/utils`（`bytesToHex`, `hexToBytes`）、`@hiero-ledger/sdk`（`PublicKey`）。
- Produces: `recoverEcdsaPublicKey(message: Uint8Array, signature: Uint8Array, expectedEvmAddress: string): PublicKey`
  - `signature` は 64 バイト compact r‖s。
  - `keccak256(message)` に対する 4 通りの recovery id を試し、導出 EVM アドレスが `expectedEvmAddress` と一致する公開鍵を `PublicKey.fromStringECDSA`（圧縮 hex）で返す。
  - 一致無し / アドレス不正なら throw。

- [ ] **Step 1: テストを書く**

`apps/frontend/src/hedera/recoverPublicKey.test.ts`:

```ts
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";

import { recoverEcdsaPublicKey } from "./recoverPublicKey";

// deterministic throwaway key — test only
const PRIV = hexToBytes32(
  "1111111111111111111111111111111111111111111111111111111111111111",
);

function hexToBytes32(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function evmAddressOf(priv: Uint8Array): string {
  const uncompressed = secp256k1.getPublicKey(priv, false); // 65 bytes
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

describe("recoverEcdsaPublicKey", () => {
  it("recovers the key whose EVM address matches", () => {
    const message = new Uint8Array(32).fill(7);
    const digest = keccak_256(message);
    const sig = secp256k1.sign(digest, PRIV).toCompactRawBytes();

    const publicKey = recoverEcdsaPublicKey(
      message,
      sig,
      evmAddressOf(PRIV),
    );

    // Hedera compressed ECDSA key hex is 33 bytes / 66 chars
    expect(publicKey.toStringRaw().length).toBe(66);
    // and it must correspond to the same underlying point
    const expected = bytesToHex(secp256k1.getPublicKey(PRIV, true));
    expect(publicKey.toStringRaw()).toBe(expected);
  });

  it("throws when no recovery id matches the expected address", () => {
    const message = new Uint8Array(32).fill(7);
    const digest = keccak_256(message);
    const sig = secp256k1.sign(digest, PRIV).toCompactRawBytes();
    expect(() =>
      recoverEcdsaPublicKey(
        message,
        sig,
        "0x0000000000000000000000000000000000000000",
      ),
    ).toThrow();
  });

  it("throws on a malformed expected address", () => {
    expect(() =>
      recoverEcdsaPublicKey(new Uint8Array(32), new Uint8Array(64), "0x1234"),
    ).toThrow("EVM address");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/hedera/recoverPublicKey.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`apps/frontend/src/hedera/recoverPublicKey.ts`:

```ts
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { PublicKey } from "@hiero-ledger/sdk";

function normalizeEvmAddress(address: string): string {
  const clean = (
    address.startsWith("0x") ? address.slice(2) : address
  ).toLowerCase();
  if (clean.length !== 40 || /[^0-9a-f]/.test(clean)) {
    throw new Error(`invalid EVM address: ${address}`);
  }
  return clean;
}

/**
 * Recovers the secp256k1 public key that produced `signature` (64-byte compact
 * r||s) over `keccak256(message)`, choosing the recovery id whose derived
 * Ethereum address equals `expectedEvmAddress`. Returns a Hedera `PublicKey`
 * (ECDSA) built from the 33-byte compressed encoding.
 */
export function recoverEcdsaPublicKey(
  message: Uint8Array,
  signature: Uint8Array,
  expectedEvmAddress: string,
): PublicKey {
  const want = normalizeEvmAddress(expectedEvmAddress);
  const digest = keccak_256(message);

  for (let recovery = 0; recovery < 4; recovery += 1) {
    try {
      const sig = secp256k1.Signature.fromCompact(signature).addRecoveryBit(
        recovery,
      );
      const point = sig.recoverPublicKey(digest);
      const uncompressed = point.toRawBytes(false); // 65 bytes, 0x04 prefix
      const derived = bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
      if (derived === want) {
        return PublicKey.fromStringECDSA(bytesToHex(point.toRawBytes(true)));
      }
    } catch {
      // wrong recovery id — keep trying
    }
  }

  throw new Error(
    "could not recover a public key matching the wallet address",
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/hedera/recoverPublicKey.test.ts`
Expected: PASS

> `point.toRawBytes` が存在しないエラーが出た場合（noble-curves のバージョン差）: `point.toHex(false)` / `point.toHex(true)` を使い、`hexToBytes` で変換する。インストール版は `@noble/curves@1.9.x` を想定（Global Constraints 参照）。

- [ ] **Step 5: コミット**

```bash
git add x402-sample/apps/frontend/src/hedera/recoverPublicKey.ts x402-sample/apps/frontend/src/hedera/recoverPublicKey.test.ts
git commit -m "feat(frontend): 署名からsecp256k1公開鍵を復元"
```

---

## Task 5: Privy Hedera signer（核心）

**Files:**
- Create: `x402-sample/apps/frontend/src/x402/privyHederaSigner.ts`
- Test: `x402-sample/apps/frontend/src/x402/privyHederaSigner.test.ts`

**Interfaces:**
- Consumes:
  - `bytesToBase64`（Task 2）
  - `recoverEcdsaPublicKey`（Task 4）
  - `@hiero-ledger/sdk`: `AccountId`, `Hbar`, `TransferTransaction`, `TransactionId`, `Transaction`, `PublicKey`
  - `@noble/hashes/sha3`（`keccak_256`）, `@noble/hashes/utils`（`bytesToHex`, `hexToBytes`）
  - `@x402/hedera` の型 `ClientHederaSigner`（`import type`）
  - `@x402/core/types` の型 `PaymentRequirements`（`import type`）
- Produces:
  - `type SignRawHash = (hashHex: string) => Promise<string>` — 0x 前置の 32 バイトハッシュを受け、hex 署名（0x 有無・64/65 バイトいずれも可）を返す。
  - `type PrivyHederaSignerOptions = { accountId: string; evmAddress: string; signRawHash: SignRawHash; nodeAccountIds?: string[] }`
  - `createPrivyHederaSigner(options: PrivyHederaSignerOptions): ClientHederaSigner`
  - `toCompactSignature(sigHex: string): Uint8Array` — 64 バイト r‖s へ正規化（65 バイトなら末尾 recovery バイトを落とす）。

- [ ] **Step 1: テストを書く**

`apps/frontend/src/x402/privyHederaSigner.test.ts`:

```ts
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import { createPrivyHederaSigner, toCompactSignature } from "./privyHederaSigner";

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
    const base64 = await signer.createPartiallySignedTransferTransaction(
      requirements,
    );
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
    const base64 = await signer.createPartiallySignedTransferTransaction(
      requirements,
    );
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/x402/privyHederaSigner.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`apps/frontend/src/x402/privyHederaSigner.ts`:

```ts
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  AccountId,
  Hbar,
  PublicKey,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientHederaSigner } from "@x402/hedera";

import { bytesToBase64 } from "../lib/encoding";
import { recoverEcdsaPublicKey } from "../hedera/recoverPublicKey";

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
    const probeSig = toCompactSignature(
      await signRawHash(`0x${bytesToHex(probe)}`),
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
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/x402/privyHederaSigner.test.ts`
Expected: PASS

> `tx.getSignatures()` の戻り値形が SDK バージョンで違う場合、その 1 ケースは「`Transaction.fromBytes` 後に `tx.toBytes()` 再直列化で例外が出ない」に緩める。`net === 0n` と `-1000` の検証は必ず残すこと。

- [ ] **Step 5: コミット**

```bash
git add x402-sample/apps/frontend/src/x402/privyHederaSigner.ts x402-sample/apps/frontend/src/x402/privyHederaSigner.test.ts
git commit -m "feat(frontend): Privyウォレット用のClientHederaSignerを実装"
```

---

## Task 6: x402 支払いオーケストレーション

**Files:**
- Create: `x402-sample/apps/frontend/src/x402/payPremium.ts`
- Test: `x402-sample/apps/frontend/src/x402/payPremium.test.ts`

**Interfaces:**
- Consumes:
  - `@x402/fetch`: `wrapFetchWithPayment`, `x402Client`, `x402HTTPClient`
  - `@x402/hedera/exact/client`: `ExactHederaScheme`
  - `ClientHederaSigner`（Task 5 の `createPrivyHederaSigner` の戻り値）
- Produces: `payPremium(signer: ClientHederaSigner, resourceServerUrl: string): Promise<{ body: unknown; settlement: unknown }>`
  - `GET {resourceServerUrl}/premium` を x402 支払い付きで実行。
  - 成功時は `{ body: <JSON>, settlement: <getPaymentSettleResponse の結果 or null> }`。
  - 非 2xx は `Error`（ステータスと本文を含む）。

- [ ] **Step 1: テストを書く**

`apps/frontend/src/x402/payPremium.test.ts`:

```ts
import type { ClientHederaSigner } from "@x402/hedera";
import { afterEach, describe, expect, it, vi } from "vitest";

import { payPremium } from "./payPremium";

const noopSigner: ClientHederaSigner = {
  accountId: "0.0.5005",
  createPartiallySignedTransferTransaction: async () => "",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("payPremium", () => {
  it("returns the JSON body when the resource responds 200 without payment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "ok", priceTinybars: "1000" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await payPremium(noopSigner, "http://localhost:4021");
    expect(result.body).toEqual({ message: "ok", priceTinybars: "1000" });
  });

  it("throws with the status when the resource responds with an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    await expect(
      payPremium(noopSigner, "http://localhost:4021"),
    ).rejects.toThrow("500");
  });

  it("requests the /premium path on the configured server", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    await payPremium(noopSigner, "http://localhost:4021");
    const calledUrl = String(
      (spy.mock.calls[0]?.[0] as URL | string) ?? "",
    );
    expect(calledUrl).toContain("/premium");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/x402/payPremium.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`apps/frontend/src/x402/payPremium.ts`:

```ts
import {
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
} from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import type { ClientHederaSigner } from "@x402/hedera";

export type PayPremiumResult = {
  body: unknown;
  settlement: unknown;
};

/**
 * Performs `GET {resourceServerUrl}/premium` through the x402 payment flow:
 * the first response is 402, the Hedera signer produces a partially-signed
 * transfer, and `@x402/fetch` retries with the `X-PAYMENT` header. Mirrors
 * `apps/client/src/index.ts`.
 */
export async function payPremium(
  signer: ClientHederaSigner,
  resourceServerUrl: string,
): Promise<PayPremiumResult> {
  const client = new x402Client().register(
    "hedera:*",
    new ExactHederaScheme(signer),
  );

  const url = new URL("/premium", resourceServerUrl);
  const response = await wrapFetchWithPayment(fetch, client)(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Payment request failed (${response.status}): ${text}`,
    );
  }

  const body = await response.json();

  let settlement: unknown = null;
  try {
    settlement = new x402HTTPClient(client).getPaymentSettleResponse((name) =>
      response.headers.get(name),
    );
  } catch {
    settlement = null;
  }

  return { body, settlement };
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/x402/payPremium.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add x402-sample/apps/frontend/src/x402/payPremium.ts x402-sample/apps/frontend/src/x402/payPremium.test.ts
git commit -m "feat(frontend): x402支払い付きで/premiumを取得するpayPremiumを追加"
```

---

## Task 7: UI（PremiumPanel + App + CSS）

**Files:**
- Create: `x402-sample/apps/frontend/src/components/PremiumPanel.tsx`
- Modify: `x402-sample/apps/frontend/src/App.tsx`
- Modify: `x402-sample/apps/frontend/src/css/index.css`
- Test: `x402-sample/apps/frontend/src/components/formatHbar.test.ts`（純粋関数のみテスト）

**Interfaces:**
- Consumes: `usePrivy`, `useWallets`（`@privy-io/react-auth`）、`config`（Task 2）、`resolveHederaAccount`（Task 3）、`createPrivyHederaSigner` + `SignRawHash`（Task 5）、`payPremium`（Task 6）。
- Produces:
  - `PremiumPanel`（default export の React コンポーネント、props なし）。
  - `formatHbar(tinybars: bigint): string`（`src/components/formatHbar.ts`、表示補助・テスト対象）。

このタスクはロジックの大半を Task 3〜6 に委譲済みのため、UI は薄く保つ。TDD はテスト可能な純粋関数 `formatHbar` にのみ適用し、コンポーネントは手動 E2E（Task 9）で検証する。

- [ ] **Step 1: `formatHbar` のテストを書く**

`apps/frontend/src/components/formatHbar.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatHbar } from "./formatHbar";

describe("formatHbar", () => {
  it("converts tinybars to HBAR with up to 8 decimals", () => {
    expect(formatHbar(100_000_000n)).toBe("1 ℏ");
    expect(formatHbar(150_000_000n)).toBe("1.5 ℏ");
    expect(formatHbar(1000n)).toBe("0.00001 ℏ");
  });

  it("formats zero", () => {
    expect(formatHbar(0n)).toBe("0 ℏ");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm --filter frontend exec vitest run src/components/formatHbar.test.ts`
Expected: FAIL

- [ ] **Step 3: `formatHbar` を実装**

`apps/frontend/src/components/formatHbar.ts`:

```ts
const TINYBARS_PER_HBAR = 100_000_000n;

/** Formats a tinybar amount as a trimmed decimal HBAR string, e.g. "1.5 ℏ". */
export function formatHbar(tinybars: bigint): string {
  const negative = tinybars < 0n;
  const abs = negative ? -tinybars : tinybars;
  const whole = abs / TINYBARS_PER_HBAR;
  const frac = (abs % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return frac.length > 0 ? `${sign}${whole}.${frac} ℏ` : `${sign}${whole} ℏ`;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm --filter frontend exec vitest run src/components/formatHbar.test.ts`
Expected: PASS

- [ ] **Step 5: `PremiumPanel` を実装**

`apps/frontend/src/components/PremiumPanel.tsx`:

```tsx
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

import { config } from "../config";
import { resolveHederaAccount } from "../hedera/resolveAccount";
import type { ResolvedHederaAccount } from "../hedera/resolveAccount";
import {
  createPrivyHederaSigner,
  type SignRawHash,
} from "../x402/privyHederaSigner";
import { payPremium, type PayPremiumResult } from "../x402/payPremium";
import { formatHbar } from "./formatHbar";

type Phase =
  | { kind: "resolving" }
  | { kind: "unfunded"; evmAddress: string }
  | { kind: "ready"; account: ResolvedHederaAccount }
  | { kind: "paying"; account: ResolvedHederaAccount }
  | { kind: "done"; account: ResolvedHederaAccount; result: PayPremiumResult }
  | { kind: "error"; message: string };

export default function PremiumPanel() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
  const evmAddress = embedded?.address ?? user?.wallet?.address ?? "";

  const [phase, setPhase] = useState<Phase>({ kind: "resolving" });

  const refresh = useCallback(async () => {
    if (!evmAddress) {
      return;
    }
    setPhase({ kind: "resolving" });
    try {
      const account = await resolveHederaAccount(
        evmAddress,
        config.mirrorNodeUrl,
      );
      setPhase(
        account
          ? { kind: "ready", account }
          : { kind: "unfunded", evmAddress },
      );
    } catch (error) {
      setPhase({ kind: "error", message: describeError(error) });
    }
  }, [evmAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pay = useCallback(async () => {
    if (phase.kind !== "ready" || !embedded) {
      return;
    }
    const account = phase.account;
    setPhase({ kind: "paying", account });
    try {
      const provider = await embedded.getEthereumProvider();
      const signRawHash: SignRawHash = async (hashHex) =>
        (await provider.request({
          method: "secp256k1_sign",
          params: [hashHex],
        })) as string;

      const signer = createPrivyHederaSigner({
        accountId: account.accountId,
        evmAddress,
        signRawHash,
      });
      const result = await payPremium(signer, config.resourceServerUrl);
      setPhase({ kind: "done", account, result });
    } catch (error) {
      setPhase({ kind: "error", message: describeError(error) });
    }
  }, [phase, embedded, evmAddress]);

  return (
    <section className="panel">
      <p>
        Wallet: <code>{evmAddress || "—"}</code>
      </p>
      {phase.kind === "resolving" && <p>Resolving Hedera account…</p>}

      {phase.kind === "unfunded" && (
        <div>
          <p>
            この EVM アドレスに対応する Hedera testnet 口座がまだありません。
            次を実行して資金を投入してください:
          </p>
          <code>pnpm --filter frontend fund {phase.evmAddress}</code>
          <p>
            <button type="button" onClick={() => void refresh()}>
              再確認
            </button>
          </p>
        </div>
      )}

      {(phase.kind === "ready" ||
        phase.kind === "paying" ||
        phase.kind === "done") && (
        <div>
          <p>
            Account: <code>{phase.account.accountId}</code> — balance{" "}
            {formatHbar(phase.account.balanceTinybars)}
          </p>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={phase.kind === "paying"}
          >
            {phase.kind === "paying"
              ? "支払い中…"
              : "支払って /premium を取得"}
          </button>
        </div>
      )}

      {phase.kind === "done" && (
        <div>
          <h2>Response</h2>
          <pre>{JSON.stringify(phase.result.body, null, 2)}</pre>
          <h2>Settlement</h2>
          <pre>{JSON.stringify(phase.result.settlement, null, 2)}</pre>
          {settlementTxId(phase.result.settlement) && (
            <p>
              <a
                href={`https://hashscan.io/testnet/transaction/${settlementTxId(
                  phase.result.settlement,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                HashScan で確認
              </a>
            </p>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <div>
          <p className="error">エラー: {phase.message}</p>
          <button type="button" onClick={() => void refresh()}>
            やり直す
          </button>
        </div>
      )}
    </section>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settlementTxId(settlement: unknown): string | null {
  if (settlement && typeof settlement === "object") {
    const value = (settlement as Record<string, unknown>).transaction;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
```

> `provider.request` の `secp256k1_sign` が未対応の Privy バージョンだった場合の代替: `import { useSignRawHash } from "@privy-io/react-auth/extended-chains"` を使い、`signRawHash: (hashHex) => useSignRawHash 経由で { address: evmAddress, chainType: "ethereum", hash: hashHex } を渡し .signature を返す`。フックはコンポーネント本体で呼ぶこと（`pay` の中で呼ばない）。

> `settlementTxId` が拾うフィールド名（`transaction` / `transactionId` / `txHash`）は、Task 9 の E2E で実レスポンスを見て確定し、必要なら修正する。

- [ ] **Step 6: `App.tsx` を仕上げる**

`apps/frontend/src/App.tsx` を置き換え:

```tsx
import { usePrivy } from "@privy-io/react-auth";

import PremiumPanel from "./components/PremiumPanel";

function App() {
  const { ready, authenticated, login, logout } = usePrivy();

  if (!ready) {
    return <p>Loading…</p>;
  }

  return (
    <main className="app">
      <h1>x402 × Privy (Hedera testnet)</h1>
      {authenticated ? (
        <>
          <p>
            <button type="button" onClick={() => logout()}>
              Log out
            </button>
          </p>
          <PremiumPanel />
        </>
      ) : (
        <button type="button" onClick={() => login()}>
          Log in
        </button>
      )}
    </main>
  );
}

export default App;
```

- [ ] **Step 7: CSS を追記**

`apps/frontend/src/css/index.css` の末尾に追加:

```css
.app {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
  text-align: left;
}

.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
}

.panel button {
  font: inherit;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--accent-border);
  background: var(--accent-bg);
  color: var(--text-h);
  cursor: pointer;
}

.panel button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.panel pre {
  background: var(--code-bg);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 13px;
}

.panel .error {
  color: #d4183d;
}
```

- [ ] **Step 8: 全テスト・lint・build を確認**

Run:
```bash
pnpm --filter frontend exec vitest run
pnpm --filter frontend run lint
pnpm --filter frontend run build
```
Expected: すべて PASS。`react/only-export-components` の warn が `PremiumPanel.tsx` で出る場合は、`formatHbar` など非コンポーネント export を別ファイルへ分離済みなので発生しないはず。発生したら該当ヘルパーをファイル外へ移す。

- [ ] **Step 9: コミット**

```bash
git add x402-sample/apps/frontend/src
git commit -m "feat(frontend): 支払いパネルUIとログインゲートを実装"
```

---

## Task 8: 資金投入スクリプト

**Files:**
- Create: `x402-sample/apps/frontend/scripts/fund-wallet.ts`
- Modify: `x402-sample/apps/frontend/README.md`（Task 9 で本格的に。ここでは使い方の最小メモのみ）

**Interfaces:**
- Consumes: `apps/client/.env` の `PAYER_ACCOUNT_ID` / `PAYER_PRIVATE_KEY`（既存の資金済み testnet 口座）、`@hiero-ledger/sdk`, `dotenv`。
- Produces: CLI `pnpm --filter frontend fund <evmAddress> [hbarAmount]`。EVM エイリアス宛に HBAR を送金し、作成された `0.0.X` を標準出力に表示。

このタスクは実 HBAR を送るスクリプトで、ユニットテストは付けない（`pnpm check` の対象外パス）。手元の testnet 資金で 1 回動作確認する。

- [ ] **Step 1: スクリプトを実装**

`apps/frontend/scripts/fund-wallet.ts`:

```ts
import { config as loadEnv } from "dotenv";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from "@hiero-ledger/sdk";

// Reuse the funded testnet payer already configured for the CLI client.
loadEnv({ path: new URL("../../client/.env", import.meta.url).pathname });

const MIRROR = "https://testnet.mirrornode.hedera.com";

async function main(): Promise<void> {
  const [evmAddressArg, amountArg] = process.argv.slice(2);
  if (!evmAddressArg || !/^0x[0-9a-fA-F]{40}$/.test(evmAddressArg)) {
    throw new Error(
      "usage: pnpm --filter frontend fund <0x-evm-address> [hbarAmount]",
    );
  }
  const hbarAmount = Number(amountArg ?? "5");
  if (!Number.isFinite(hbarAmount) || hbarAmount <= 0) {
    throw new Error("hbarAmount must be a positive number");
  }

  const payerId = process.env.PAYER_ACCOUNT_ID;
  const payerKey = process.env.PAYER_PRIVATE_KEY;
  if (!payerId || !payerKey) {
    throw new Error(
      "PAYER_ACCOUNT_ID / PAYER_PRIVATE_KEY must be set in apps/client/.env",
    );
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(payerId),
    PrivateKey.fromStringECDSA(payerKey),
  );

  const evmAddress = evmAddressArg.toLowerCase();
  const recipient = AccountId.fromEvmAddress(0, 0, evmAddress);

  console.log(`Sending ${hbarAmount} ℏ to ${evmAddress} …`);
  const response = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(payerId), new Hbar(-hbarAmount))
    .addHbarTransfer(recipient, new Hbar(hbarAmount))
    .execute(client);
  const receipt = await response.getReceipt(client);
  console.log("Transfer status:", receipt.status.toString());

  const lookup = await fetch(`${MIRROR}/api/v1/accounts/${evmAddress}`);
  if (lookup.ok) {
    const body = (await lookup.json()) as { account: string };
    console.log("Hedera account id:", body.account);
    console.log(
      "→ フロントの残高表示が更新されるまで数秒かかることがあります。",
    );
  } else {
    console.log(
      "Mirror node にまだ反映されていません。数秒後に画面の「再確認」を押してください。",
    );
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

> `import.meta.url` からの `.pathname` は Windows で不正確。Windows 実行を考慮するなら `node:url` の `fileURLToPath` を使う。まずは macOS/Linux 前提で可。

- [ ] **Step 2: 型チェック**

Run: `pnpm --filter frontend exec tsc --noEmit -p tsconfig.node.json 2>/dev/null || npx tsx --check scripts/fund-wallet.ts`
（`tsconfig.node.json` は `vite.config.ts` のみ include のため、簡易に `npx tsx scripts/fund-wallet.ts` を引数なしで実行し、usage エラーで即終了することを確認する）

Run: `pnpm --filter frontend exec tsx scripts/fund-wallet.ts`
Expected: `usage: pnpm --filter frontend fund <0x-evm-address> [hbarAmount]` を表示して exit code 1

- [ ] **Step 3: knip / lint / build を確認**

Run:
```bash
pnpm knip
pnpm --filter frontend run build
```
Expected: PASS（`scripts/fund-wallet.ts` は knip entry 済み、build 対象外）

- [ ] **Step 4: コミット**

```bash
git add x402-sample/apps/frontend/scripts/fund-wallet.ts
git commit -m "feat(frontend): EVMエイリアス宛にHBARを送るfund-walletスクリプト"
```

---

## Task 9: ドキュメントと E2E 検証

**Files:**
- Modify: `x402-sample/apps/frontend/README.md`
- Modify: `x402-sample/README.md`
- Modify: `README.md`（リポジトリルート）

**Interfaces:**
- Consumes: Task 1〜8 の全成果物。
- Produces: 再現手順書。E2E で実レスポンスを確認し、`PremiumPanel` の `settlementTxId` フィールド名を確定。

- [ ] **Step 1: フロントエンド README を書く**

`apps/frontend/README.md` を次で置き換え:

````markdown
# frontend — x402 × Privy (Hedera testnet)

Privy 内蔵ウォレットで x402 の支払い署名データを生成し、`apps/server` の
`/premium`（x402 保護リソース）をブラウザから取得するサンプル。

## セットアップ

```sh
cp apps/frontend/.env.example apps/frontend/.env
```

`apps/frontend/.env` を設定:

- `VITE_PRIVY_APP_ID` — Privy Dashboard の App ID
- `VITE_RESOURCE_SERVER_URL` — 既定 `http://localhost:4021`

Privy Dashboard 側:

- Login methods に Email など任意の 1 つを有効化
- Embedded wallets を有効化（EVM）
- 開発を滑らかにするなら署名確認 UI を抑制（任意）

サーバー側 `apps/server/.env` に `ALLOWED_ORIGINS=http://localhost:5173` を設定
（Vite の既定ポート）。

## 実行

```sh
# 端末 1
pnpm dev:server

# 端末 2
pnpm --filter frontend dev
```

## 手順

1. ブラウザで Vite の URL を開き、Privy でログイン
2. 表示された Wallet（EVM アドレス）に資金を投入:
   ```sh
   pnpm --filter frontend fund 0xあなたのアドレス
   ```
   `apps/client/.env` の `PAYER_ACCOUNT_ID` / `PAYER_PRIVATE_KEY`（資金済み
   testnet 口座）から 5 ℏ を送金し、`0.0.X` を lazy-create する
3. 画面の「再確認」を押すと Account id と残高が表示される
4. 「支払って /premium を取得」→ Privy が署名 → レスポンス JSON と
   Settlement が表示される
5. 「HashScan で確認」リンクでトランザクションが SUCCESS であることを確認

## 仕組み

- `src/x402/privyHederaSigner.ts` が `@x402/hedera` の `ClientHederaSigner` を実装。
  `TransferTransaction` を組み、`keccak256(bodyBytes)` を Privy の
  `secp256k1_sign`（生ハッシュ署名）に渡して 64 バイト r‖s を添付する。
- `src/x402/payPremium.ts` が `@x402/fetch` の `wrapFetchWithPayment` +
  `x402Client` + `ExactHederaScheme` で 402 → 支払い → リトライを実行する
  （`apps/client/src/index.ts` と同じ経路）。
- 口座は `src/hedera/resolveAccount.ts` が mirror node で EVM アドレスから解決する。
````

- [ ] **Step 2: E2E を実行して確認**

以下を手動で実行し、結果を記録する:

1. `cd x402-sample && pnpm install`
2. `apps/server/.env`（`PAY_TO_ACCOUNT_ID`, `ALLOWED_ORIGINS`）、`apps/client/.env`（`PAYER_*`）、`apps/frontend/.env`（`VITE_*`）を設定
3. `pnpm dev:server` → 別端末 `curl http://localhost:4021/health` が `{"status":"ok"}`
4. `pnpm --filter frontend dev` → ブラウザでログイン
5. `pnpm --filter frontend fund 0x...` を実行、`Transfer status: SUCCESS` と `Hedera account id: 0.0.X` を確認
6. 「再確認」→ 残高表示、「支払って /premium を取得」→ Privy 署名
7. レスポンス JSON（`{ "message": "Payment settled on Hedera testnet.", "priceTinybars": "1000" }`）と Settlement が表示される
8. Settlement オブジェクトの実フィールド名を確認する

- [ ] **Step 3: `settlementTxId` を実データに合わせる**

Step 2-8 で確認した Settlement のトランザクション ID フィールド名に合わせて
`apps/frontend/src/components/PremiumPanel.tsx` の `settlementTxId` を修正
（`transaction` でなければ実名に置換）。HashScan の URL 形式も
`https://hashscan.io/testnet/transaction/<id>` で開けることを確認。

- [ ] **Step 4: ルート README にリンクを追加**

`x402-sample/README.md` の `## Run` 節の後に追加:

```markdown
## Frontend (Privy)

ブラウザから Privy 内蔵ウォレットで x402 支払いを行うサンプルは
[`apps/frontend/README.md`](apps/frontend/README.md) を参照。
```

リポジトリルート `README.md` の x402 に触れている箇所（「x402 Pay-per-use
template」の段落付近）に 1 行追加:

```markdown
- 本リポジトリの `x402-sample/apps/frontend` は、Privy 内蔵ウォレットで
  x402 支払い署名を生成しブラウザから有料リソースを取得する実装例。
```

- [ ] **Step 5: 最終チェック**

Run: `cd x402-sample && pnpm check`
Expected: PASS（`format:check` / `lint` / `knip` / `build`（全 workspace）/ `test`（server + frontend））

- [ ] **Step 6: コミット**

```bash
git add x402-sample/apps/frontend/README.md x402-sample/README.md README.md x402-sample/apps/frontend/src/components/PremiumPanel.tsx
git commit -m "docs(frontend): セットアップとE2E手順を追加、決済ID表示を実データに調整"
```

---

## Self-Review

### 1. Spec coverage

| Spec 節 | 対応タスク |
|---|---|
| §1 スコープ（最小 UI、カスタム signer、口座解決、CORS、資金スクリプト、テスト） | Task 1〜9 |
| §2.1 x402 クライアント経路の再利用 | Task 6 |
| §2.2 `ClientHederaSigner` 差し替え | Task 5 |
| §2.3 ECDSA = keccak256 + 64B r‖s | Task 5 Step 3（`keccak_256` → `signWith` → `toCompactSignature`） |
| §2.4 Privy 生ハッシュ署名 | Task 7 Step 5（`secp256k1_sign`）+ フォールバック注記 |
| §2.5 公開鍵復元 | Task 4 |
| §2.6 ブラウザ実行性（node ID 明示 freeze、polyfill） | Task 5 Step 3、Task 2 Step 3 |
| §2.7 ヘッダ名 | Task 1 Step 7（`exposeHeaders`/`allowHeaders`） |
| §4 データフロー | Task 3→4→5→6→7 の連結 |
| §5.1 各コンポーネント | Task 2（config）, 3, 4, 5, 6, 7 |
| §5.2 fund スクリプト | Task 8 |
| §5.3 サーバー CORS | Task 1 |
| §5.4 環境変数 | Task 1 Step 9、Task 2 Step 6 |
| §5.5 依存 | Task 2 Step 1 |
| §5.6 vite polyfill | Task 2 Step 3 |
| §6 エラーハンドリング | Task 7 Step 5（`Phase` 状態機械: unfunded / error / paying） |
| §7.1 サーバーテスト | Task 1 Step 1,5 |
| §7.2 フロントテスト | Task 2,3,4,5,6,7 の各 test |
| §7.3 手動 E2E | Task 9 |
| §8 実装順序 | Task 1〜9 がそのまま対応 |
| §9 リスク（polyfill、署名形式、node ID、Privy 版差） | Task 2 Step 18 注記、Task 5 `toCompactSignature` + Step 4 注記、Task 5 `DEFAULT_NODE_ACCOUNT_IDS`、Task 7 Step 5 フォールバック |
| §10 完了の定義 | Task 9 Step 5 |

ギャップなし。

### 2. Placeholder scan

- 「適切なエラー処理を追加」等の曖昧指示なし。全コードブロックは実内容。
- Task 9 Step 3 は「実データを見て 1 つの識別子を確定」する調整で、E2E の性質上必要な既知の 1 点。プレースホルダではない（デフォルト実装 `transaction` は動作する前提で記述済み）。
- `settlementTxId` のフィールド名、Privy 署名 API のバージョン差、noble `toRawBytes` の 3 点は「まず既定実装、ダメなら注記の代替」という形で具体化済み。

### 3. Type consistency

- `resolveHederaAccount` → `{ accountId: string; balanceTinybars: bigint } | null`（Task 3 定義）を Task 7 が `ResolvedHederaAccount` 型で consume。一致。
- `recoverEcdsaPublicKey(message, signature, expectedEvmAddress): PublicKey`（Task 4）を Task 5 が同シグネチャで呼ぶ。一致。
- `createPrivyHederaSigner(options): ClientHederaSigner` / `SignRawHash`（Task 5）を Task 7 が同名で import。一致。
- `payPremium(signer, resourceServerUrl): Promise<{ body, settlement }>`（Task 6）を Task 7 が `PayPremiumResult` で受ける。一致。
- `bytesToBase64`（Task 2）を Task 5 が import。一致。
- `config`（Task 2、`mirrorNodeUrl` / `resourceServerUrl` / `privyAppId`）を Task 7・main.tsx が参照。一致。
- サーバー `ServerConfig.allowedOrigins: string[]`（Task 1）を `createApp` の `cors({ origin: config.allowedOrigins })` が使用。一致。既存 `config.test.ts` の `toEqual` も Task 1 Step 1 で更新済み。

不整合なし。
