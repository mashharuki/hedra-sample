import { network } from "hardhat";

const { viem } = await network.connect({
  network: "hedera",
});

console.log("Sending transaction on Hedera network");

const [sender] = await viem.getWalletClients();

console.log("Sending 10_000_000_000 wei from", sender.account.address, "to itself");

console.log("Sending transaction");

// トランザクションを送信します。
const tx = await sender.sendTransaction({
  to: sender.account.address,
  value: 10_000_000_000n,
});

console.log("tx hash:", tx);

console.log("Transaction sent successfully");