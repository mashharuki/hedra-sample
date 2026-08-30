# フロントエンドから x402 サーバーへ Privy ウォレットで支払う — 設計書

- 日付: 2026-08-30
- 対象リポジトリ: `hedra-sample` / `x402-sample` モノレポ
- ステータス: レビュー待ち

## 1. 目的とスコープ

`x402-sample` には Hedera テストネット対応の x402 v2 リソースサーバー（`apps/server`）と、
スクリプトで支払いに成功済みの CLI クライアント（`apps/client`）がある。

本設計は **ブラウザ（`apps/frontend`）から** `/premium` にアクセスし、
**Privy の内蔵 EVM ウォレットで x402 用の支払い署名データ（部分署名済み Hedera
`TransferTransaction`）を生成** して 402 → 支払い → リトライを完了させ、
有料リソースの JSON と決済トランザクション情報を画面に表示することを目指す。

### スコープに含む

- `apps/frontend` を「最小・機能重視」で実装（Privy ログイン → 支払いボタン → 結果表示）
- Privy 内蔵 EVM ウォレット（secp256k1）を Hedera トランザクション署名に使うカスタム signer
- Privy ウォレットの EVM アドレスに対応する Hedera 口座の解決（mirror node）
- `apps/server` への CORS 追加（ブラウザからのクロスオリジンアクセスを許可）
- ウォレットへの資金投入を補助する CLI スクリプト（ブラウザ外で実行）
- ユニットテスト（signer / 公開鍵復元 / サーバー CORS）と手動 E2E 手順書

### スコープに含まない

- 本番/メインネット対応、複数チェーン対応
- 支払い履歴の永続化、認証以外のバックエンド
- スタイリングの作り込み（最小限の CSS のみ）
- Privy 内蔵の `useX402Fetch`（Base/Solana 専用で Hedera 非対応のため不使用）
- HTS トークン決済（HBAR のみ対応。コードは既存 `ClientHederaSigner` と同じくトークン分岐を持つが未検証）

## 2. 背景（調査で確定した事実）

`node_modules` の実物とソースを確認済み。

### 2.1 x402 クライアント経路（`apps/client/src/index.ts` と同じ）

- `x402Client().register("hedera:*", new ExactHederaScheme(signer))` に signer を渡す
- `wrapFetchWithPayment(fetch, client)(url)` が 402 レスポンスを受けて payload を作り自動リトライ
- 決済情報は `new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name))`
- `@x402/fetch` / `@x402/core` はブラウザでも動作（`fetch` ベース、Node 固有 API に非依存）

### 2.2 `ClientHederaSigner` インターフェース（差し替えポイント）

`@x402/hedera` の型定義より、必要なのは 2 つだけ:

```ts
type ClientHederaSigner = {
  readonly accountId: string;
  createPartiallySignedTransferTransaction(
    requirements: PaymentRequirements,
  ): Promise<string>; // base64 の直列化済みトランザクション
};
```

`@x402/hedera` の既定実装 `createClientHederaSigner`（`dist/cjs/index.js`）の中身:

```
const tx = new TransferTransaction();
tx.addHbarTransfer(payerAccountId, Hbar.fromTinybars(-amount));
tx.addHbarTransfer(payTo,          Hbar.fromTinybars(+amount));
tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer))); // extra.feePayer
tx.freezeWith(client);              // testnet クライアント（オペレーターなし）
const signed = await tx.sign(privateKey);
return Buffer.from(signed.toBytes()).toString("base64");
```

→ **差し替えるのは `tx.sign(privateKey)` の 1 行だけ。** それ以外は既定実装をなぞる。
`requirements.extra.feePayer`（facilitator の手数料支払い口座）がトランザクション ID の
アカウントになる点に注意。payer は HBAR 転送の借方にのみ現れる。

### 2.3 Hedera の ECDSA 署名方式（`@hiero-ledger/cryptography` の `primitive/ecdsa.cjs`）

```js
function sign(keydata, message) {
  const data = keccak256(message);          // 32 バイトダイジェスト
  const signature = secp256k1.sign(data, keydata);
  return signature.toCompactRawBytes();     // 64 バイト r||s（recovery バイトなし）
}
```

`Transaction.signWith(publicKey, fn)`（`@hiero-ledger/sdk` の `Transaction.cjs`）は
`fn(bodyBytes)` の返り値をそのまま署名として `sigMap.sigPair` に格納する
（`publicKey._toProtobufSignature(signature)`）。
→ **`fn` の中で `keccak256(bodyBytes)` して secp256k1 署名し、64 バイト r||s を返せばよい。**
`tx.sign(privateKey)` は `signWith(privateKey.publicKey, m => privateKey.sign(m))` の薄いラッパー。

### 2.4 Privy の生ハッシュ署名

- EIP-1193 provider の `provider.request({ method: "secp256k1_sign", params: [hashHex] })`
- または `useSignRawHash`（`@privy-io/react-auth/extended-chains`）
- 渡した 32 バイトハッシュを **追加ハッシュなしでそのまま** 署名する（＝ Hedera が要求する挙動）
- 返り値のバイト数（64 / 65）と `0x` 前置は実装時に正規化しユニットテストで固定する

### 2.5 公開鍵の入手

Privy 内蔵ウォレットは EVM アドレスを返すが secp256k1 公開鍵を直接は出さない。
署名 1 つ（ダイジェスト + 64 バイト r||s）から recovery bit 0〜3 を総当たりし、
復元した公開鍵の keccak256 下位 20 バイトが EVM アドレスと一致するものを選ぶ
（`@noble/curves/secp256k1` の `Signature.addRecoveryBit(k).recoverPublicKey(hash)`）。
得た圧縮公開鍵 hex を `PublicKey.fromStringECDSA(hex)` に渡す。

### 2.6 ブラウザ実行性

- `@hiero-ledger/sdk` は `package.json` の `browser` フィールドあり（`./lib/browser.js`）。Vite が解決
- 既定 signer は `freezeWith(client)` に testnet クライアントを使うが、
  本設計では **ネットワーク非依存**にするため `tx.setNodeAccountIds([...])` + `tx.freeze()` を使う
  （gRPC-web クライアントを起動しない。ノード ID は複数指定してレジリエンスを確保）
- `@x402/hedera` / SDK 内部が `Buffer` / `global` を参照するため Vite に polyfill を追加

### 2.7 x402 の HTTP ヘッダ名（`@x402/core` `client/index.js`）

ブラウザ JS が読む必要があるレスポンスヘッダ:
`PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `X-PAYMENT-RESPONSE`
リクエストヘッダ: `X-PAYMENT`
→ サーバー CORS の `exposeHeaders` / `allowHeaders` に反映する。

## 3. 検討したアプローチ

### A. ブラウザでカスタム `ClientHederaSigner` を実装し `@x402/fetch` を再利用 ★採用

`apps/client` とほぼ同一構成。signer だけ Privy 版に差し替え、402→支払い→リトライは
ライブラリ任せ。

- 利点: 新概念が最小 / 公式 x402 クライアント経路をそのまま使う / 既存 client と対比しやすい
- 欠点: `@hiero-ledger/sdk` をブラウザに載せる（バンドル増 + polyfill）/ 公開鍵復元が必要 /
  keccak256・署名バイト整形を正確にやる必要

### B. 薄いバックエンドで payload を組む

署名はブラウザ、トランザクション組み立て/直列化はサーバー。

- 利点: SDK をブラウザに載せない
- 欠点: 新しいサーバー面 / フローがネットワーク跨ぎで分断 / サンプルには過剰（YAGNI）

### C. x402 クライアントもトランザクション構築も手実装

- 欠点: 動作実績のあるライブラリを捨てる / バグ面が大きい。サンプルには不利

**採用理由（A）**: すでに動いている `apps/client` の最小差分。差し替え点が
「signer の署名 1 ステップ」に閉じており、リスクが局所化される。バンドル/polyfill は
Vite で解決済みの既知の問題。

## 4. アーキテクチャとデータフロー

```
[Privy ログイン] --embedded EVM wallet (secp256k1)-->
  resolveAccount: GET {mirror}/api/v1/accounts/{evmAddress}
     -> { accountId: "0.0.X", balanceTinybars }  (404 の場合は未資金)
     初回のみ: scripts/fund-wallet.ts が資金済み口座から EVM エイリアス宛に HBAR 送金し
              0.0.X を lazy-create
  |
  v
[「支払って /premium を取得」クリック]
  wrapFetchWithPayment(fetch, x402Client) -> GET {RESOURCE_SERVER_URL}/premium
     <- 402  PAYMENT-REQUIRED: { scheme:"exact", network:"hedera:testnet",
                                 payTo, amount, asset:"0.0.0", extra:{ feePayer } }
  |
  v
ExactHederaScheme(privyHederaSigner).createPaymentPayload
  privyHederaSigner.createPartiallySignedTransferTransaction(requirements):
    1. new TransferTransaction()
         .addHbarTransfer(accountId, -amount)
         .addHbarTransfer(payTo,     +amount)
    2. setTransactionId(TransactionId.generate(feePayer))
    3. setNodeAccountIds([0.0.3, 0.0.4, 0.0.5]); freeze()      // ネットワーク非依存
    4. publicKey = 復元済み PublicKey（初回のみ 1 回だけ生ハッシュ署名して復元）
       await tx.signWith(publicKey, async (bodyBytes) => {
         const digest = keccak_256(bodyBytes);
         const sigHex = await signRawHash("0x"+hex(digest));   // Privy
         return normalizeToR_S_64bytes(sigHex);
       })
    5. return base64(tx.toBytes())
  |
  v
リトライ GET /premium  +  X-PAYMENT: <base64 payload>
  サーバー -> facilitator: verifyPayerSignature（mirror node の口座鍵で検証）
                          + preflightTransfer（残高・関連付け）
             facilitator が feePayer 署名を付与し Hedera testnet へ submit
  <- 200 { message, priceTinybars }  +  PAYMENT-RESPONSE ヘッダ（settle 情報 / tx id）
  |
  v
[UI 表示] レスポンス JSON + 決済トランザクション ID + HashScan リンク
```

## 5. コンポーネント設計

### 5.1 フロントエンド `apps/frontend/src/`

| ファイル | 責務 | 依存 |
|---|---|---|
| `config.ts` | 環境変数の読み取りと検証（`VITE_PRIVY_APP_ID`, `VITE_RESOURCE_SERVER_URL`）。network / mirror URL 定数 | `@x402/hedera`（`HEDERA_TESTNET_CAIP2`, `HEDERA_TESTNET_MIRROR_NODE_URL`） |
| `main.tsx` | `<PrivyProvider appId config={{ embeddedWallets: { createOnLogin: "users-without-wallets" } }}>` でラップ | `@privy-io/react-auth` |
| `hedera/resolveAccount.ts` | `resolveHederaAccount(evmAddress): Promise<{ accountId, balanceTinybars } | null>`。mirror node REST。404/未資金は `null` | fetch のみ |
| `hedera/recoverPublicKey.ts` | `recoverEcdsaPublicKey(digest, sig64, expectedEvmAddress): PublicKey`。recovery bit 総当たり + アドレス照合 | `@noble/curves`, `@noble/hashes`, `@hiero-ledger/sdk` |
| `x402/privyHederaSigner.ts` | `createPrivyHederaSigner({ accountId, evmAddress, signRawHash, network }): ClientHederaSigner`。§4 の 1〜5。公開鍵はメモ化 | `@hiero-ledger/sdk`, `@noble/hashes`, `./recoverPublicKey` |
| `x402/payPremium.ts` | `payPremium(signer, resourceServerUrl): Promise<{ body, settlement }>`。`x402Client` + `ExactHederaScheme` + `wrapFetchWithPayment` + `x402HTTPClient.getPaymentSettleResponse`（いずれも `@x402/fetch` から export。`apps/client/src/index.ts` と同じ import 構成） | `@x402/fetch`, `@x402/hedera`, （必要なら `@x402/core/http`） |
| `components/PremiumPanel.tsx` | 状態機械（`idle` / `resolving` / `unfunded` / `ready` / `paying` / `done` / `error`）。口座 ID・残高・レスポンス JSON・決済リンク・エラー表示 | 上記 + `@privy-io/react-auth` |
| `App.tsx` | `usePrivy()` でログイン/ログアウトのゲート、`<PremiumPanel/>` | `@privy-io/react-auth` |
| `css/index.css` | 最小限のレイアウト（既存ファイルに追記） | — |

**Privy 署名関数の受け渡し**: `PremiumPanel` で `useSignRawHash()`（または
`useWallets()` から provider を取得）して `signRawHash` を作り、
`createPrivyHederaSigner` に注入する。signer 自身は Privy に直接依存しない
（テスト時に stub を差し込めるようにするため）。

### 5.2 資金投入スクリプト `apps/frontend/scripts/fund-wallet.ts`

- `tsx apps/frontend/scripts/fund-wallet.ts <evmAddress> [hbarAmount=5]`
- `apps/client/.env` の `PAYER_ACCOUNT_ID` / `PAYER_PRIVATE_KEY`（資金済み testnet 口座）を読む
- `new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(payer), new Hbar(-amount))
    .addHbarTransfer(AccountId.fromEvmAddress(0, 0, evmAddress), new Hbar(amount))`
  を payer で署名し execute → receipt 待ち
- mirror node で `0.0.X` を照会して出力（`.env` の `VITE_` に貼れるように）
- `package.json`（frontend）に `"fund": "tsx scripts/fund-wallet.ts"` を追加
- 依存: `@hiero-ledger/sdk`, `dotenv`（devDependencies）
- **注**: 実際に HBAR を送るため、明示的に人間が実行するスクリプトとして分離。ブラウザからは呼ばない

### 5.3 サーバー変更 `apps/server/`

- `src/app.ts`: `import { cors } from "hono/cors";` を追加し、`/health` と `/premium` の
  ミドルウェアチェーン先頭（`paymentMiddleware` より前）に:
  ```ts
  const corsMiddleware = cors({
    origin: config.allowedOrigins,            // string[]
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-PAYMENT"],
    exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
  });
  app.use("/health", corsMiddleware);
  app.use("/premium", corsMiddleware);
  ```
- `src/config.ts`: `allowedOrigins: string[]` を追加。`env.ALLOWED_ORIGINS`（カンマ区切り）を
  パース。未設定時の既定は `["http://localhost:5173"]`。各要素を `new URL()` で検証
- `.env.example` / `.env`: `ALLOWED_ORIGINS=http://localhost:5173` を追記
- `hono` は導入済みのため新規依存なし

### 5.4 環境変数

`apps/frontend/.env.example`:
```
VITE_PRIVY_APP_ID=
VITE_RESOURCE_SERVER_URL=http://localhost:4021
```
（App ID は用意済みなので `.env` に各自設定）

### 5.5 依存追加（`apps/frontend/package.json`）

dependencies:
- `@privy-io/react-auth`（最新 v3 系。`secp256k1_sign` / `useSignRawHash` 対応版）
- `@x402/core@2.18.0`, `@x402/fetch@2.18.0`, `@x402/hedera@2.18.0`（既存 client と同一ピン）
- `@hiero-ledger/sdk`（`@x402/hedera` のピア。バージョンは lockfile の `2.85.0` に合わせる）
- `@noble/hashes`, `@noble/curves`

devDependencies:
- `vitest`, `@vitejs/plugin-react` は既存。`vite-plugin-node-polyfills`（Buffer/global 用）
- `tsx`, `dotenv`（fund-wallet スクリプト用）

### 5.6 `apps/frontend/vite.config.ts`

```ts
import { nodePolyfills } from "vite-plugin-node-polyfills";
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"], globals: { Buffer: true, global: true } })],
});
```
（`vite-plugin-node-polyfills` で不足が出た場合のみ `define: { global: "globalThis" }` を併用）

## 6. エラーハンドリング

| 状況 | UI の挙動 |
|---|---|
| 未ログイン | ログインボタンのみ表示 |
| mirror node 404（口座未作成） | `unfunded` 状態。EVM アドレスと `pnpm --filter frontend fund <addr>` の案内 + 「再確認」ボタン |
| 残高 < price + バッファ | 支払い前に警告表示（続行は可能） |
| Privy 署名をユーザーが拒否 | `catch` して `idle` に戻す。トースト/テキストで通知 |
| 402 ループが失敗（facilitator エラー） | `PAYMENT-REQUIRED` の詳細と settle の `errorReason` を表示 |
| ネットワーク/CORS エラー | サーバー未起動 or `ALLOWED_ORIGINS` 不一致の可能性を明示 |

## 7. テスト戦略

### 7.1 サーバー（vitest、既存 `apps/server/test/`）

- `app.test.ts` を追加:
  - `GET /health` に `Origin: http://localhost:5173` を付けると
    `access-control-allow-origin` が返る
  - `OPTIONS /premium`（プリフライト）が `access-control-allow-headers` に `X-PAYMENT` を含む
  - `GET /premium`（未払い、402）のレスポンスに
    `access-control-expose-headers` が `PAYMENT-REQUIRED` を含む
- 既存 `config.test.ts` に `ALLOWED_ORIGINS` のパース/検証ケースを追加
- 既存テストが引き続き通ること

### 7.2 フロントエンド（vitest を追加）

- `apps/frontend/vitest.config.ts` を追加（`environment: "node"` で十分。DOM 不要）
- `x402/privyHederaSigner.test.ts`:
  - stub `signRawHash` を `@noble/curves` + `generateECDSA` 相当の鍵で実装
    （渡された 32 バイトダイジェストを raw 署名して 64 バイト r||s を返す）
  - `createPartiallySignedTransferTransaction` を呼び:
    - `Transaction.fromBytes(base64)` がラウンドトリップする
    - デコードした HBAR 転送の純額が 0、payer の借方が `-amount`
    - `sigMap.sigPair` の署名が復元 `PublicKey` で検証成功（SDK の `ecdsa.verify` 相当）
  - 署名バイトが 65 バイト（recovery 付き）で返ってきた場合も 64 バイトに正規化される
- `hedera/recoverPublicKey.test.ts`:
  - 既知の鍵で署名 → 復元した公開鍵の EVM アドレスが期待値と一致
  - 誤った `expectedEvmAddress` では throw
- `hedera/resolveAccount.test.ts`:
  - `fetch` をモックし、200（`account` フィールドあり）→ `{ accountId, balanceTinybars }`
  - 404 → `null`

### 7.3 手動 E2E（`apps/frontend/README.md` に手順書）

1. `pnpm dev:server`（別端末で `curl localhost:4021/health` 確認）
2. `pnpm --filter frontend dev` でフロント起動
3. Privy でログイン → 内蔵ウォレットの EVM アドレスをコピー
4. `pnpm --filter frontend fund 0x...` を実行 → `0.0.X` が作成される
5. 画面で口座 ID と残高が表示されることを確認
6. 「支払って /premium を取得」→ Privy 署名 → JSON と決済リンクが表示される
7. HashScan（testnet）でトランザクションが SUCCESS であることを確認

## 8. 実装順序（プランの土台）

1. サーバー CORS（`config.ts` + `app.ts` + `.env.example` + テスト） — フロントと独立して検証可能
2. `apps/frontend` の依存追加・`vite.config.ts` polyfill・`.env.example`・`PrivyProvider`
3. `hedera/resolveAccount.ts` + テスト
4. `hedera/recoverPublicKey.ts` + テスト
5. `x402/privyHederaSigner.ts` + テスト（ここが核心。stub 署名で完結）
6. `x402/payPremium.ts`
7. `components/PremiumPanel.tsx` + `App.tsx` + CSS
8. `scripts/fund-wallet.ts` + frontend `package.json` の `fund` スクリプト
9. `apps/frontend/README.md` に手順書、ルート `README.md` から参照
10. `pnpm check`（Biome / Knip / tsc / test）を通す。Knip の `knip.json` にフロント新規 export/依存を反映

## 9. リスクと軽減策

| リスク | 軽減策 |
|---|---|
| `@hiero-ledger/sdk` のブラウザバンドルが大きい / polyfill 不足 | `vite-plugin-node-polyfills`。動かない場合の最終手段としてアプローチ C（`@hiero-ledger/proto` だけで手組み）に部分退避 |
| Privy `secp256k1_sign` の出力形式（64/65 バイト・`0x`・DER か compact か） | 実装時に実値を確認し正規化関数 + テストで固定。compact でなければ `Signature.fromDER` で吸収 |
| ノード ID ハードコード（`0.0.3` 等）が将来無効化 | 複数ノード指定。必要なら mirror node の `/api/v1/network/nodes` から取得 |
| Privy 署名プロンプトの UX | デモ用に dashboard か `embeddedWallets` 設定で確認 UI を抑制 |
| lazy-create された口座の鍵タイプ | EVM エイリアス経由なら口座鍵は ECDSA になり facilitator 検証と整合。手順書で「エイリアス宛送金」を明示 |
| `@privy-io/react-auth` のバージョン差で `useSignRawHash` の import パスが変わる | 実装時に導入版の docs / 型で確認。fallback は provider の `request({method:"secp256k1_sign"})` |
| facilitator（`x402.org/facilitator`）が testnet で不調 | 既存 client で疎通実績あり。失敗時は `errorReason` を UI に出して切り分け可能に |

## 10. 完了の定義

- `pnpm check` が通る（フロント含む）
- サーバー CORS のユニットテストが通る
- `privyHederaSigner` / `recoverPublicKey` / `resolveAccount` のユニットテストが通る
- 手動 E2E（§7.3）で `/premium` の有料 JSON と決済トランザクション ID が画面表示され、
  HashScan で SUCCESS を確認できる
- `apps/frontend/README.md` に再現手順が記載されている
