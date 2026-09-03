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
