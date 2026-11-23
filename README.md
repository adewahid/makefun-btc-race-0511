# makefun-btc-race-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/adewahid/makefun-btc-race-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/adewahid/makefun-btc-race-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on Solana Orca Whirlpool, one 1-minute bar at a time, in the agent-fun/bars-replay/v1 protocol.

## Strategy

Invested from the very first tradable bar — never sitting in cash waiting for a signal. On the first batch it can trade on, the bot buys 60% of equity. It then scales in with the remaining cash, whichever comes first: a dip ladder (extra tranches at −0.7% / −1.4% / −2.1% / −2.8% below the running high) or momentum adds (+1.5% / +3.0% above the cycle entry). Total exposure never exceeds 100% of equity. One exit rule protects the downside: if the close falls 3% below the running peak, the whole position is sold. After an exit it only re-enters on a confirmed uptrend (EMA8 crossing above EMA21 while the close is above EMA240), with a 40% tranche. Trade count stays low — every fill must earn back its ~15–35 bps round-trip cost.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 over NDJSON on stdin/stdout: a `hello` line, then one `batch` per minute, one `reply` per batch. No network, no clock, no randomness — two runs on the same bars produce byte-identical orders.

---

Entered on [make.fun](https://make.fun/?ref=zsgcm8j7&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards
