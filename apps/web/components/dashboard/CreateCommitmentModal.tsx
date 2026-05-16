'use client';

import React, { useState } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { parseEther, formatEther, decodeEventLog, type TransactionReceipt } from 'viem';
import { X, Loader2 } from 'lucide-react';

const USDT_ADDRESS = process.env.NEXT_PUBLIC_EVM_MOCK_USDT_ADDRESS as `0x${string}`;
const PROTOCOL_ADDRESS = process.env.NEXT_PUBLIC_EVM_FORGE_PROTOCOL_ADDRESS as `0x${string}`;

const USDT_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

const FORGE_ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "stakeAmount", "type": "uint256" },
      { "internalType": "uint16", "name": "durationDays", "type": "uint16" },
      { "internalType": "uint16", "name": "dailyTargetMinutes", "type": "uint16" }
    ],
    "name": "createCommitment",
    "outputs": [{ "internalType": "uint256", "name": "commitmentId", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "owner", "type": "address" },
      { "indexed": true, "internalType": "uint256", "name": "commitmentId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "stakeAmount", "type": "uint256" },
      { "indexed": false, "internalType": "uint16", "name": "durationDays", "type": "uint16" },
      { "indexed": false, "internalType": "uint16", "name": "dailyTargetMinutes", "type": "uint16" }
    ],
    "name": "CommitmentCreated",
    "type": "event"
  }
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateCommitmentModal({ isOpen, onClose, onSuccess }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: usdtBalanceWei } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query: {
      enabled: !!address && !!USDT_ADDRESS
    }
  });

  const usdtBalance = usdtBalanceWei ? parseFloat(formatEther(usdtBalanceWei)) : 0;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Fitness');
  const [description, setDescription] = useState('');
  const [daysTotal, setDaysTotal] = useState(7);
  const [dailyMinutes, setDailyMinutes] = useState(30);
  const [stakeAmount, setStakeAmount] = useState(10);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Robust receipt poller — avoids TransactionReceiptNotFoundError on slow 0G RPC nodes.
  // Polls every 3s for up to 90s before giving up.
  const pollForReceipt = async (hash: `0x${string}`): Promise<TransactionReceipt> => {
    const MAX_ATTEMPTS = 30;
    const DELAY_MS = 3000;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const receipt = await publicClient!.getTransactionReceipt({ hash });
        if (receipt) return receipt;
      } catch {
        // receipt not indexed yet — keep polling
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
    throw new Error('Transaction timed out after 90s. Please check the explorer and try again.');
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !publicClient) {
      setError('Please connect your EVM wallet first.');
      return;
    }

    if (daysTotal < 7) {
      setError('Commitment must be at least 7 days.');
      return;
    }

    if (dailyMinutes < 10) {
      setError('Daily target must be at least 10 minutes.');
      return;
    }

    if (stakeAmount > usdtBalance) {
      setError(`Insufficient balance. You only have ${usdtBalance.toFixed(2)} USDT.`);
      return;
    }

    if (!USDT_ADDRESS || !PROTOCOL_ADDRESS) {
      setError('System Error: EVM contract addresses are not configured.');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const stakeAmountWei = parseEther(stakeAmount.toString());

      // 1. Approve USDT
      setLoadingStatus('Step 1/2: Approving USDT... (confirm in wallet)');
      console.log('📝 Requesting USDT approval...');
      const approveHash = await writeContractAsync({
        address: USDT_ADDRESS,
        abi: USDT_ABI,
        functionName: 'approve',
        args: [PROTOCOL_ADDRESS, stakeAmountWei],
      });
      
      setLoadingStatus('Step 1/2: Waiting for approval to be indexed...');
      console.log('Polling for approval receipt:', approveHash);
      await pollForReceipt(approveHash);

      // 2. Create Commitment on EVM
      setLoadingStatus('Step 2/2: Creating commitment... (confirm in wallet)');
      console.log('📝 Creating commitment on ForgeProtocol...');
      const createHash = await writeContractAsync({
        address: PROTOCOL_ADDRESS,
        abi: FORGE_ABI,
        functionName: 'createCommitment',
        args: [stakeAmountWei, daysTotal, dailyMinutes],
      });
      
      setLoadingStatus('Step 2/2: Waiting for commitment to be indexed...');
      console.log('Polling for createCommitment receipt:', createHash);
      const receipt = await pollForReceipt(createHash);

      if (receipt.status !== 'success') {
        throw new Error('Transaction reverted on the blockchain.');
      }

      // 3. Extract commitmentId from the emitted Event Logs
      let commitmentId = '';
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: FORGE_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'CommitmentCreated') {
            commitmentId = decoded.args.commitmentId.toString();
            break;
          }
        } catch(e) {
          // Ignore logs from other contracts or events
        }
      }

      if (!commitmentId) {
        throw new Error("Commitment created on-chain but failed to parse ID from logs.");
      }

      console.log('✅ EVM Transaction success! Commitment ID:', commitmentId);

      setLoadingStatus('Saving to database...');
      console.log('💾 Saving commitment metadata to Supabase...');

      const dbPayload = {
        onchainId: commitmentId,
        owner: address,
        title: title,
        category: category,
        description: description,
        txHash: createHash,
        durationDays: daysTotal,
        dailyTargetMinutes: dailyMinutes,
        stakeAmount: stakeAmount,
      };
      console.log('DB Payload:', dbPayload);

      const dbRes = await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload),
      });

      const dbJson = await dbRes.json();
      if (!dbRes.ok) {
        // Log the error but don't block the success — the on-chain tx is confirmed.
        console.error('⚠️ Supabase save failed:', dbJson);
        setError(`Commitment created on-chain (ID: ${commitmentId}), but database sync failed: ${dbJson.error || dbRes.status}. Please contact support.`);
      } else {
        console.log('✅ Supabase saved:', dbJson);
      }

      // Trigger EVM Onchain Event Processor (non-blocking)
      fetch('/api/events/onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHash: createHash }),
      }).catch(err => console.warn('EVM Webhook sync error (non-critical):', err));

      onSuccess();
    } catch (err: any) {
      console.error('Error creating commitment:', err);
      const msg = err?.message || 'Unknown error';
      if (msg.includes('User rejected') || err?.name === 'UserRejectedRequestError') {
        setError('Transaction was cancelled in your wallet.');
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"> {/* updated, keep the modal overlay consistent with the new dashboard shell */}
      {/* updated, restyle the modal frame with Stitch surfaces and mobile-safe scrolling */}
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card/95 p-5 shadow-[0_0_50px_rgba(78,222,163,0.12)] backdrop-blur-md sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* updated, align the close action with the new focus and surface system */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-surface-container-high hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="mb-2 font-playfair text-2xl font-bold text-white sm:text-[28px]">New Commitment</h2> {/* updated, move the modal title onto the Stitch display scale */}
        <p className="mb-6 max-w-xl text-sm leading-6 text-muted-foreground">Lock your USDC to guarantee your discipline.</p> {/* updated, use muted system copy for the modal intro */}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">What habit do you want to build?</label> {/* updated, normalize modal labels to the Stitch label system */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
              placeholder="e.g. Morning Run 5KM"
              maxLength={32}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Habit Category</label> {/* updated, keep label sizing consistent across split fields */}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
              >
                <option value="Fitness">Fitness</option>
                <option value="Study">Study</option>
                <option value="Work">Work</option>
                <option value="Health">Health</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Describe the specific activity</label> {/* updated, use the same Stitch field label treatment */}
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
                placeholder="Briefly describe your goal"
                maxLength={200}
              />
            </div>
          </div>
          <p className="-mt-2 rounded-xl border border-secondary/20 bg-secondary/10 px-3 py-2 text-xs leading-5 text-secondary/90"> {/* updated, present the AI note as a Stitch inline callout */}
            🤖 <strong>Note:</strong> Title, Category, and Description will be used by our AI Auditor to validate your daily proofs. Please provide accurate details.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Commitment Duration (Days)</label> {/* updated, align numeric field labels with the new modal system */}
              <input
                type="number"
                value={daysTotal}
                onChange={(e) => setDaysTotal(Number(e.target.value))}
                className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
                min={7}
                max={365}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Daily Target (Minutes)</label> {/* updated, normalize the numeric label styling */}
              <input
                type="number"
                value={dailyMinutes}
                onChange={(e) => setDailyMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
                min={10}
                required
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">USDT Stake Amount</label>
              <span className="text-[11px] font-medium text-primary/80">Available: {usdtBalance.toFixed(2)} USDT</span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-border bg-surface-container-high/70 px-4 py-3 pl-10 text-white outline-none transition-[border-color,background-color,box-shadow] focus:border-primary/50 focus:bg-surface-container focus:ring-2 focus:ring-primary/20"
                min={1}
                max={Math.floor(usdtBalance)}
                step={0.01}
                required
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-primary">$</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-secondary/90">
              *Warning: This amount will be locked in the smart contract. If you fail, it will be slashed.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-error/25 bg-error/10 p-3 text-sm text-error"> {/* updated, map validation errors to the shared error palette */}
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 font-bold uppercase tracking-[0.12em] text-primary-foreground transition-[background-color,transform,box-shadow] hover:bg-primary/90 active:scale-[0.98] shadow-[0_0_20px_rgba(78,222,163,0.24)] disabled:pointer-events-none disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{loadingStatus || 'Processing...'}</span>
              </>
            ) : (
              'Lock Stake & Start'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
