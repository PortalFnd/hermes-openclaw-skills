# clawtrl-wallet

Official multi-chain crypto wallet skill for [OpenClaw](https://openclaw.ai) and [Hermes](https://nousresearch.com/hermes) agents, built by [Clawtrl](https://clawtrl.portalfoundation.ai/).

Crypto wallet for AI agents on **Base** and **Robinhood Chain** at the same time. One wallet, one address, every chain. Features ERC-8128 signing, x402 autonomous payments, **private (ZK) shielded USDC payments**, ETH/USDC transfers, stock-token and ERC-20 tooling, generic contract read/write, ENS resolution, and a persistent transaction log. Works with OpenClaw and Hermes runtimes.

### Install

```bash
npx clawtrl-wallet
```

Works with or without root:
- **With root/sudo**: Installs to `/opt/clawtrl/`, sets up systemd service
- **Without root**: Installs to `~/.clawtrl/`, runs proxy as background process

### Chains

The same wallet address works on every chain simultaneously. Every wallet tool accepts an optional trailing chain argument (or `WALLET_CHAIN` env var). Default is `base`.

| Chain | Chain ID | Notes |
|-------|----------|-------|
| `base` | 8453 | Default. USDC lives here; x402 payments settle here |
| `robinhood` | 4663 | Robinhood Chain mainnet (Arbitrum Orbit L2). ETH gas, stock tokens (TSLA, NVDA, AAPL, 200+), USDG, Uniswap v2/v3/v4 + UniswapX |
| `robinhood-testnet` | 46630 | Free faucet (test ETH + stock tokens) at [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com) |
| `base-sepolia` | 84532 | Base testnet |

```bash
wallet-balance robinhood
token-balance 0x<stock-token> robinhood
crypto-send 0x1234abcd 0.01 eth robinhood-testnet
contract-read 0x<token> "symbol() view returns (string)" '[]' robinhood
```

> **Jurisdiction note:** Robinhood Stock Tokens are Regulation S tokenised debt securities. They are not registered under US securities law (US persons barred; UK, Canada, Switzerland restricted). Compliance is enforced at the token-contract and issuer level, not the AMM. Check the user's jurisdiction before mainnet stock-token trades and use `robinhood-testnet` for experimentation. Standard (non-security) ERC-20s on Robinhood Chain are permissionless.

### Core Wallet Tools

| Tool | Description |
|------|-------------|
| `wallet-info` | Get wallet address and chain identity |
| `wallet-balance [chain]` | Check ETH/USDC balances (any chain) |
| `signed-fetch` | ERC-8128 signed HTTP requests + x402 auto-payment (`WALLET_CHAIN` to switch chain) |
| `crypto-send <to> <amount> [eth\|usdc] [chain]` | Send ETH or USDC to any address |
| `erc8128-sign` | Sign an HTTP request and return headers (`WALLET_CHAIN` to switch chain) |
| `paytoll` | Call any PayToll x402 API endpoint |
| `token-balance <token> [chain]` | Check balance of any ERC-20 / stock token |
| `token-allowance <token> <spender> [chain]` | Check token spending allowance |
| `token-revoke <token> <spender> [chain]` | Revoke token spending allowance |
| `token-price <symbol\|address> [feed] [chain]` | Chainlink price feeds (named feeds on Base; pass a feed address on other chains) |
| `tx-status <hash> [chain]` | Check if a transaction succeeded, reverted, or is pending |
| `contract-read <address> <sig> [args] [chain]` | Call any view function on any contract |
| `contract-write <address> <sig> [args] [value] [chain]` | Send a transaction to any contract |
| `contract-events <address> <topic> [from] [chain]` | Query events from any contract |
| `ens-resolve` | Resolve ENS names to addresses (and reverse) |
| `gas-estimate <to> <value> [data] [chain]` | Preview gas cost before sending a transaction |
| `wallet-tx-log` | Read the persistent transaction history |
| `wallet-label` | Label an address in the local address book |
| `wallet-stats` | Get wallet transaction statistics |
| `wallet-summary [chain]` | Get a summary of wallet activity |

### Private Payment Tools (Optional)

Privacy tools use zero-knowledge proofs for unlinkable USDC payments. Enabled via `CLAWTRL_PRIVACY_ENABLED=true`.

| Tool | Description |
|------|-------------|
| `private-status` | Check if privacy engine is enabled and running |
| `private-balance` | Check shielded USDC balance (private pool) |
| `private-deposit` | Deposit USDC into privacy pool (creates encrypted note) |
| `private-pay` | Send unlinkable private USDC payment to any address |
| `private-fetch` | Make x402 HTTP requests paid from shielded balance |

### Requirements

- Node.js 18+
- `AGENT_WALLET_PRIVATE_KEY` environment variable (Ethereum private key)

### Privacy Setup (Optional)

To enable private shielded payments:

```bash
export CLAWTRL_PRIVACY_ENABLED=true
export CLAWTRL_PRIVACY_CHAIN=base  # or base-sepolia for testnet
# Optional overrides:
# export CLAWTRL_PRIVACY_RPC=https://...  # custom RPC
# export CLAWTRL_PRIVACY_SUBGRAPH=https://...  # custom subgraph
```

Privacy deposits require USDC on Base. Payments are unlinkable via ZK proofs: no one can trace who sent what to whom.

---

## Architecture

OpenClaw and Hermes agents call the same shell tools backed by the same signing proxy. The chain is chosen per request; the wallet address is identical on every chain.

```
Agent -> shell tool (curl) -> signing proxy (:8128) -> Base + Robinhood Chain
                                      |
                                ERC-8128 signing (per-chain ID)
                                x402 payments (v1 + v2)
                                Private ZK payments (shielded USDC)
                                USDC/ETH transfers
```

---

## Links

- [Source Code](https://github.com/PortalFnd/hermes-openclaw-skills)
- [Clawtrl](https://clawtrl.portalfoundation.ai/)
- [Clawtrl Skills Marketplace](https://clawtrl.portalfoundation.ai/skills)
- [OpenClaw](https://openclaw.ai)
- [Hermes Agent](https://nousresearch.com/hermes)
- [Agent Skills Spec](https://skills.sh)
- [x402 Protocol](https://docs.x402.org)
- [ERC-8128](https://erc8128.org)
- [Robinhood Chain Docs](https://docs.chain.robinhood.com)

## License

MIT
