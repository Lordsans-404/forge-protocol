# 🔄 AtomX Migration: Solana → 0G (EVM)

Migrasi **on-chain only** — BE (Supabase, API routes, cron) dan FE (UI, pages, components) tidak disentuh.

---

## 🗺️ Overview: Apa yang Berubah, Apa yang Tidak

| Layer | Status | Detail |
|---|---|---|
| `programs/` (Rust/Anchor) | ❌ Hapus | Tulis ulang sebagai Solidity |
| `lib/idl.json` | 🔄 Ganti | Jadi ABI Solidity |
| `lib/executeSlash.ts` | 🔄 Rewrite | Anchor → ethers.js |
| `lib/mintCompletionMedal.ts` | 🔄 Rewrite | Anchor → ethers.js |
| `components/providers/WalletProvider.tsx` | 🔄 Rewrite | Solana wallet adapter → wagmi |
| `components/WalletButton.tsx` | 🔄 Rewrite | Solana → wagmi |
| `app/api/webhooks/helius/route.ts` | 🔄 Ganti | Helius → 0G webhook/indexer |
| `app/api/swap/route.ts` | ⚠️ Cek | Kemungkinan pakai Jupiter |
| `hooks/useCommitments.ts` | ⚠️ Cek | Kemungkinan ada Solana reads |
| `lib/supabaseAdmin.ts` | ✅ Aman | Tidak disentuh |
| `app/api/commitments/` | ✅ Aman | Tidak disentuh |
| `app/api/cron/` | ✅ Aman | Tidak disentuh |
| `app/api/medals/` | ✅ Aman | Tidak disentuh |
| `app/api/validate-proof/` | ✅ Aman | Tidak disentuh |
| Semua UI components & pages | ✅ Aman | Tidak disentuh |
| Supabase schema & cron SQL | ✅ Aman | Tidak disentuh |

---

## 🧹 FASE 1: Bersihkan File Solana

### 1.1 Hapus Rust/Anchor artifacts

```bash
cd ~/forge-protocol

rm -rf programs/
rm -rf target/
rm -rf migrations/
rm -rf tests/atomx-program.ts    # test Anchor, bukan backend test
rm -f Anchor.toml
rm -f Cargo.toml
rm -f Cargo.lock
rm -f rust-toolchain.toml
rm -f tsconfig.anchor.json
rm -f authority.json             # keypair Solana lama, jangan di-commit
```

### 1.2 Hapus scripts Solana-specific

```bash
# Cek dulu isi masing-masing script sebelum hapus
rm -f scripts/check-auth-pubkey.mjs
rm -f scripts/check-balance.mjs
rm -f scripts/fetch-global-state.mjs
rm -f scripts/setup-devnet.mjs
rm -f scripts/test-batch-slash.mjs
rm -f scripts/trigger-cron.mjs
rm -f scratch/extract_pubkey.ts
rm -f apps/web/scripts/setup-devnet.mjs
rm -f apps/web/scripts/transfer-usdt.mjs
```

### 1.3 Hapus deps Solana dari `apps/web/package.json`

```bash
cd apps/web

npm uninstall \
  @solana/web3.js \
  @solana/spl-token \
  @coral-xyz/anchor \
  @project-serum/anchor \
  @solana/wallet-adapter-base \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-wallets \
  @solana/wallet-adapter-phantom \
  bs58 \
  borsh
```

### 1.4 Install deps EVM

```bash
cd apps/web

npm install ethers wagmi viem @tanstack/react-query
npm install @rainbow-me/rainbowkit     # opsional, untuk UI wallet yang bagus
```

---

## ⛓️ FASE 2: Tulis Smart Contract Solidity

Buat struktur Foundry di root project (terpisah dari `apps/web`):

```bash
cd ~/forge-protocol

# Install Foundry jika belum
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Init Foundry
forge init contracts --no-git
```

Struktur yang perlu dibuat:

```
contracts/
├── src/
│   ├── AtomX.sol              # main contract (pengganti lib.rs)
│   ├── interfaces/
│   │   └── IAtomX.sol
│   └── libraries/
│       └── Errors.sol         # pengganti errors.rs
├── script/
│   ├── Deploy.s.sol
│   └── InitGlobal.s.sol
├── test/
│   └── AtomX.t.sol
└── foundry.toml
```

### 2.1 Mapping instruksi Anchor → Solidity

Berdasarkan `programs/atomx-program/src/instructions/`:

| Instruksi Anchor (Rust) | Function Solidity |
|---|---|
| `init_global` | `constructor()` / `initialize()` |
| `create_commitment` | `createCommitment(...)` |
| `submit_proof` | `submitProof(uint256 commitmentId, ...)` |
| `complete_commitment` | `completeCommitment(uint256 commitmentId)` |
| `slash` | `slash(uint256 commitmentId)` |
| `redeem` | `redeem(uint256 commitmentId)` |

### 2.2 Mapping state Anchor → Solidity

Berdasarkan `programs/atomx-program/src/state/`:

```solidity
// Pengganti commitment.rs
struct Commitment {
    address owner;
    uint256 amount;        // dalam wei, bukan lamports
    uint256 deadline;
    bool completed;
    bool slashed;
    // ... sesuaikan field dari commitment.rs
}

// Pengganti global_state.rs
struct GlobalState {
    address authority;
    uint256 totalCommitments;
    // ...
}

// Pengganti user_profile.rs
struct UserProfile {
    address user;
    uint256 completedCount;
    uint256 slashedCount;
    // ...
}
```

### 2.3 Konfigurasi `foundry.toml`

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"

[rpc_endpoints]
0g_testnet = "${RPC_URL_0G_TESTNET}"
0g_mainnet = "${RPC_URL_0G_MAINNET}"

[etherscan]
0g_testnet = { key = "${EXPLORER_API_KEY}", url = "https://chainscan-galileo.0g.ai" }
```

### 2.4 Deploy ke 0G Testnet

```bash
cd contracts

# Compile
forge build

# Deploy
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL_0G_TESTNET \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify

# Simpan contract address yang muncul di output!
```

---

## 🔌 FASE 3: Update Integrasi Frontend

### 3.1 Ganti `lib/idl.json` → `lib/abi.json`

Setelah contract di-compile, ambil ABI dari output Foundry:

```bash
# ABI ada di sini setelah forge build
cat contracts/out/AtomX.sol/AtomX.json | jq '.abi' > apps/web/lib/abi.json
```

### 3.2 Buat `lib/contract.ts` (pengganti pola IDL lama)

```typescript
// apps/web/lib/contract.ts
import { ethers } from "ethers";
import abi from "./abi.json";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;

export function getContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, abi, signerOrProvider);
}
```

### 3.3 Rewrite `lib/executeSlash.ts`

**Sebelum (Anchor):**
```typescript
// pattern lama dengan @coral-xyz/anchor
const program = new Program(idl, provider);
await program.methods.slash(...).accounts({...}).rpc();
```

**Sesudah (ethers.js):**
```typescript
// apps/web/lib/executeSlash.ts
import { ethers } from "ethers";
import { getContract } from "./contract";

export async function executeSlash(
  commitmentId: bigint,
  signer: ethers.Signer
): Promise<string> {
  const contract = getContract(signer);
  const tx = await contract.slash(commitmentId);
  const receipt = await tx.wait();
  return receipt.hash;
}
```

### 3.4 Rewrite `lib/mintCompletionMedal.ts`

```typescript
// apps/web/lib/mintCompletionMedal.ts
import { ethers } from "ethers";
import { getContract } from "./contract";

export async function mintCompletionMedal(
  commitmentId: bigint,
  signer: ethers.Signer
): Promise<string> {
  const contract = getContract(signer);
  const tx = await contract.completeCommitment(commitmentId);
  const receipt = await tx.wait();
  return receipt.hash;
}
```

### 3.5 Rewrite `components/providers/WalletProvider.tsx`

**Sebelum (Solana wallet adapter):**
```tsx
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
```

**Sesudah (wagmi + RainbowKit):**
```tsx
// apps/web/components/providers/WalletProvider.tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

const ogTestnet = {
  id: 16600,                                    // cek Chain ID 0G terbaru
  name: "0G Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL_0G!] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
};

const config = createConfig({
  chains: [ogTestnet],
  transports: { [ogTestnet.id]: http() },
});

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

### 3.6 Rewrite `components/WalletButton.tsx`

```tsx
// apps/web/components/WalletButton.tsx
"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletButton() {
  return <ConnectButton />;
}
```

> Kalau mau custom UI, pakai `useAccount`, `useConnect`, `useDisconnect` dari wagmi.

### 3.7 Cek `hooks/useCommitments.ts`

Buka file ini dan cari pattern Solana:
- `useConnection`, `useWallet` → ganti ke `usePublicClient`, `useAccount` dari wagmi
- `program.account.commitment.fetch()` → ganti ke `contract.getCommitment(id)`
- `PublicKey` → ganti ke string address EVM

### 3.8 Cek `app/api/swap/route.ts`

Buka dan cek apakah pakai Jupiter (Solana DEX):
- Kalau iya → perlu diganti ke DEX yang ada di 0G, atau dihapus jika belum ada
- Kalau tidak → aman

---

## 🔔 FASE 4: Ganti Webhook Helius → 0G

File `app/api/webhooks/helius/route.ts` perlu disesuaikan karena Helius adalah Solana-only.

**Opsi:**
1. **0G memiliki indexer/webhook** → pindah ke event listener 0G
2. **Pakai event polling** → buat cron yang baca events dari contract EVM

Pola polling events EVM (bisa jadi cron baru):

```typescript
// Contoh: listen event dari EVM contract
import { ethers } from "ethers";
import { getContract } from "@/lib/contract";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_0G);
const contract = getContract(provider);

// Listen event CommitmentCompleted
contract.on("CommitmentCompleted", (commitmentId, owner, event) => {
  // logic yang sebelumnya dipicu oleh Helius webhook
});
```

> Rename folder `webhooks/helius` → `webhooks/0g` atau `events/onchain` sesuai flow baru.

---

## 🔑 FASE 5: Update Environment Variables

### `apps/web/.env.local`:

```bash
# ❌ HAPUS variabel Solana
# NEXT_PUBLIC_SOLANA_RPC_URL=...
# NEXT_PUBLIC_PROGRAM_ID=...
# HELIUS_API_KEY=...
# HELIUS_WEBHOOK_SECRET=...

# ✅ TAMBAH variabel 0G & EVM
NEXT_PUBLIC_RPC_URL_0G=https://evmrpc-testnet.0g.ai
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...          # isi setelah deploy
NEXT_PUBLIC_CHAIN_ID=16600
DEPLOYER_PRIVATE_KEY=your_private_key       # untuk server-side signing (cron/slash)
EXPLORER_API_KEY=...                         # untuk verify contract
```

---

## ✅ FASE 6: Verifikasi & Testing

### 6.1 Checklist sebelum run

```bash
# Pastiin tidak ada import Solana tersisa
grep -r "@solana" apps/web/app apps/web/components apps/web/lib apps/web/hooks
grep -r "@coral-xyz" apps/web/app apps/web/components apps/web/lib apps/web/hooks
grep -r "anchor" apps/web/lib apps/web/hooks

# Harusnya output kosong
```

### 6.2 Build check

```bash
cd apps/web
npm run build
```

### 6.3 Test alur utama secara manual

- [ ] Wallet connect (MetaMask / wallet EVM)
- [ ] Create commitment → transaksi masuk ke 0G
- [ ] Submit proof → data tersimpan
- [ ] Complete commitment → medal ter-mint
- [ ] Slash → token terpotong
- [ ] Redeem → token kembali

### 6.4 Jalankan backend tests yang masih relevan

```bash
# Test backend (Supabase, API) tidak perlu diubah
cd apps/web
npx vitest run tests/backend/
```

---

## 📋 Urutan Pengerjaan yang Disarankan

```
1. [FASE 1] Bersihkan file Solana dulu
2. [FASE 2] Tulis & deploy smart contract ke testnet → dapatkan contract address
3. [FASE 3.1] Generate ABI dari contract
4. [FASE 3.2] Buat lib/contract.ts
5. [FASE 3.5] Setup WalletProvider dulu → pastikan wallet connect jalan
6. [FASE 3.6] WalletButton → tampil di UI
7. [FASE 3.3] executeSlash.ts
8. [FASE 3.4] mintCompletionMedal.ts
9. [FASE 3.7] Cek useCommitments.ts
10. [FASE 3.8] Cek swap/route.ts
11. [FASE 4] Ganti webhook Helius
12. [FASE 5] Update .env
13. [FASE 6] Verifikasi & testing
```

---

## 🚫 Yang TIDAK Boleh Disentuh

```
apps/web/lib/supabaseAdmin.ts
apps/web/app/api/commitments/
apps/web/app/api/cron/
apps/web/app/api/medals/
apps/web/app/api/validate-proof/
apps/web/components/dashboard/   (semua UI)
apps/web/components/landing-page/ (semua UI)
supabase_cron.sql
vercel.json
```