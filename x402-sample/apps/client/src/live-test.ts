if (process.env.RUN_LIVE_X402 !== "1") {
  throw new Error(
    "Set RUN_LIVE_X402=1 to authorize a live Hedera Testnet payment.",
  );
}

await import("./index.js");
