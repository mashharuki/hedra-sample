# Hedera サブグラフ CDK (EC2) デプロイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hedera-subgraph-example` を AWS CDK (TypeScript) で EC2 上に 1 コマンドでデプロイし、`http://<Elastic IP>:8000/subgraphs/name/MyToken` で MyToken (ERC-721) サブグラフを公開できるようにする。

**Architecture:** `hedera-subgraph-example/infra/` に独立した CDK プロジェクトを追加。単一スタック `HederaSubgraphStack` がデフォルト VPC のパブリックサブネットに EC2 (`t3.medium` / Ubuntu 24.04) を 1 台立て、Security Group で 8000/tcp のみ開放、IAM Role で SSM Session Manager 接続を可能にし、Elastic IP を関連付ける。EC2 の userData は薄いブートストラップに徹し、実処理（Docker/Node 導入、リポジトリ clone、`docker compose up`、サブグラフの `create`/`deploy`）はリポジトリ内の `deploy/ec2-bootstrap.sh` に集約する。

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib` 2.267.x) / TypeScript / pnpm / Vitest + `aws-cdk-lib/assertions` / Docker Compose / The Graph (`@graphprotocol/graph-cli`) / Hedera Testnet (Hashio JSON-RPC)

**Spec:** `docs/superpowers/specs/2026-09-02-hedera-subgraph-cdk-deploy-design.md`

## Global Constraints

- 作業ディレクトリは基本 `hedera-subgraph-example/infra/`。既存の `graph-node/docker-compose.yaml` と `src/`・`schema.graphql`・`subgraph.template.yaml` は変更しない。
- `infra/` はパッケージマネージャに **pnpm** を使う（親 `hedera-subgraph-example` と同じ）。`infra/pnpm-workspace.yaml` は **設定専用**（`allowBuilds: { esbuild: true }` のみ、`packages:` キーは書かない）で置いてよい — pnpm 11.24 がビルドスクリプト承認をこのファイルでしか記録しないため。sibling パッケージを取り込む workspace 宣言には使わない。
- CDK ライブラリ: `aws-cdk-lib@^2.267.0`、`constructs@^10.8.1`。CLI は devDependency `aws-cdk@^2.1139.0`（グローバル CDK に依存しない）。
- 既定リージョンは `ap-northeast-1`。`env` は `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` を優先し、region 未設定時のみ `ap-northeast-1` にフォールバック。
- EC2 は必ず `requireImdsv2: true`。Security Group の inbound は 8000/tcp のみ（`allowedSshCidr` context 指定時のみ 22/tcp を追加）。IAM は `AmazonSSMManagedInstanceCore` のみ。
- userData の clone 元は context `repoUrl`（既定 `https://github.com/mashharuki/hedra-sample.git`）、`repoBranch`（既定 `main`）。
- サブグラフのクエリ URL・スラッグは既存の `package.json` に合わせ `MyToken`（`http://<host>:8000/subgraphs/name/MyToken`）。
- `graph deploy` は必ず `--version-label v0.0.1` を付けて非対話実行する。
- コミットはタスクごと。コミットメッセージ末尾に以下を付す:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GPFhdVZPAQGmT6cT7NufRA
  ```

---

## ファイル構成

| パス | 責務 |
|---|---|
| `hedera-subgraph-example/infra/package.json` | CDK プロジェクトの依存とスクリプト（`cdk` / `test` / `synth`） |
| `hedera-subgraph-example/infra/pnpm-workspace.yaml` | pnpm 11 設定専用（`allowBuilds: { esbuild: true }`）。`packages:` は書かない |
| `hedera-subgraph-example/infra/tsconfig.json` | TypeScript コンパイラ設定 |
| `hedera-subgraph-example/infra/cdk.json` | CDK アプリ起動コマンド（`npx tsx bin/infra.ts`）と feature flags |
| `hedera-subgraph-example/infra/.gitignore` | `node_modules/` `cdk.out/` `*.js` `*.d.ts` を無視 |
| `hedera-subgraph-example/infra/bin/infra.ts` | CDK アプリのエントリ。`env` と context を解決してスタックを 1 つ生成 |
| `hedera-subgraph-example/infra/lib/hedera-subgraph-stack.ts` | スタック本体。VPC ルックアップ / SG / IAM Role / EC2 Instance / Elastic IP / Outputs |
| `hedera-subgraph-example/infra/lib/user-data.ts` | `ec2.UserData` を組み立てる純関数 `buildUserData()` |
| `hedera-subgraph-example/infra/test/hedera-subgraph-stack.test.ts` | `Template.fromStack` によるスタックのアサーションテスト |
| `hedera-subgraph-example/infra/test/user-data.test.ts` | `buildUserData()` の文字列内容テスト |
| `hedera-subgraph-example/infra/cdk.context.json` | `cdk deploy` 実行時に生成される VPC ルックアップ結果（生成後コミット） |
| `hedera-subgraph-example/infra/README.md` | bootstrap → deploy → 確認 → destroy の手順書 |
| `hedera-subgraph-example/deploy/docker-compose.prod.yaml` | 本番用 compose（8000 のみ公開、管理ポートは 127.0.0.1、`restart: unless-stopped`、`name: hedera-subgraph`） |
| `hedera-subgraph-example/deploy/ec2-bootstrap.sh` | userData から実行。compose 起動 → graph-node 待機 → 初回のみ `pnpm compile` + `graph create/deploy` |
| `hedera-subgraph-example/README.md` | 「AWS デプロイは `infra/README.md`」の節を追記（変更） |

---

## Task 1: CDK プロジェクトのスキャフォールド

**Files:**
- Create: `hedera-subgraph-example/infra/package.json`
- Create: `hedera-subgraph-example/infra/tsconfig.json`
- Create: `hedera-subgraph-example/infra/cdk.json`
- Create: `hedera-subgraph-example/infra/.gitignore`
- Create: `hedera-subgraph-example/infra/bin/infra.ts`
- Create: `hedera-subgraph-example/infra/lib/hedera-subgraph-stack.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `HederaSubgraphStack` class（`lib/hedera-subgraph-stack.ts`）— constructor `(scope: Construct, id: string, props: HederaSubgraphStackProps)`
  - `interface HederaSubgraphStackProps extends cdk.StackProps { repoUrl: string; repoBranch: string; instanceType: string; allowedSshCidr?: string; }`
  - この Task 時点では `HederaSubgraphStack` は空（リソースなし）。以降の Task で中身を実装する。

- [ ] **Step 1: `infra/package.json` を作成**

```json
{
  "name": "hedera-subgraph-infra",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "cdk": "cdk",
    "synth": "cdk synth",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "aws-cdk": "^2.1139.0",
    "aws-cdk-lib": "^2.267.0",
    "constructs": "^10.8.1",
    "tsx": "^4.23.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: `infra/tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "cdk.out"]
}
```

- [ ] **Step 3: `infra/cdk.json` を作成**

```json
{
  "app": "npx tsx bin/infra.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "node_modules", "test", "cdk.out"]
  },
  "context": {
    "@aws-cdk/aws-ec2:launchTemplateDefaultUserData": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/core:validateSnapshotRemovalPolicy": true
  }
}
```

- [ ] **Step 4: `infra/.gitignore` を作成**

```gitignore
node_modules/
cdk.out/
*.js
*.d.ts
!bin/**/*.d.ts
.env
```

- [ ] **Step 5: `infra/lib/hedera-subgraph-stack.ts` を作成（この時点では空スタック）**

```ts
import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface HederaSubgraphStackProps extends cdk.StackProps {
  /** userData が clone する Git リポジトリ URL */
  readonly repoUrl: string;
  /** clone するブランチ */
  readonly repoBranch: string;
  /** EC2 インスタンスタイプ（例: "t3.medium"） */
  readonly instanceType: string;
  /** 指定時のみ 22/tcp をこの CIDR に対して開放する */
  readonly allowedSshCidr?: string;
}

export class HederaSubgraphStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HederaSubgraphStackProps) {
    super(scope, id, props);
    // リソースは後続タスクで実装する
    void props;
  }
}
```

- [ ] **Step 6: `infra/bin/infra.ts` を作成**

```ts
import * as cdk from "aws-cdk-lib";
import { HederaSubgraphStack } from "../lib/hedera-subgraph-stack.js";

const app = new cdk.App();

const repoUrl =
  app.node.tryGetContext("repoUrl") ??
  "https://github.com/mashharuki/hedra-sample.git";
const repoBranch = app.node.tryGetContext("repoBranch") ?? "main";
const instanceType = app.node.tryGetContext("instanceType") ?? "t3.medium";
const allowedSshCidr = app.node.tryGetContext("allowedSshCidr") ?? undefined;

new HederaSubgraphStack(app, "HederaSubgraphStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
  description: "Hedera MyToken (ERC-721) subgraph on a single EC2 host",
  repoUrl,
  repoBranch,
  instanceType,
  allowedSshCidr,
});
```

- [ ] **Step 7: 依存をインストール**

Run: `cd hedera-subgraph-example/infra && pnpm install`
Expected: `node_modules/` が作られ、`pnpm-lock.yaml` が生成される。エラーなし。

- [ ] **Step 8: 型チェックと synth を実行**

Run: `cd hedera-subgraph-example/infra && pnpm typecheck && pnpm exec cdk synth --quiet`
Expected: `tsc` エラーなし。`cdk synth` が `HederaSubgraphStack` を出力（この時点ではリソースなし）してエラーなく終了。
（この Task のスタックは VPC ルックアップを含まないため AWS 認証情報なしで synth 可能）

- [ ] **Step 9: コミット**

```bash
cd hedera-subgraph-example/infra
git add package.json pnpm-lock.yaml tsconfig.json cdk.json .gitignore bin/infra.ts lib/hedera-subgraph-stack.ts
git commit -m "Scaffold CDK project for Hedera subgraph EC2 deploy"
```

---

## Task 2: スタックのネットワーク / IAM / EC2 インスタンス

**Files:**
- Modify: `hedera-subgraph-example/infra/lib/hedera-subgraph-stack.ts`
- Create: `hedera-subgraph-example/infra/test/hedera-subgraph-stack.test.ts`

**Interfaces:**
- Consumes: `HederaSubgraphStack` / `HederaSubgraphStackProps`（Task 1）
- Produces:
  - スタックが以下を含むようになる: `ec2.SecurityGroup`（ingress 8000/tcp from anyIpv4、`allowedSshCidr` 指定時のみ 22/tcp）、`iam.Role`（`AmazonSSMManagedInstanceCore`）、`ec2.Instance`（`t3.medium`、Ubuntu 24.04、gp3 30GB、IMDSv2 必須、public subnet）。
  - `this.instance: ec2.Instance` を `public readonly` で公開（Task 3 が EIP 関連付けに使う）。
  - userData はこの Task では空のまま（Task 3 で `buildUserData()` を接続）。

- [ ] **Step 1: 失敗するテストを書く**（`test/hedera-subgraph-stack.test.ts`）

```ts
import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { HederaSubgraphStack } from "../lib/hedera-subgraph-stack.js";

/** テスト用にスタックを合成して Template を返す。
 *  env を具体値にすることで Vpc.fromLookup がダミー VPC を返し、context ファイル不要で動く。 */
function synth(props: { allowedSshCidr?: string } = {}) {
  const app = new cdk.App();
  const stack = new HederaSubgraphStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    repoUrl: "https://github.com/example/repo.git",
    repoBranch: "main",
    instanceType: "t3.medium",
    allowedSshCidr: props.allowedSshCidr,
  });
  return Template.fromStack(stack);
}

/** Instance か LaunchTemplate のどちらに MetadataOptions が乗っても拾えるようにする */
function hasImdsv2Required(t: Template): boolean {
  const json = JSON.stringify(t.toJSON());
  return json.includes('"HttpTokens":"required"');
}

describe("HederaSubgraphStack networking & compute", () => {
  it("opens only port 8000 to the world by default", () => {
    const t = synth();
    t.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: "0.0.0.0/0",
          FromPort: 8000,
          ToPort: 8000,
          IpProtocol: "tcp",
        }),
      ]),
    });
  });

  it("does NOT open port 22 unless allowedSshCidr is set", () => {
    const t = synth();
    const sgs = t.findResources("AWS::EC2::SecurityGroup");
    const ingress = Object.values(sgs).flatMap(
      (r) => r.Properties?.SecurityGroupIngress ?? [],
    );
    expect(ingress.some((i: { FromPort?: number }) => i.FromPort === 22)).toBe(
      false,
    );
  });

  it("opens port 22 to the given CIDR when allowedSshCidr is set", () => {
    const t = synth({ allowedSshCidr: "203.0.113.4/32" });
    t.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ CidrIp: "203.0.113.4/32", FromPort: 22, ToPort: 22 }),
      ]),
    });
  });

  it("runs a t3.medium with a 30GB gp3 root volume", () => {
    const t = synth();
    t.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: "t3.medium",
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({
          DeviceName: "/dev/sda1",
          Ebs: Match.objectLike({ VolumeSize: 30, VolumeType: "gp3" }),
        }),
      ]),
    });
  });

  it("requires IMDSv2", () => {
    expect(hasImdsv2Required(synth())).toBe(true);
  });

  it("attaches only AmazonSSMManagedInstanceCore to the instance role", () => {
    const t = synth();
    const roles = JSON.stringify(t.findResources("AWS::IAM::Role"));
    expect(roles).toContain("AmazonSSMManagedInstanceCore");
    expect(roles).not.toContain("AdministratorAccess");
    expect(roles).not.toContain("PowerUserAccess");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd hedera-subgraph-example/infra && pnpm test`
Expected: FAIL（スタックがまだリソースを作らないため「resource of type ... not found」等）

- [ ] **Step 3: スタック本体を実装**（`lib/hedera-subgraph-stack.ts` を全面書き換え）

```ts
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface HederaSubgraphStackProps extends cdk.StackProps {
  readonly repoUrl: string;
  readonly repoBranch: string;
  readonly instanceType: string;
  readonly allowedSshCidr?: string;
}

export class HederaSubgraphStack extends cdk.Stack {
  public readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: HederaSubgraphStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    const securityGroup = new ec2.SecurityGroup(this, "SubgraphSg", {
      vpc,
      description: "Hedera subgraph host - GraphQL query port only",
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8000),
      "GraphQL query endpoint",
    );
    if (props.allowedSshCidr) {
      securityGroup.addIngressRule(
        ec2.Peer.ipv4(props.allowedSshCidr),
        ec2.Port.tcp(22),
        "Emergency SSH",
      );
    }

    const role = new iam.Role(this, "SubgraphInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    const machineImage = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
      { os: ec2.OperatingSystemType.LINUX },
    );

    this.instance = new ec2.Instance(this, "SubgraphHost", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage,
      securityGroup,
      role,
      requireImdsv2: true,
      associatePublicIpAddress: true,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `cd hedera-subgraph-example/infra && pnpm test`
Expected: PASS（この describe の 6 テストすべて緑）

備考: `ec2.Vpc.fromLookup` は context 未解決時にダミー VPC (`vpc-12345`) を返すため、テストは context ファイルなしで動く。

- [ ] **Step 5: 型チェック**

Run: `cd hedera-subgraph-example/infra && pnpm typecheck`
Expected: エラーなし。

（`cdk synth` はここから先 `Vpc.fromLookup` のため AWS 認証情報が必要。認証情報がある場合のみ
`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` を CLI が補完して synth 可能。検証の主軸は `pnpm test`。）

- [ ] **Step 6: コミット**

```bash
cd hedera-subgraph-example/infra
git add lib/hedera-subgraph-stack.ts test/hedera-subgraph-stack.test.ts
git commit -m "Add SG, IAM role and EC2 instance to subgraph stack"
```

---

## Task 3: userData ビルダー、Elastic IP、Outputs

**Files:**
- Create: `hedera-subgraph-example/infra/lib/user-data.ts`
- Create: `hedera-subgraph-example/infra/test/user-data.test.ts`
- Modify: `hedera-subgraph-example/infra/lib/hedera-subgraph-stack.ts`
- Modify: `hedera-subgraph-example/infra/test/hedera-subgraph-stack.test.ts`

**Interfaces:**
- Consumes: `HederaSubgraphStack`（`this.instance`）、`HederaSubgraphStackProps`（`repoUrl` / `repoBranch`）
- Produces:
  - `buildUserData(opts: { repoUrl: string; repoBranch: string }): ec2.UserData`（`lib/user-data.ts`）
  - スタックに `ec2.CfnEIP` + `ec2.CfnEIPAssociation`（`instanceId` に関連付け）
  - スタックに `CfnOutput`: `GraphqlUrl` / `ElasticIp` / `InstanceId` / `SsmStartSessionCommand`
  - EC2 インスタンスの userData が `buildUserData()` の内容になる

- [ ] **Step 1: `buildUserData()` の失敗テストを書く**（`test/user-data.test.ts`）

```ts
import { describe, expect, it } from "vitest";
import { buildUserData } from "../lib/user-data.js";

describe("buildUserData", () => {
  const script = buildUserData({
    repoUrl: "https://github.com/example/repo.git",
    repoBranch: "main",
  }).render();

  it("starts with a bash shebang", () => {
    expect(script.startsWith("#!/bin/bash")).toBe(true);
  });

  it("installs docker and node, then clones the given repo/branch", () => {
    expect(script).toContain("docker-compose-plugin");
    expect(script).toContain("setup_20.x");
    expect(script).toContain(
      "git clone --branch main --depth 1 https://github.com/example/repo.git /opt/app",
    );
  });

  it("delegates real work to ec2-bootstrap.sh", () => {
    expect(script).toContain(
      "bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh",
    );
  });

  it("captures output to a log file", () => {
    expect(script).toContain("/var/log/subgraph-userdata.log");
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd hedera-subgraph-example/infra && pnpm test user-data`
Expected: FAIL（`Cannot find module '../lib/user-data.js'`）

- [ ] **Step 3: `lib/user-data.ts` を実装**

```ts
import * as ec2 from "aws-cdk-lib/aws-ec2";

export interface UserDataOptions {
  readonly repoUrl: string;
  readonly repoBranch: string;
}

/**
 * EC2 の cloud-init 用スクリプトを組み立てる。
 * 実処理は clone 後の deploy/ec2-bootstrap.sh に委譲し、ここは環境準備のみ。
 */
export function buildUserData(opts: UserDataOptions): ec2.UserData {
  const ud = ec2.UserData.forLinux();
  ud.addCommands(
    "set -euxo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "exec > >(tee -a /var/log/subgraph-userdata.log) 2>&1",
    "apt-get update -y",
    "apt-get install -y ca-certificates curl git jq netcat-openbsd",
    // Docker 公式リポジトリ（コードネームは一旦変数に取り、ネストクォートを避ける）
    "install -m 0755 -d /etc/apt/keyrings",
    "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
    "chmod a+r /etc/apt/keyrings/docker.asc",
    'UBUNTU_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")',
    'DEB_ARCH=$(dpkg --print-architecture)',
    'echo "deb [arch=${DEB_ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" > /etc/apt/sources.list.d/docker.list',
    "apt-get update -y",
    "apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
    "systemctl enable --now docker",
    // Node.js 20
    "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
    "apt-get install -y nodejs",
    "npm install -g pnpm@10",
    // アプリ取得
    `git clone --branch ${opts.repoBranch} --depth 1 ${opts.repoUrl} /opt/app`,
    "chmod +x /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh",
    "bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh",
  );
  return ud;
}
```

- [ ] **Step 4: テスト実行 → 通過確認**

Run: `cd hedera-subgraph-example/infra && pnpm test user-data`
Expected: PASS（4 テスト緑）

- [ ] **Step 5: スタックに EIP / Outputs / userData 接続の失敗テストを追加**（`test/hedera-subgraph-stack.test.ts` の `describe` を追加）

```ts
describe("HederaSubgraphStack EIP & outputs", () => {
  it("allocates an Elastic IP and associates it with the instance", () => {
    const t = synth();
    t.resourceCountIs("AWS::EC2::EIP", 1);
    t.hasResourceProperties("AWS::EC2::EIPAssociation", {
      InstanceId: Match.anyValue(),
    });
  });

  it("exports the GraphQL URL and SSM command as outputs", () => {
    const t = synth();
    const keys = Object.keys(t.toJSON().Outputs ?? {});
    expect(keys).toEqual(
      expect.arrayContaining([
        "GraphqlUrl",
        "ElasticIp",
        "InstanceId",
        "SsmStartSessionCommand",
      ]),
    );
  });

  it("bakes the bootstrap script call into the rendered user data", () => {
    // userData は Instance か LaunchTemplate のどちらに乗るかが feature flag で変わるが、
    // Fn::Base64(Fn::Join(...)) の中身は平文でテンプレート JSON に現れるので位置非依存で検証する。
    const json = JSON.stringify(synth().toJSON());
    expect(json).toContain(
      "bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh",
    );
  });
});
```

- [ ] **Step 6: テスト実行 → 失敗確認**

Run: `cd hedera-subgraph-example/infra && pnpm test hedera-subgraph-stack`
Expected: FAIL（`AWS::EC2::EIP` が 0 件、outputs 不足）

- [ ] **Step 7: スタックに EIP / Outputs / userData を実装**（`lib/hedera-subgraph-stack.ts` を編集）

`import` に追加:
```ts
import { buildUserData } from "./user-data.js";
```

`machineImage` 宣言の直後に `userData` を作り、`this.instance = new ec2.Instance(...)` を
以下の完全な形に置き換える（`userData` と `userDataCausesReplacement` の 2 行が増えるだけ、他は Task 2 と同一）:
```ts
    const userData = buildUserData({
      repoUrl: props.repoUrl,
      repoBranch: props.repoBranch,
    });

    this.instance = new ec2.Instance(this, "SubgraphHost", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage,
      securityGroup,
      role,
      requireImdsv2: true,
      associatePublicIpAddress: true,
      userData,
      userDataCausesReplacement: true,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });
```

constructor 末尾（instance 生成後）に追加:
```ts
    const eip = new ec2.CfnEIP(this, "SubgraphEip", {
      domain: "vpc",
      tags: [{ key: "Name", value: "hedera-subgraph" }],
    });
    new ec2.CfnEIPAssociation(this, "SubgraphEipAssoc", {
      allocationId: eip.attrAllocationId,
      instanceId: this.instance.instanceId,
    });

    new cdk.CfnOutput(this, "ElasticIp", { value: eip.ref });
    new cdk.CfnOutput(this, "InstanceId", { value: this.instance.instanceId });
    new cdk.CfnOutput(this, "GraphqlUrl", {
      value: `http://${eip.ref}:8000/subgraphs/name/MyToken`,
    });
    new cdk.CfnOutput(this, "SsmStartSessionCommand", {
      value: `aws ssm start-session --target ${this.instance.instanceId} --region ${this.region}`,
    });
```

- [ ] **Step 8: 全テスト実行 → 通過確認**

Run: `cd hedera-subgraph-example/infra && pnpm test`
Expected: PASS（Task 2 の 6 + EIP/outputs の 3 + user-data の 4 = 13 テスト緑）

- [ ] **Step 9: 型チェック**

Run: `cd hedera-subgraph-example/infra && pnpm typecheck`
Expected: エラーなし。（AWS 認証情報があれば `pnpm exec cdk synth --quiet` で `AWS::EC2::EIP` と 4 つの Outputs も確認できる）

- [ ] **Step 10: コミット**

```bash
cd hedera-subgraph-example/infra
git add lib/user-data.ts lib/hedera-subgraph-stack.ts test/user-data.test.ts test/hedera-subgraph-stack.test.ts
git commit -m "Add user data bootstrap, Elastic IP and stack outputs"
```

---

## Task 4: 本番用 docker-compose

**Files:**
- Create: `hedera-subgraph-example/deploy/docker-compose.prod.yaml`

**Interfaces:**
- Consumes: なし（既存 `graph-node/docker-compose.yaml` の設定値を踏襲）
- Produces: `deploy/docker-compose.prod.yaml` — サービス `graph-node` / `ipfs` / `postgres`、プロジェクト名 `hedera-subgraph`。`ec2-bootstrap.sh`（Task 5）がこのファイルを `-f` で使う。

- [ ] **Step 1: `deploy/docker-compose.prod.yaml` を作成**

```yaml
name: hedera-subgraph

services:
  graph-node:
    image: graphprotocol/graph-node:v0.27.0
    restart: unless-stopped
    ports:
      - '8000:8000'
      - '127.0.0.1:8001:8001'
      - '127.0.0.1:8020:8020'
      - '127.0.0.1:8030:8030'
      - '127.0.0.1:8040:8040'
    depends_on:
      - ipfs
      - postgres
    extra_hosts:
      - host.docker.internal:host-gateway
    environment:
      postgres_host: postgres
      postgres_user: 'graph-node'
      postgres_pass: 'let-me-in'
      postgres_db: 'graph-node'
      ipfs: 'ipfs:5001'
      ethereum: 'testnet:${GRAPH_ETHEREUM_RPC:-https://testnet.hashio.io/api}'
      GRAPH_LOG: info
      GRAPH_ETHEREUM_GENESIS_BLOCK_NUMBER: '1'

  ipfs:
    image: ipfs/go-ipfs:v0.10.0
    restart: unless-stopped
    ports:
      - '127.0.0.1:5001:5001'
    volumes:
      - ./data/ipfs:/data/ipfs

  postgres:
    image: postgres
    restart: unless-stopped
    ports:
      - '127.0.0.1:5432:5432'
    command:
      - 'postgres'
      - '-cshared_preload_libraries=pg_stat_statements'
    environment:
      POSTGRES_USER: 'graph-node'
      POSTGRES_PASSWORD: 'let-me-in'
      POSTGRES_DB: 'graph-node'
      PGDATA: '/data/postgres'
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
```

- [ ] **Step 2: compose ファイルの構文を検証**

Run: `cd hedera-subgraph-example && docker compose -f deploy/docker-compose.prod.yaml config >/dev/null && echo OK`
Expected: `OK`（`docker` が無い環境なら `docker compose version` が無いことを記録し、Step 3 の grep 検証のみで代替）

- [ ] **Step 3: 管理ポートが localhost 限定であることを検証**

Run:
```bash
cd hedera-subgraph-example
grep -E "127\.0\.0\.1:(8001|8020|8030|8040|5001|5432)" deploy/docker-compose.prod.yaml | wc -l
grep -E "^\s+- '8000:8000'" deploy/docker-compose.prod.yaml
```
Expected: 1 行目は `6`、2 行目は `- '8000:8000'` がマッチ（8000 のみ全公開）。

- [ ] **Step 4: コミット**

```bash
cd hedera-subgraph-example
git add deploy/docker-compose.prod.yaml
git commit -m "Add production docker-compose with localhost-only admin ports"
```

---

## Task 5: EC2 ブートストラップスクリプト

**Files:**
- Create: `hedera-subgraph-example/deploy/ec2-bootstrap.sh`

**Interfaces:**
- Consumes: `deploy/docker-compose.prod.yaml`（Task 4）、既存 `package.json` の `compile` スクリプトと `MyToken` スラッグ
- Produces: `deploy/ec2-bootstrap.sh`（実行ビット付き）— userData（Task 3）が `bash` で呼ぶ。冪等（sentinel `/opt/app/.subgraph-deployed`）。

- [ ] **Step 1: `deploy/ec2-bootstrap.sh` を作成**

```bash
#!/usr/bin/env bash
# EC2 上でサブグラフスタックを起動し、初回のみビルド&デプロイする。
# userData から呼ばれる。再実行しても安全（sentinel でガード）。
set -euxo pipefail

APP_DIR=/opt/app/hedera-subgraph-example
COMPOSE_FILE="${APP_DIR}/deploy/docker-compose.prod.yaml"
SENTINEL=/opt/app/.subgraph-deployed
LOG=/var/log/subgraph-bootstrap.log

exec > >(tee -a "${LOG}") 2>&1
cd "${APP_DIR}"

echo "[bootstrap] starting compose stack"
docker compose -f "${COMPOSE_FILE}" up -d

echo "[bootstrap] waiting for graph-node admin endpoint on :8020 (up to 10 min for first-boot image pulls)"
admin_up=false
for i in $(seq 1 120); do
  if nc -z localhost 8020; then
    echo "[bootstrap] graph-node admin is reachable"
    admin_up=true
    break
  fi
  echo "[bootstrap] waiting... (${i}/120)"
  sleep 5
done
if [ "${admin_up}" != "true" ]; then
  echo "[bootstrap] WARNING: graph-node admin not reachable after 10 min; attempting deploy anyway"
fi

if [ -f "${SENTINEL}" ]; then
  echo "[bootstrap] sentinel present; subgraph already deployed. Done."
  exit 0
fi

echo "[bootstrap] installing subgraph toolchain deps"
export PNPM_HOME=/root/.local/share/pnpm
export PATH="${PNPM_HOME}:${PATH}"
pnpm install --frozen-lockfile

echo "[bootstrap] compiling subgraph (mustache + graph codegen + graph build)"
pnpm compile

echo "[bootstrap] creating subgraph on the local node"
pnpm exec graph create --node http://localhost:8020/ MyToken || true

echo "[bootstrap] deploying subgraph"
pnpm exec graph deploy \
  --node http://localhost:8020/ \
  --ipfs http://localhost:5001 \
  --version-label v0.0.1 \
  MyToken

touch "${SENTINEL}"
echo "[bootstrap] done. Query at http://<elastic-ip>:8000/subgraphs/name/MyToken"
```

- [ ] **Step 2: 実行ビットを付与**

Run: `chmod +x hedera-subgraph-example/deploy/ec2-bootstrap.sh`

- [ ] **Step 3: シェル構文チェック**

Run: `bash -n hedera-subgraph-example/deploy/ec2-bootstrap.sh && echo "syntax OK"`
Expected: `syntax OK`
（`shellcheck` が使えるなら `shellcheck hedera-subgraph-example/deploy/ec2-bootstrap.sh` も実行。SC2086 等の軽微な指摘は許容、エラーレベルの指摘のみ修正）

- [ ] **Step 4: userData テストとの整合を確認**

Run: `cd hedera-subgraph-example/infra && pnpm test user-data`
Expected: PASS（`bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh` を参照するテストが引き続き緑）

- [ ] **Step 5: 実行ビットが git に記録されることを確認してコミット**

```bash
cd hedera-subgraph-example
git add deploy/ec2-bootstrap.sh
git update-index --chmod=+x deploy/ec2-bootstrap.sh
git commit -m "Add idempotent EC2 bootstrap script for subgraph deploy"
```

---

## Task 6: ドキュメントと push

**Files:**
- Create: `hedera-subgraph-example/infra/README.md`
- Modify: `hedera-subgraph-example/README.md`

**Interfaces:**
- Consumes: これまでの全 Task の成果物
- Produces: デプロイ手順書。`git push` により userData が clone 可能な状態になる。

- [ ] **Step 1: `infra/README.md` を作成**

````markdown
# infra — Hedera サブグラフを EC2 にデプロイする CDK スタック

`HederaSubgraphStack` は EC2 を 1 台立て、userData で `deploy/docker-compose.prod.yaml`
を起動し、`MyToken`（ERC-721）サブグラフをビルド&デプロイする。

## 前提

- Node.js 20+ / pnpm / AWS CLI v2 / 認証済みの AWS プロファイル（またはSSO）
- リポジトリの `main` が GitHub に push 済みであること（userData が clone する）

## セットアップ

```bash
cd hedera-subgraph-example/infra
pnpm install
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=ap-northeast-1
```

## デプロイ

```bash
# 初回のみ（アカウント×リージョンごと）
pnpm exec cdk bootstrap

# デプロイ
pnpm exec cdk deploy

# 生成された cdk.context.json（VPC ルックアップ結果）をコミットしておく
git add cdk.context.json && git commit -m "Add CDK context (VPC lookup)"
```

出力される `GraphqlUrl` を控える。

## 確認

初回は Docker イメージ取得 + サブグラフのインデックス同期に **5〜15 分** かかる。

```bash
# 数分待ってから
curl -s <GraphqlUrl> \
  -H 'content-type: application/json' \
  -d '{"query":"{ _meta { block { number } } collection(id:\"0x94f5c9f6a59c257823fa5fecd8e7a15f8ed94029\"){ totalSupply } }"}'
```

`{"data":{...}}` が返れば成功。`no data found` 系は同期待ち。

## ログ / トラブルシュート

```bash
# SSM でインスタンスに入る（SSH 不要）
aws ssm start-session --target <InstanceId> --region ap-northeast-1

# 中で
sudo tail -n 200 -f /var/log/subgraph-userdata.log
sudo tail -n 200 -f /var/log/subgraph-bootstrap.log
cd /opt/app/hedera-subgraph-example
sudo docker compose -f deploy/docker-compose.prod.yaml logs -f graph-node
```

よくある問題:

| 症状 | 対処 |
|---|---|
| graph-node が `collation` エラーで起動しない | `deploy/docker-compose.prod.yaml` の `postgres` に `POSTGRES_INITDB_ARGS: '-E UTF8 --locale=C'` を足し、`sudo rm -rf data/postgres` して `docker compose ... up -d` で作り直す |
| 同期が異常に遅い / RPC エラー多発 | Hashio のレート制限。`config/testnet.json` の `startBlock` を最近のブロックに上げて `pnpm compile` → `pnpm exec graph deploy --version-label v0.0.2 MyToken`。または `/opt/app/hedera-subgraph-example/.env` に `GRAPH_ETHEREUM_RPC=testnet:<専用RPC>` を書いて `docker compose ... up -d` |
| userData が途中で失敗 | ログを確認し原因を潰したあと、`sudo bash /opt/app/hedera-subgraph-example/deploy/ec2-bootstrap.sh` を手動再実行（冪等） |

## 撤去

```bash
pnpm exec cdk destroy
```

Elastic IP も association ごと削除される（解放漏れ課金なし）。
````

- [ ] **Step 2: `hedera-subgraph-example/README.md` にデプロイ節を追記**

`## セットアップ` セクションの直前に以下の節を挿入:

```markdown
## AWS へのデプロイ

ローカルではなく AWS 上（EC2 単一ホスト）で常時稼働させる場合は
[`infra/README.md`](infra/README.md) を参照。CDK (TypeScript) で
`cdk deploy` 一発で graph-node ごと立ち上がり、
`http://<Elastic IP>:8000/subgraphs/name/MyToken` で公開される。

```

- [ ] **Step 3: ドキュメントをコミット**

```bash
cd hedera-subgraph-example
git add infra/README.md README.md
git commit -m "Document CDK EC2 deployment workflow"
```

- [ ] **Step 4: （push はこの Task では行わない — preflight ruling）**

このセッションは worktree ブランチ上で作業しているため、`git push origin main` はここでは実行しない。
`main` へのマージ + push は最後に `finishing-a-development-branch` で行う。
（`cdk deploy` の userData は `main` を clone するので、実デプロイ前にマージ + push が完了している必要がある）

- [ ] **Step 5: 最終確認**

Run: `cd hedera-subgraph-example/infra && pnpm test && pnpm typecheck && echo "ALL GREEN"`
Expected: `ALL GREEN`（13 テスト緑 + 型エラーなし）
AWS 認証情報がある環境では続けて `pnpm exec cdk synth --quiet` も成功すること。

---

## Self-Review

**1. Spec coverage**

| Spec 項目 | 対応タスク |
|---|---|
| `infra/` に独立 CDK (TS) プロジェクト | Task 1 |
| 単一スタック `HederaSubgraphStack` | Task 1–3 |
| Security Group（8000 のみ、任意 SSH） | Task 2 |
| IAM Role（`AmazonSSMManagedInstanceCore`） | Task 2 |
| EC2 `t3.medium` / Ubuntu 24.04 / gp3 30GB / IMDSv2 | Task 2 |
| デフォルト VPC パブリックサブネット | Task 2 |
| userData 薄く + `ec2-bootstrap.sh` に委譲 | Task 3 / Task 5 |
| Elastic IP + association | Task 3 |
| Outputs（GraphqlUrl / InstanceId / ElasticIp / SsmStartSessionCommand） | Task 3 |
| `deploy/docker-compose.prod.yaml`（管理ポート localhost、restart、name） | Task 4 |
| `deploy/ec2-bootstrap.sh`（冪等、version-label 明示） | Task 5 |
| `infra/README.md`（bootstrap→deploy→確認→destroy） | Task 6 |
| 既存 README への導線 | Task 6 |
| サブグラフ + infra を push | Task 6 Step 4（サブグラフ本体は既に `origin/main` に存在、infra を追加 push） |
| `cdk.context.json` をコミット | Task 6 README に記載（`cdk deploy` 実行時に生成されるため手順書側で担保） |
| リスク: Hashio レート制限 / collation / 対話プロンプト / EIP 課金 | Task 6 README のトラブルシュート表、Task 5 の `--version-label` |
| 検証: `cdk synth` / `tsc --noEmit` / `bash -n` | 各 Task の Step、Task 6 Step 5 |

ギャップなし。

**2. Placeholder scan**

`TBD` / `TODO` / 「適切に処理」/ テストコードなしの「テストを書く」— なし。各コードステップに実物あり。

**3. Type consistency**

- `HederaSubgraphStackProps`（`repoUrl` / `repoBranch` / `instanceType` / `allowedSshCidr?`）は Task 1 定義、Task 2/3 で同一シグネチャを使用。
- `buildUserData(opts: { repoUrl; repoBranch })` は Task 3 定義・Task 3 Step 7 で同じ引数で呼び出し。
- `this.instance`（`ec2.Instance`）は Task 2 で `public readonly` 宣言、Task 3 で `this.instance.instanceId` を参照。
- Output 論理 ID（`GraphqlUrl` / `ElasticIp` / `InstanceId` / `SsmStartSessionCommand`）は Task 3 実装とテスト（Step 5）で一致。
- compose のプロジェクト名 `hedera-subgraph` は Task 4 の `name:` と Task 6 README の `docker compose` コマンドで一致。
- sentinel パス `/opt/app/.subgraph-deployed` は Task 5 スクリプトと spec §3.4 で一致。

不整合なし。
