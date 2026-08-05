# Clawtrl Skills

Official skills for [OpenClaw](https://openclaw.ai) and [Hermes](https://nousresearch.com/hermes) agents, built by [Clawtrl](https://clawtrl.com).

## Skills

| Skill | Description | Install | Runtimes |
|-------|-------------|---------|----------|
| [clawtrl-wallet](./clawtrl-wallet/) | Multi-chain crypto wallet (Base + Robinhood Chain) with ERC-8128 signing, x402 payments, Uniswap v3 stock-token swaps, and transfers | `clawhub install clawtrl-wallet` | OpenClaw, Hermes |
| [circle-agents](./circle-agents/) | Discover and pay for Circle Agents marketplace services with Clawtrl wallet tools | Guidance skill | OpenClaw, Hermes |

## Install

**OpenClaw:** Send the install command to your agent via Telegram, Discord, or any chat platform:

```
clawhub install clawtrl-wallet
```

**Hermes:** Skills with a `SKILL.md` are automatically available when placed in `/root/.hermes/skills/<skill-name>/SKILL.md`. The Clawtrl dashboard can install compatible skills directly on Hermes agents.

## What's Included

The **clawtrl-wallet** skill gives your agent:

- **Multi-chain wallet** — one address on Base and Robinhood Chain (stock tokens, USDG) at the same time
- **Token swaps** — buy/sell official Robinhood stock tokens (TSLA, NVDA, AAPL, 200+) via Uniswap v3, with verified-token protection against the chain's spoofed tickers
- **ERC-8128 authenticated requests** — cryptographic identity for every HTTP request
- **x402 autonomous payments** — auto-pay APIs that return 402 Payment Required (v1 + v2)
- **Crypto transfers** — send ETH/USDC to any address
- **Signed HTTP client** — signing + payments in one seamless tool

### Tools

| Tool | Description |
|------|-------------|
| `wallet-info` | Get wallet address and chain info |
| `wallet-balance [chain]` | Check ETH/USDC balances on any chain |
| `token-swap <amount> <in> <out> [chain] [--quote]` | Uniswap v3 swaps on Robinhood Chain (stock tokens, USDG, ETH) |
| `token-balance <token> [chain]` | Balance of any ERC-20 / stock token |
| `token-price <symbol> [chain]` | USD price via Chainlink oracles |
| `contract-read` / `contract-write` | Call any function on any contract |
| `signed-fetch` | Authenticated HTTP request with auto-payment |
| `crypto-send` | Send ETH or USDC |
| `erc8128-sign` | Sign a request (returns headers) |

Full tool list (allowances, revokes, tx log, labels, gas estimation, private ZK payments): [clawtrl-wallet/README.md](./clawtrl-wallet/README.md)

## Pre-installed on Clawtrl

If you deploy an agent via [clawtrl.com](https://clawtrl.com), the wallet skill is pre-installed and configured automatically on both OpenClaw and Hermes runtimes. Just fund the wallet and go.

**Hermes agents** also come preloaded with the [circle-agents](./circle-agents/) marketplace discovery skill.

## Links

- [Clawtrl](https://clawtrl.com)
- [Clawtrl Skills Marketplace](https://clawtrl.com/skills)
- [OpenClaw](https://openclaw.ai)
- [Hermes Agent](https://nousresearch.com/hermes)
- [Agent Skills Spec](https://skills.sh)
- [x402 Protocol](https://docs.x402.org)
- [ERC-8128](https://erc8128.org)

## License

MIT
