# clawtrl-wallet

Official crypto wallet skill for [OpenClaw](https://openclaw.ai) and [Hermes](https://nousresearch.com/hermes) agents, built by [Clawtrl](https://clawtrl.portalfoundation.ai/).

Crypto wallet for AI agents on Base (Ethereum L2). Features ERC-8128 signing, x402 autonomous payments, **private (ZK) shielded USDC payments**, ETH/USDC transfers, generic contract read/write, ENS resolution, and a persistent transaction log. Works with OpenClaw and Hermes runtimes.

### Install

```bash
npx clawtrl-wallet
```

Works with or without root:
- **With root/sudo**: Installs to `/opt/clawtrl/`, sets up systemd service
- **Without root**: Installs to `~/.clawtrl/`, runs proxy as background process

### Core Wallet Tools

| Tool | Description |
|------|-------------|
| `wallet-info` | Get wallet address and chain identity |
| `wallet-balance` | Check ETH/USDC balances on Base |
| `signed-fetch` | ERC-8128 signed HTTP requests + x402 auto-payment |
| `crypto-send` | Send ETH or USDC to any address on Base |
| `erc8128-sign` | Sign an HTTP request and return headers |
| `paytoll` | Call any PayToll x402 API endpoint |
| `token-balance` | Check balance of any ERC-20 token on Base |
| `token-allowance` | Check token spending allowance |
| `token-revoke` | Revoke token spending allowance |
| `tx-status` | Check if a transaction succeeded, reverted, or is pending |
| `contract-read` | Call any view function on any Base smart contract |
| `contract-write` | Send a transaction to any Base smart contract |
| `contract-events` | Query events from any Base smart contract |
| `ens-resolve` | Resolve ENS names to addresses (and reverse) |
| `gas-estimate` | Preview gas cost before sending a transaction |
| `wallet-tx-log` | Read the persistent transaction history |
| `wallet-label` | Label an address in the local address book |
| `wallet-stats` | Get wallet transaction statistics |
| `wallet-summary` | Get a summary of wallet activity |

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

Privacy deposits require USDC on Base. Payments are unlinkable via ZK proofs — no one can trace who sent what to whom.

---

## Architecture

OpenClaw and Hermes agents call the same shell tools backed by the same signing proxy.

```
Agent → shell tool (curl) → signing proxy (:8128) → Base chain
                                    |
                              ERC-8128 signing
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

## License

MIT
