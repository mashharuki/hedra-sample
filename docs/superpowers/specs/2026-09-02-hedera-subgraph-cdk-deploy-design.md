# Hedera サブグラフを AWS CDK (EC2) でデプロイする — 設計書

- 日付: 2026-09-02
- 対象リポジトリ: `hedra-sample` / `hedera-subgraph-example`
- ステータス: レビュー待ち

## 1. 目的とスコープ

`hedera-subgraph-example` は `hardhat-erc-721-mint/contracts/MyToken.sol`（ERC-721）を
Hedera Testnet でインデックスするサブグラフで、ローカルの graph-node（`graph-node/docker-compose.yaml`）で
動作確認済み。

本設計は、この構成を **AWS CDK (TypeScript) で EC2 上に 1 コマンドでデプロイ** できるようにする。
ハッカソン審査での公開が目的で、**ホスティング期間は 1 週間程度**、終了後は `cdk destroy` で撤去する。

### スコープに含む

- `hedera-subgraph-example/infra/` に独立した CDK (TypeScript) プロジェクトを追加
- 単一スタック `HederaSubgraphStack`（EC2 + Security Group + IAM Role + Elastic IP + Outputs）
- EC2 の userData による完全自動セットアップ（Docker / Node / リポジトリ clone / `docker compose up` / サブグラフの `create` + `deploy`）
- 本番用の `deploy/docker-compose.prod.yaml`（管理ポートを localhost 限定、`restart: unless-stopped`、イメージ版固定）
- userData から実行される `deploy/ec2-bootstrap.sh`（リポジトリ内で管理・レビュー可能に）
- `infra/README.md` と既存 README への導線追記
- CDK の合成（`cdk synth`）が通ることの確認

### スコープに含まない

- HTTPS / 独自ドメイン / ロードバランサ（`http://<EIP>:8000` をそのまま使う）
- Auto Scaling、マルチ AZ、冗長化、バックアップ
- cdk-nag / コンプライアンスチェックの導入
- CI/CD パイプライン（`cdk deploy` はローカルの AWS プロファイルから手動実行）
- メインネット対応、サブグラフのロジック変更
- 別 EBS データボリューム分離（ルート 30GB に同居）
- 初回バックフィルの高速化（Hashio のレート制限は既知リスクとして許容）

## 2. 前提と確定事実

### 2.1 リポジトリの状態

- git remote: `origin = https://github.com/mashharuki/hedra-sample.git`、デフォルトブランチ `main`
- `hedera-subgraph-example` の変更一式は **ステージ済みだが未コミット**。
  userData が公開リポジトリを `git clone` するため、**本作業の一部として commit + push が必要**
- ローカルツール: AWS CLI v2、CDK CLI v2 (2.1139.0) インストール済み

### 2.2 既存サブグラフ構成（変更しない）

- `graph-node/docker-compose.yaml`: `graphprotocol/graph-node:v0.27.0` + `ipfs/go-ipfs:v0.10.0` + `postgres`(版指定なし)
  - graph-node 環境変数: `ethereum: 'testnet:https://testnet.hashio.io/api'`、`GRAPH_ETHEREUM_GENESIS_BLOCK_NUMBER: 1`
  - ポート: graph-node `8000/8001/8020/8030/8040`、ipfs `5001`、postgres `5432` をすべてホストに公開
  - データ永続化: `./data/ipfs`、`./data/postgres` の bind mount
- `package.json` (pnpm) スクリプト:
  - `compile` = `mustache config/testnet.json subgraph.template.yaml > subgraph.yaml && graph codegen && graph build`
  - `create-local` = `graph create --node http://localhost:8020/ MyToken`
  - `deploy-local` = `graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 MyToken`
- クエリ URL: `http://<host>:8000/subgraphs/name/MyToken`
- graph-node はデプロイ状態を Postgres に保持するため、再起動後は `docker compose up` のみで復帰する
  （`create` / `deploy` は初回のみ必要）

### 2.3 CDK 上の制約

- Lightsail は CDK では L1 のみ。ユーザー判断で **EC2 (L2 `aws-cdk-lib/aws-ec2` `Instance`)** を採用
- Elastic IP は L2 なし → `CfnEIP` + `CfnEIPAssociation` (L1) を使う
- `ec2.Vpc.fromLookup` を使うためスタックに `env`（account/region）が必要。`cdk.context.json` をコミットする
- SSM Session Manager: `AmazonSSMManagedInstanceCore` マネージドポリシー + Canonical Ubuntu AMI 同梱の
  `amazon-ssm-agent`（snap）+ アウトバウンド 443（デフォルト SG で許可済み）で成立。SSH 鍵・22番は不要

## 3. アーキテクチャ

```
インターネット
   │  TCP 8000 のみ
   ▼
┌───────────────────────── デフォルト VPC / パブリックサブネット ──────────────────────┐
│  [Security Group]  inbound: 8000/tcp ← 0.0.0.0/0     (SSH なし)                      │
│         │                          outbound: all (default)                          │
│         ▼                                                                            │
│  [EC2  t3.medium / Ubuntu 24.04 LTS / gp3 30GB / IMDSv2 必須]  ── [Elastic IP]       │
│         │  userData (cloud-init, 初回起動時のみ)                                      │
│         │    1. apt: docker-ce + docker-compose-plugin, Node 20 (nodesource), pnpm   │
│         │    2. git clone https://github.com/mashharuki/hedra-sample.git /opt/app    │
│         │    3. bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh        │
│         │         - docker compose -f deploy/docker-compose.prod.yaml up -d          │
│         │         - wait: localhost:8020 が listen するまで                          │
│         │         - pnpm install && pnpm compile                                     │
│         │         - graph create + graph deploy (--version-label 指定, 非対話)       │
│         │         - sentinel: /opt/app/.subgraph-deployed を作成                      │
│         ▼                                                                            │
│  [IAM Role]  AmazonSSMManagedInstanceCore                                            │
└─────────────────────────────────────────────────────────────────────────────────────┘

コンテナ (deploy/docker-compose.prod.yaml, すべて restart: unless-stopped):
   graph-node : 0.0.0.0:8000→8000, 127.0.0.1:{8001,8020,8030,8040}
   ipfs       : 127.0.0.1:5001
   postgres   : 127.0.0.1:5432
```

### 3.1 スタック構成要素（`infra/lib/hedera-subgraph-stack.ts`）

| 要素 | 内容 |
|---|---|
| VPC | `ec2.Vpc.fromLookup({ isDefault: true })` |
| SecurityGroup | `allowAllOutbound: true`。ingress `tcp/8000` from `ec2.Peer.anyIpv4()`。任意で context `allowedSshCidr` があれば `tcp/22` を追加 |
| IAM Role | `iam.Role`（`ec2.amazonaws.com`）+ `AmazonSSMManagedInstanceCore` |
| AMI | `ec2.MachineImage.fromSsmParameter('/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id', { os: LINUX })` |
| Instance | `ec2.Instance`：`t3.medium`、`vpcSubnets: { subnetType: PUBLIC }`、`blockDevices` で `/dev/sda1` gp3 30GB、`requireImdsv2: true`、`userData` |
| Elastic IP | `CfnEIP` + `CfnEIPAssociation`（`instanceId` に関連付け） |
| Outputs | `GraphqlUrl` = `http://<eip.ref>:8000/subgraphs/name/MyToken`、`InstanceId`、`ElasticIp`、`SsmStartSessionCommand` = `aws ssm start-session --target <id>` |

### 3.2 パラメータ（context / 環境変数、すべて既定値あり）

| 名前 | 既定値 | 用途 |
|---|---|---|
| account / region | `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`（未設定時 `ap-northeast-1`） | デプロイ先 |
| `repoUrl` | `https://github.com/mashharuki/hedra-sample.git` | userData の clone 元 |
| `repoBranch` | `main` | clone するブランチ |
| `instanceType` | `t3.medium` | EC2 サイズ |
| `allowedSshCidr` | なし（未指定なら 22 番を開けない） | 緊急 SSH 用の許可 CIDR |

### 3.3 `deploy/docker-compose.prod.yaml`

`graph-node/docker-compose.yaml` をベースにした**独立した完結ファイル**（override ではなく単体で使う）:

- `graph-node`: `ports` を `["8000:8000", "127.0.0.1:8001:8001", "127.0.0.1:8020:8020", "127.0.0.1:8030:8030", "127.0.0.1:8040:8040"]`
- `ipfs`: `ports` を `["127.0.0.1:5001:5001"]`
- `postgres`: `ports` を `["127.0.0.1:5432:5432"]`、イメージを `postgres:15` に固定
  （※graph-node v0.27.0 と PG 17/18 の相性リスク回避。問題時はローカルで動いた版に合わせる）
- 全サービスに `restart: unless-stopped`
- `ethereum` の RPC は `testnet:${GRAPH_ETHEREUM_RPC:-https://testnet.hashio.io/api}` として `.env` で上書き可能に
- データ bind mount（`./data/...`）はそのまま。実体は `/opt/app/hedera-subgraph-example/data/`

### 3.4 `deploy/ec2-bootstrap.sh`

```
#!/usr/bin/env bash
set -euxo pipefail
APP_DIR=/opt/app/hedera-subgraph-example
SENTINEL=/opt/app/.subgraph-deployed
cd "$APP_DIR"

docker compose -f deploy/docker-compose.prod.yaml up -d

# graph-node admin (8020) が立ち上がるまで待つ
for i in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:8020/" && break || true
  # 8020 は JSON-RPC。405/エラーでも「接続できる」ことを確認できればよい
  nc -z localhost 8020 && break || sleep 5
done

if [ ! -f "$SENTINEL" ]; then
  corepack disable || true
  npm install -g pnpm
  pnpm install --frozen-lockfile
  pnpm compile
  pnpm exec graph create --node http://localhost:8020/ MyToken || true
  pnpm exec graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 \
    --version-label v0.0.1 MyToken
  touch "$SENTINEL"
fi
```

（正確なコマンド・待機ロジック・エラーハンドリングは実装プランで詰める）

### 3.5 userData（`infra/lib/user-data.ts`）

- `ec2.UserData.forLinux()` に以下を `addCommands`:
  1. `apt-get update` → `ca-certificates curl git jq netcat-openbsd`
  2. Docker 公式 apt リポジトリ登録 → `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`、`systemctl enable --now docker`
  3. nodesource で Node 20 → `nodejs`
  4. `git clone --branch <repoBranch> --depth 1 <repoUrl> /opt/app`
  5. `bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh 2>&1 | tee /var/log/subgraph-bootstrap.log`
- userData は薄く保ち、ロジックは `ec2-bootstrap.sh` に寄せる

## 4. ファイル変更一覧

| パス | 種別 | 備考 |
|---|---|---|
| `hedera-subgraph-example/infra/bin/infra.ts` | 新規 | CDK アプリエントリ。`env` 解決、context 読み取り |
| `hedera-subgraph-example/infra/lib/hedera-subgraph-stack.ts` | 新規 | スタック本体 |
| `hedera-subgraph-example/infra/lib/user-data.ts` | 新規 | userData 生成関数 |
| `hedera-subgraph-example/infra/package.json` | 新規 | `aws-cdk-lib`, `constructs`, `aws-cdk`, `tsx`, `typescript`, `@types/node`。pnpm |
| `hedera-subgraph-example/infra/tsconfig.json` | 新規 | CDK 標準設定 |
| `hedera-subgraph-example/infra/cdk.json` | 新規 | `"app": "npx tsx bin/infra.ts"` |
| `hedera-subgraph-example/infra/.gitignore` | 新規 | `node_modules/`, `cdk.out/`, `*.js`, `*.d.ts` |
| `hedera-subgraph-example/infra/cdk.context.json` | 新規(生成) | VPC ルックアップ結果。コミットする |
| `hedera-subgraph-example/infra/README.md` | 新規 | `cdk bootstrap` → `cdk deploy` → 確認 → `cdk destroy` |
| `hedera-subgraph-example/deploy/docker-compose.prod.yaml` | 新規 | §3.3 |
| `hedera-subgraph-example/deploy/ec2-bootstrap.sh` | 新規 | §3.4。実行ビット付与 |
| `hedera-subgraph-example/README.md` | 変更 | 「AWS デプロイは `infra/README.md`」の節を追加 |
| `README.md`（ルート） | 変更 | 必要なら 1 行の導線 |
| （リポジトリ） | 変更 | サブグラフ + infra 一式を commit + push（userData の clone 対象） |

## 5. デプロイ / 運用フロー（`infra/README.md` に記載）

1. `cd hedera-subgraph-example/infra && pnpm install`
2. `export CDK_DEFAULT_ACCOUNT=... CDK_DEFAULT_REGION=ap-northeast-1`（or AWS プロファイル）
3. 初回のみ `pnpm exec cdk bootstrap`
4. `pnpm exec cdk deploy`
5. 出力 `GraphqlUrl` を控える。5〜15 分（初回同期の進み方次第）待って
   `curl <GraphqlUrl>` で `{ data: ... }` が返ることを確認
6. ログ確認: `aws ssm start-session --target <InstanceId>` →
   `tail -f /var/log/subgraph-bootstrap.log`、`docker compose ... logs -f graph-node`
7. 撤去: `pnpm exec cdk destroy`

## 6. リスクと対策

| リスク | 対策 |
|---|---|
| Hashio のレート制限で初回バックフィル(startBlock 39895777〜)が遅い/失敗 | README に明記。必要なら `config/testnet.json` の `startBlock` を引き上げて再 `compile`/`deploy`、または `.env` で専用 RPC に差し替え |
| graph-node v0.27.0 と postgres の版ズレ | `postgres:15` に固定。問題時はローカルの `docker inspect` の版に合わせる |
| userData 失敗時に気づきにくい | `ec2-bootstrap.sh` の出力を `/var/log/subgraph-bootstrap.log` に保存。SSM で確認する手順を README に |
| `git clone` するのでサブグラフを push 必須 | 実装プランの最初のステップで commit + push を実施 |
| `graph deploy` の対話プロンプト（version label） | `--version-label v0.0.1` を明示して非対話化 |
| 8000 番を全開放 | クエリ専用ポートのみ。管理系(8020 等)は 127.0.0.1 バインドで多層防御 |
| EIP の解放漏れ課金 | `cdk destroy` で association ごと削除。README に明記 |

## 7. テスト / 検証

- `cd infra && pnpm exec cdk synth` がエラーなく CloudFormation を生成する
- `pnpm exec tsc --noEmit` が通る
- （任意・実費）`cdk deploy` 後に `GraphqlUrl` へ introspection クエリを投げて
  `Collection` / `Token` / `Transfer` が引けることを手動確認
- `ec2-bootstrap.sh` を `bash -n`（構文チェック）
