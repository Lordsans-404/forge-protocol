# 🔥 Forge Protocol

**Forge Protocol is a decentralized habit-building platform that turns daily discipline into a high-stakes, highly rewarding experience — powered by the 0G EVM network.**

Users stake real USDT on their commitments. AI verifies daily proof. The blockchain enforces accountability. Those who keep their word get rewarded. Those who don't fund a global charity pool.

---

## ⚙️ Core Mechanics

### 1. The Commitment Lifecycle
- **Setup:** Define your habit, duration, and target minutes per day.
- **Stake:** Lock USDT into a smart contract escrow on 0G EVM.
- **Proof:** Daily visual proof is required. A built-in timer ensures minimum effort is met.
- **AI Validation:** Visual proofs are analyzed by **Groq Vision (LLaMA 4 Scout)** to verify activity relevance and duration.
- **Claim:** Upon completion, retrieve your stake plus a loyalty bonus and a unique **Champion Medal (NFT)**.

### 2. Slashing & Redistribution
Failures are handled by the protocol's "Never Miss Twice" rule:
- **First Miss:** Partial stake slashing (40%).
- **Second Miss:** Full stake liquidation.
- **Redistribution:** Slashed funds are split between **Charity (35%)**, **Protocol Rewards (30%)**, **Treasury (25%)**, and **Backup (10%)**.

### 3. Gamification
- **Daily Badge NFT** minted to your wallet for every successful daily proof submission.
- **Champion Medal NFT** awarded upon full commitment completion.
- **My Growth Journey** gallery powered by 0G Storage — every proof image is stored on-chain.
- Anti-plagiarism via Merkle root hash deduplication before any upload costs are incurred.

---

## 🏗️ Architecture (Web 2.5 Hybrid)

Forge Protocol operates on a hybrid model to balance high-performance UI with decentralized security.

- **On-Chain (0G EVM):** The source of truth for all financial actions. Handles smart contract escrow, proof hashes, and slashing logic via `ForgeProtocol.sol`.
- **Off-Chain (Supabase):** High-speed metadata cache and indexer for user profiles, commitment history, daily proofs, and NFT index.
- **Decentralized Storage (0G Storage):** Proof images are uploaded to the 0G Storage Network and referenced by Merkle root hash.
- **AI Engine (Groq Vision):** Server-side vision processing for autonomous proof validation.
- **Event Sync:** Custom EVM event processor (`/api/events/onchain`) syncs on-chain events (CommitmentCreated, ProofSubmitted, SlashExecuted, CommitmentCompleted) to Supabase in real-time.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Blockchain** | 0G Newton Testnet (EVM) |
| **Smart Contract** | Solidity, Foundry, OpenZeppelin |
| **Frontend** | Next.js 15 (App Router), React 19, Vanilla CSS |
| **Wallet** | RainbowKit, wagmi, viem, ethers.js |
| **Backend/Cache** | Supabase (PostgreSQL) |
| **AI Integration** | Groq SDK (LLaMA 4 Scout Vision) |
| **Decentralized Storage** | 0G Storage Network (`@0gfoundation/0g-storage-ts-sdk`) |
| **Icons & UI** | Lucide React |

---

## 📁 Project Structure

```text
forge-protocol/
├── apps/web/                   # Next.js frontend application
│   ├── app/                    # App Router pages & API routes
│   │   ├── api/events/onchain/ # EVM event processor & DB sync
│   │   ├── api/validate-proof/ # AI proof validation + 0G upload
│   │   ├── api/medals/         # NFT index cache API
│   │   └── dashboard/          # Dashboard & commitment detail pages
│   ├── components/             # Reusable UI components
│   │   ├── landing-page/       # Landing page sections
│   │   └── dashboard/          # Dashboard widgets & commitment flow
│   └── lib/                    # Contract ABI, utilities, Supabase client
├── contracts/                  # Foundry workspace
│   └── src/ForgeProtocol.sol   # Main smart contract
├── tests/                      # Backend integration tests (Vitest)
├── scripts/                    # Deployment & utility scripts
└── progress_daily/             # Sprint logs & development context
```

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/) or Node.js 18+
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract development)
- MetaMask or any EVM-compatible wallet
- 0G Newton Testnet RPC: `https://evmrpc-testnet.0g.ai`

### Environment Setup
Copy `.env.example` to `apps/web/.env.local` and fill in:
```bash
NEXT_PUBLIC_EVM_RPC_URL=https://evmrpc-testnet.0g.ai
NEXT_PUBLIC_CONTRACT_ADDRESS=<deployed_contract_address>
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
GROQ_API_KEY=<your_groq_key>
ZG_RPC_URL=<0g_storage_rpc>
ZG_INDEXER_URL=<0g_indexer_url>
EVM_AUTHORITY_PRIVATE_KEY=<authority_wallet_key>
```

### Smart Contract (Foundry)
```bash
cd contracts
forge build
forge test
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

### Web Frontend
```bash
# Install dependencies
bun install

# Start development server
npm run dev
# or
bun run dev
```

---

## 🔐 Security & Integrity

- **Non-Custodial:** Funds are locked in the smart contract escrow, not held by any third party.
- **Immutable Proofs:** A Merkle root hash of every proof image is submitted on-chain via `submitProof()`.
- **Anti-Plagiarism:** Root hash is checked against Supabase before any 0G Storage upload — duplicate images are rejected server-side.
- **UTC-Enforced:** Daily submissions are validated against sequential day numbers enforced by the smart contract.
- **AI-Gated:** Proofs with a confidence score below 30% are rejected before any on-chain transaction is initiated.

---

## 🤝 Contributing

We follow strict clean code standards and English-only documentation rules. Refer to `GEMINI.md` for detailed engineering standards used in this project.

---

## 📄 License

Private / All Rights Reserved. © 2026 Forge Protocol Team.
