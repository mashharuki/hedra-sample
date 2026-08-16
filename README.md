# Hedera（Hashgraph） 調査・学習用リポジトリ

## Hederaの概要

Hedera は、Hashgraph consensus を用いる公開・オープンソースの Proof-of-Stake 分散台帳である。公式は、ブロックを直列につなぐ狭義のブロックチェーンではなく、イベントの有向非巡回グラフ（DAG）を使う分散台帳だと説明している。[What is Hedera?](https://docs.hedera.com/learn/getting-started/what-is-hedera)

- 合意形成は **gossip about gossip** と **virtual voting**。伝播履歴を含むイベントグラフから投票結果を計算する。
- 公式性能主張は約 **10,000 TPS**、**3〜5秒の絶対的ファイナリティ**、および悪性ノードがステークの3分の1未満であることを前提とした aBFT。これは環境・負荷・前提に依存する公式値であり、プロダクト固有のSLAではない。
- ネイティブ通貨 **HBAR** は、ネットワーク手数料とステーキングに使う。手数料はUSD建てで算出されHBARで支払うため、予算を立てやすい設計を掲げる。公式の平均的な目安は$0.0001/transactionだが、実際は操作・データ量ごとに異なる。[公式概要](https://docs.hedera.com/learn/getting-started/what-is-hedera)
- consensus node が合意と書込みを担い、mirror node は履歴を検証・複製して REST/gRPC API を提供する。dAppの読み取り、分析、Explorerは主に後者を活用する。
- ガバナンスは Hedera Governing Council が担う。最大39組織の任期制モデルで、コード、ネットワーク、料金、トレジャリーを監督する。これは企業・機関の関与を得やすい一方、Ethereumのようなpermissionless validator集合とは分散化モデルが異なる重要なトレードオフである。[Council FAQ](https://hederacouncil.org/faq)

## Hederaの特徴・他のチェーンとの差異

| 観点 | Hedera | 開発・採用上の含意 |
| --- | --- | --- |
| 合意と確定性 | Hashgraph / aBFT / 数秒のfinalityを公式が掲げる | 決済、順序、証跡を早く確定させたい場面と相性がよい |
| ネイティブサービス | HCS、HTS、Smart Contract Service、HFS | トークン、改竄検知ログ、EVMロジックを用途別に選べる |
| EVM | Solidity、MetaMask、Hardhat、Foundry、Remix、ethers/viemを利用可能。JSON-RPC Relayが橋渡しする | Ethereum開発者の移行コストを下げる。ただし完全互換ではない |
| トークン | HTSでFT/NFTをコントラクトなしに発行・管理可能。EVMからsystem contract経由で呼べる | KYC、freeze、pause、wipe等の管理機能を必要とするRWA/決済で選択肢になる |
| データ | HCSは順序・consensus timestamp・検証可能なtopic messageを提供 | AI provenance、監査証跡、IoT、投票、サプライチェーンに向く |
| ガバナンス | Councilが運営・ノード運用を担うpermissionedなモデル | 企業との説明・継続性を重視する場合の強み。検閲耐性やnode participationの性質は他L1と比較検討が必要 |

### EVM互換だが「Ethereumそのもの」ではない

Hedera Smart Contract Service は EVMを実行し、既存のSolidityワークフローを使える。一方で、ネイティブIDは `shard.realm.num`（例: `0.0.3`）、HBARは8桁小数、鍵・アカウント・トランザクションの扱いにも差がある。移植時は特に以下をテストする。

- network設定、chain ID（Mainnet `295`、Testnet `296`）とRPCの対応
- native ID と `0x` EVM address の相互変換
- HBAR転送・署名鍵（EVM transaction は ECDSA secp256k1）
- event取得、gas estimation、indexer、ウォレットの挙動
- HTSを使う場合のtoken association・管理鍵・権限設計

Solidityからネイティブサービスを呼ぶためのsystem contractには、HTS `0x167`、Hedera Account Service `0x16a`、Exchange Rate `0x168`、PRNG `0x169`がある。[hedera-smart-contracts](https://github.com/hashgraph/hedera-smart-contracts) の参照実装は未監査と明記されているため、コピーして本番投入せず個別にテスト・監査する。

## プロダクト開発においてHedraを使う理由(Hedraの利用ユースケース)

### 採用を検討しやすいケース

1. **RWA、ステーブルコイン、ロイヤルティ、会員権**  
   発行・移転・凍結・KYCなどをHTSで扱い、複雑な権利や償還ロジックだけをSolidityで実装するhybrid tokenizationが有効。例として、Kea CreditはAI審査とHedera上のtokenized lending vaultを組み合わせていると説明する。[Kea Credit](https://hedera.com/case-study/kea-credit/)

2. **少額・高頻度の決済、x402、エージェント決済**  
   USD建ての予測しやすい手数料と短いfinalityを生かし、pay-per-use、コンテンツ課金、IoT、agent-to-agent paymentを設計しやすい。公式テンプレートには、HBARとx402でファイル購入を決済する実装がある。[x402 Pay-per-use template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use)

3. **検証可能なイベントログとprovenance**  
   HCS topicに業務イベント、AIモデルの入出力ハッシュ、IoTデータの署名、証明書の参照を記録する。生データや個人情報を直接オンチェーンへ置く用途ではなく、オフチェーン保管＋ハッシュ/参照の設計が原則となる。ATECはIoT調理機器の利用データとGuardianを用いたカーボンクレジットの検証を事例として公表している。[ATEC](https://hedera.com/case-study/atec/)

4. **EVM dAppにHedera固有機能を足すケース**  
   DEX、貸借、ゲーム、NFTマーケットにSolidityを使いながら、HTSでtoken operations、HCSで監査・順序・agent coordinationを行う。既存EVMコードをそのまま動かせることは保証されないため、最小PoCで差分を確認する。

### 採用事例・エコシステム事情

- **SentX**: HederaのNFT launchpad/marketplace。公式ケーススタディは累計211M HBAR、220万超の取引、NFT collecting activityの98%以上を掲載している。いずれも同社・公式による公表値。[SentX](https://hedera.com/case-study/sentx/)
- **MMCM / DOVU / Guardian**: 廃車の40項目データを基に、リアルタイムの環境価値を追跡・発行するdMRV。環境価値は方法論・検証主体・規制の要件が重要で、台帳採用だけでクレジットの品質は保証されない。[MMCM](https://hedera.com/case-study/mmcm/)
- **Xeni**: 旅行事業者向けの予約・決済基盤。公式掲載では3,000万超のMainnet transaction、1,200万のbooking、40万超のwallet作成を掲げる。[Xeni](https://hedera.com/case-study/xeni/)
- **Acoer**: HCS/SCSを用い、医療データの真正性・監査・ワークフロー自動化を目指す。医療ではオンチェーンに個人健康情報を格納せず、アクセス制御とデータ保護の別設計が不可欠。[Acoer](https://hedera.com/case-study/acoer/)
- 開発支援は `scaffold-hbar`、Hedera Developer Portal、Hiero OSS、Hedera Agent Kit、Guardian、Stablecoin Studioに広がる。AI・RWA・paymentsのテンプレートが増えている点が直近の特徴である。[Hedera Developers GitHub](https://github.com/hedera-dev)

### 留意点・リスク

- Council中心のノード/ガバナンスモデルを、プロダクトの信頼モデルと規制説明に照らして評価する。
- 2023年にはSmart Contract Serviceのprecompile周辺の脆弱性が悪用され、複数DEXのHTS token poolに影響した。Hederaはproxyアクセス停止と修正を行った。Hedera固有のEVM/HTS境界は特にレビュー対象にする。[公式postmortem](https://hedera.com/blog/analysis-remediation-of-the-precompile-attack-on-the-hedera-network/)
- 公式ステータス、監査、バグバウンティは導入前・リリース前に再確認する。Immunefiの現行プログラムでは最大報奨額が掲載されているが、変更されうる。[Immunefi](https://immunefi.com/bug-bounty/hedera/information/)

## Hedraを採用したプロダクト事例・エコシステム事情

以下は、Hederaがスポンサーまたは賞を出したハッカソンの一次プロジェクトページを優先した事例である。作品説明はチームの自己申告を含む。

| プロダクト | イベント・受賞 | Hederaの使い方 | 示唆 |
| --- | --- | --- | --- |
| [ParkPulse](https://ethglobal.com/showcase/parkpulse-w84tg) | ETHGlobal New York 2025、AI on Hedera 1位 / Overall Winner | HashPack、Solidityの提案・投票・報酬、HCSとAgent Kitで市民参加を記録 | AI + 意思決定の監査証跡 |
| [Vision Pay](https://ethglobal.com/showcase/vision-pay-s1t91) | ETHOnline 2025、Agent Kit & Google A2A 1位 | 映像認識した店舗で、agentがHBAR/PYUSD支払いを実行 | agentic paymentは承認・支払い上限設計が中心 |
| [HyperAgent](https://ethglobal.com/showcase/hyperagent-mzvri) | ETHGlobal Buenos Aires 2025、同1位 | agent登録・評判・タスク、Hedera contractとAgent Kit、Google A2Aを接続 | agent identity/reputation と実行の結合 |
| [Proofs of Inference](https://ethglobal.com/showcase/proofs-of-inference-6rug4) | ETHGlobal Prague、Hedera EVM & Cross-Chain 1位 | zkML proofの依頼・検証・支払いをHedera EVM escrowで扱う | proof自体はoff-chain/ストレージ、決済・監査をオンチェーンへ |
| [DIVE](https://ethglobal.com/showcase/dive-5hxbp) | ETHGlobal Cannes 2026、AI & Agentic Payments on Hedera / Finalist | HTSでYES/NO token、HCS standardsで投票・agent coordination | prediction marketにHCS/HTSを組み合わせる |
| [Wafer](https://ethglobal.com/showcase/wafer-r4uab) | ETHGlobal New York 2026、Tokenization on Hedera | KYC/freeze key付きHTS pool shareとclaim NFTでDePIN融資を表現 | RWA/creditでは権限と償還状態を明示 |
| [AudiThor](https://ethglobal.com/showcase/audithor-ntedc) | ETHGlobal Cannes、No Solidity Allowed賞 | AIコード監査をnanopaymentで課金し、HCSに監査ログを残す | SDKネイティブ利用の好例 |
| [Whisper Transactions](https://ethglobal.com/showcase/whisper-transactions-ui8pq) | ETHOnline 2024、Hedera EVM Starter Bounty | ZKP/UTXOをHTSとSolidity EVMで用いる私的送金 | privacy用途はZK等の追加暗号技術が必要 |

Devpostでは [Hedera22](https://hedera22.devpost.com/) が6週間で2,500人超・95か国・118プロジェクトの参加を公表した。総合上位は、共有を促す商取引と寄付を組み合わせたDeal Designer、法的文書と自己実行を結ぶUniFi Ricardian Contracts、NFTロイヤルティを柔軟に分配するFlexible NFT Royalty Distributionだった。[公式受賞発表](https://hedera.com/blog/congratulations-to-the-hedera22-hello-smart-contract-hackathon-winners/)

## Hedraがスポンサーしたハッカソンの過去のwinnerのプロダクトの傾向について

受賞作を横断すると、勝ち筋は単なる「HBARで送金するアプリ」ではない。Hedera固有のサービスを、プロダクト課題に対する必然的な役割として置いている。

1. **HCSを監査可能なイベント層にする**  
   投票、AI agentの行動、IoT/環境データ、商品のclaim、チャットなどで、順序・timestamp・改竄検知を価値に変える。Hello Future OriginsのVeritasやGreenTraceもこの系統である。[Origins受賞発表](https://hedera.com/blog/these-are-the-winners-of-the-hello-future-origins-hackathon/)

2. **HTSで現実の権利・制約を表現する**  
   KYC/freezeやNFT receiptを使うRWA、請求書ファクタリング、carbon credit、pool shareが多い。tokenを発行する理由、管理鍵の主体、償還/失効フローをデモで明快にする。

3. **EVMを入口、ネイティブサービスを差別化にする**  
   Solidity/MetaMaskで参加しやすくしつつ、HTS system contract、HCS、HashPack、Mirror Node、cross-chainを組み合わせる。ETHGlobalの賞要件も、Hedera network上での実装、公開GitHub、HashScan検証、短いデモを重視している。[ETHGlobal New Delhi prizes](https://ethglobal.com/events/newdelhi/prizes)

4. **AI agentに支払い・評判・監査をセットにする**  
   Agent Kitを呼ぶだけではなく、agentが何を判断し、誰が承認し、どの支払いを実行し、どの記録を残すのかを実装する。2025〜2026年の受賞作に特に多い。

5. **オフチェーン世界との接点を具体化する**  
   衛星、IoT、環境価値、旅行、DePIN、請求書など、データ源・検証者・オンチェーン化する最小単位を示す作品が目立つ。Hederaは「すべてをオンチェーン化する」より、検証可能な状態遷移・支払い・証跡を任せる設計で活きる。

## Hedraの開発はじめ方

### スマートコントラクト編

1. [Hedera Portal](https://portal.hedera.com/register) でTestnet accountを作成し、test HBARを取得する。
2. MetaMaskをHedera Testnetへ接続し、Remixで最小コントラクトをデプロイする。既存プロジェクトならHardhatまたはFoundryを使い、JSON-RPC Relayへ接続する。[EVM Developers](https://docs.hedera.com/evm)
3. HTSをSolidityから使う場合は、`@hiero-ledger/hiero-contracts` または公式system contract interfaceを導入する。まずFT/NFTのcreate・transfer・associateをTestnetで確認する。[HTS system contracts](https://docs.hedera.com/hedera/smart-contracts/hts-system-contracts)
4. デプロイ済みコントラクトはSourcifyで検証するとHashScanに反映される。Mainnet/Testnetのchain ID、metadata、compiler設定を保存する。[HashScan verification](https://docs.hedera.com/evm/tutorials/intermediate/verify-hashscan)
5. unit testだけでなく、実Testnetで鍵・account・token association・event/indexing・feeを確認する。Hederaの参照コントラクトは未監査である。

**最小構成の選び方**

- 独自ロジック中心: Solidity + Hardhat/Foundry + JSON-RPC Relay
- FT/NFTを素早く出す: HTS + SDK
- 監査ログ: HCS topic + SDK / Mirror Node
- EVMとnative tokenを混ぜる: Solidity + HTS system contract
- AI agent: Hedera Agent Kit + 明示的な支払い承認ポリシー

### SDK編

Hedera SDKはJavaScript、Java、Goを中心に提供される。SDK利用では、operator accountを設定し、`Account` / `Transfer`、HTS token、HCS topic、Schedule transactionをネイティブに扱える。

1. HCSなら、topic作成 → message submit → Mirror NodeまたはSDKで取得、の順に試す。[Create Topic](https://docs.hedera.com/native/consensus/create-topic)
2. HTSなら、token作成 → recipient accountへのassociate → transfer → 必要に応じてairdrop、を実装する。Token IDとSolidity addressの関係を把握する。[Token ID](https://docs.hedera.com/native/tokens/token-id)
3. 雛形から始める場合は `scaffold-hbar` のtemplate branchを使う。オラクル、Hedera demo、subscription tokenization、bridge、payment scheduler、x402、cross-chain DCAが揃う。
4. 小さなAPI例は [hedera-code-snippets](https://github.com/hedera-dev/hedera-code-snippets) を参照する。AI agentは [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js) のREADMEとサンプルから始める。

## 参考文献

### 公式・一次資料

- [Hedera Docs: What is Hedera?](https://docs.hedera.com/learn/getting-started/what-is-hedera)
- [Hedera Docs: EVM Developers](https://docs.hedera.com/evm)
- [Hedera Docs: HTS system contracts](https://docs.hedera.com/hedera/smart-contracts/hts-system-contracts)
- [Hedera Docs: Token ID](https://docs.hedera.com/native/tokens/token-id)
- [Hedera Docs: Create Topic](https://docs.hedera.com/native/consensus/create-topic)
- [Hedera Docs: Verify on HashScan](https://docs.hedera.com/evm/tutorials/intermediate/verify-hashscan)
- [Hedera official website](https://hedera.com/)
- [Hedera Council FAQ](https://hederacouncil.org/faq)
- [Hedera roadmap](https://hedera.com/roadmap/)
- [Hedera status](https://status.hedera.com/)
- [Hedera audits and standards](https://hedera.com/audits-and-standards)
- [Hedera bug bounty](https://immunefi.com/bug-bounty/hedera/information/)
- [2023 Smart Contract Service incident postmortem](https://hedera.com/blog/analysis-remediation-of-the-precompile-attack-on-the-hedera-network/)

### 指定された開発資料

- [scaffold-hbar: Oracles](https://github.com/hedera-dev/scaffold-hbar/tree/templates/oracles)
- [scaffold-hbar: Hedera demo](https://github.com/hedera-dev/scaffold-hbar/tree/templates/hedera-demo)
- [scaffold-hbar: Tokenise subscriptions](https://github.com/hedera-dev/scaffold-hbar/tree/templates/tokenise-subscriptions)
- [scaffold-hbar: Blank template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/blank-template)
- [scaffold-hbar: Bridge](https://github.com/hedera-dev/scaffold-hbar/tree/templates/bridge)
- [scaffold-hbar: Payments scheduler](https://github.com/hedera-dev/scaffold-hbar/tree/templates/payments-scheduler)
- [scaffold-hbar: x402 pay-per-use](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use)
- [scaffold-hbar: Cross-chain DCA](https://github.com/hedera-dev/scaffold-hbar/tree/templates/cross-chain-dca)
- [Hedera code snippets](https://github.com/hedera-dev/hedera-code-snippets)
- [Hedera smart-contract interfaces](https://github.com/hashgraph/hedera-smart-contracts)
- [`@hiero-ledger/hiero-contracts`](https://www.npmjs.com/package/@hiero-ledger/hiero-contracts)
- [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js)
- [x402 Hedera example](https://github.com/matevszm/x402-hedera-example)
- [Hedera Open Standards](https://hol.org/docs/standards/)（外部資料。利用時は公式仕様との整合を確認する）

### ハッカソン・プロダクト一次ページ

- [ETHGlobal Hedera showcase search例: DIVE](https://ethglobal.com/showcase/dive-5hxbp)
- [ETHGlobal: ParkPulse](https://ethglobal.com/showcase/parkpulse-w84tg)
- [ETHGlobal: Vision Pay](https://ethglobal.com/showcase/vision-pay-s1t91)
- [ETHGlobal: Wafer](https://ethglobal.com/showcase/wafer-r4uab)
- [Devpost: Hedera22](https://hedera22.devpost.com/)
- [Devpost: Helping Hands](https://devpost.com/software/helping-hands-82nm06)
- [Devpost: P&S Recycling](https://devpost.com/software/p-s-recycling)
- [Hello Future Origins winners（DoraHacks導線を含む）](https://hedera.com/blog/these-are-the-winners-of-the-hello-future-origins-hackathon/)
- [Hedera Africa Hackathon（DoraHacks BUIDL）](https://hedera-hackathon.hashgraph.swiss/)

### 補助的な外部資料

- [Binance Square: Hedera](https://www.binance.com/ja/square/post/7299782232018)
- [emplace.jp: Hedera解説](https://emplace.jp/crypto/20250610-em696/)
- [Gate: Hedera technology and use cases](https://www.gate.com/ja/crypto-wiki/article/what-is-hedera-understanding-its-blockchain-technology-and-use-cases-in-2025)
- [Web3Report: Hedera](https://www.web3report.net/hedera/)
- [Hashscan](https://hashscan.io/testnet/home)

外部資料は導入理解の補助に留め、技術仕様、受賞、ネットワーク状態、セキュリティ判断は上記の公式・一次資料を優先する。
