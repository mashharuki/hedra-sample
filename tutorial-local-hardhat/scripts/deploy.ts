import { network } from "hardhat";

/**
 * デプロイ用のメイン関数
 */
async function main(): Promise<void> {
  const { viem } = await network.connect({
    network: "hedera",
  });

  const [deployer] = await viem.getWalletClients();

  if (deployer.account === undefined) {
    throw new Error("No deployer account is configured.");
  }

  console.log(
    "Deploying contract with the account:",
    deployer.account.address,
  );

  // Counter に constructor 引数がない場合は空配列でOK
  const counter = await viem.deployContract("Counter", [], {
    client: {
      wallet: deployer,
    },
  });

  // deployContract はデプロイ完了を待って Contract インスタンスを返す
  console.log("Contract deployed at:", counter.address);
}

main().catch(console.error);