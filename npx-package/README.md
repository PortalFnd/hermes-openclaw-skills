# clawtrl-wallet

Crypto wallet for AI agents on Base (Ethereum L2). ERC-8128 signing, x402 autonomous payments, ETH/USDC transfers, generic contract read/write, ENS resolution, and a persistent transaction log. Works with OpenClaw and Hermes runtimes.

## Install

```bash
npx clawtrl-wallet
```

Works with or without root:
- **With root/sudo**: Installs to `/opt/clawtrl/`, sets up systemd service
- **Without root**: Installs to `~/.clawtrl/`, runs proxy as background process

## What's Included

| Tool | Description |
|------|-------------|
| `wallet-info` | Get wallet address and chain identity |
| `wallet-balance` | Check ETH/USDC balances on Base |
| `signed-fetch` | ERC-8128 signed HTTP requests + x402 auto-payment |
| `crypto-send` | Send ETH or USDC to any address on Base |
| `erc8128-sign` | Sign an HTTP request and return headers |
| `paytoll` | Call any PayToll x402 API endpoint |
| `token-balance` | Check balance of any ERC-20 token on Base |
| `tx-status` | Check if a transaction succeeded, reverted, or is pending |
| `contract-read` | Call any view function on any Base smart contract |
| `contract-write` | Send a transaction to any Base smart contract |
| `ens-resolve` | Resolve ENS names to addresses (and reverse) |
| `gas-estimate` | Preview gas cost before sending a transaction |
| `wallet-tx-log` | Read the persistent transaction history |

## Requirements

- Node.js 18+
- `AGENT_WALLET_PRIVATE_KEY` environment variable (Ethereum private key)

## Architecture

OpenClaw and Hermes agents call the same shell tools backed by the same signing proxy.

```
Agent → shell tool (curl) → signing proxy (:8128) → Base chain
                                    |
                              ERC-8128 signing
                              x402 payments (v1 + v2)
                              USDC/ETH transfers
```

## Links

- [Source Code](https://github.com/PortalFnd/openclaw-skills)
- [Clawtrl](https://clawtrl.com)
- [ERC-8128](https://erc8128.org)
- [x402 Protocol](https://docs.x402.org)

## License

MIT
