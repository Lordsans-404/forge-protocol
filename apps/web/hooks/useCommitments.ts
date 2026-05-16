'use client';

import { useAccount, usePublicClient } from 'wagmi';
import { useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getContract } from '@/lib/contract';

export interface CommitmentData {
  publicKey: string; // Used as unique identifier (contract commitmentId or address)
  owner: string;
  commitmentId: number[];
  title: string;
  category: string;
  description: string;
  stakeAmount: number;
  remainingStake: number;
  durationDays: number;
  dailyTargetMinutes: number;
  currentDay: number;
  failedCount: number;
  earlyFinishCount: number;
  proofCount: number;
  status: string;
  isRedemption: boolean;
  createdAt: number;
  expectedDay: number;
  missedDays: number;
  isOverdue: boolean;
}

export function useCommitments() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [commitments, setCommitments] = useState<CommitmentData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCommitments = useCallback(async () => {
    if (!address || !publicClient) return;

    try {
      setIsLoading(true);

      // Fetch metadata from Supabase
      const response = await fetch(`/api/commitments?owner=${address}`);
      let titleMap: Record<string, any> = {};
      if (response.ok) {
        const json = await response.json();
        // Guard against API returning an error object instead of a metadata map
        if (json && typeof json === 'object' && !json.error) {
          titleMap = json;
        } else if (json?.error) {
          console.error('[useCommitments] API returned error:', json.error);
        }
      } else {
        console.error('[useCommitments] Failed to fetch from /api/commitments:', response.status, response.statusText);
      }

      const entryCount = Object.keys(titleMap).length;
      console.log(`[useCommitments] Supabase returned ${entryCount} commitment(s) for wallet ${address?.substring(0, 8)}...`);
      if (entryCount === 0) {
        console.warn('[useCommitments] No commitments found in Supabase. If you created commitments, check /api/debug/commitments?owner=' + address);
      }

      // For EVM, we iterate over the commitments we know from Supabase
      // and fetch their real-time on-chain state.
      const parsed: CommitmentData[] = [];
      const rpcUrl = process.env.NEXT_PUBLIC_EVM_RPC_URL || 'https://evmrpc-testnet.0g.ai';
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = getContract(provider);

      for (const [pdaOrId, metadata] of Object.entries(titleMap) as any) {
        try {
          // Skip corrupted entries: tx hashes (0x...) or non-numeric strings (Solana pubkeys, etc.)
          // EVM uint256 commitment IDs are keccak256 hashes stored as decimal strings — up to 78 digits.
          // We can't use Number() here (loses precision beyond 15 digits). Use BigInt parsing instead.
          if (typeof pdaOrId !== 'string' || pdaOrId.trim() === '' || pdaOrId.startsWith('0x')) {
            console.warn('Skipping invalid onchain_id (non-numeric or hex):', pdaOrId);
            continue;
          }
          let commitIdBigInt: bigint;
          try {
            commitIdBigInt = BigInt(pdaOrId);
          } catch {
            console.warn('Skipping invalid onchain_id (not a valid integer):', pdaOrId);
            continue;
          }
          const data = await contract.getCommitment(commitIdBigInt);

          // If owner is zero address, this ID doesn't exist on-chain — skip it
          if (!data || !data.owner || data.owner === '0x0000000000000000000000000000000000000000') {
            console.warn(`Commitment ID ${pdaOrId} not found on-chain — stale Supabase row, skipping.`);
            continue;
          }

          if (data.owner.toLowerCase() !== address.toLowerCase()) continue;

          let status = 'unknown';
          if (data.status === BigInt(0)) status = 'active';
          else if (data.status === BigInt(1)) status = 'completed';
          else if (data.status === BigInt(2)) status = 'failed';
          else if (data.status === BigInt(3)) status = 'redemption';

          const createdAt = Number(data.createdAt);
          const nowUnix = Math.floor(Date.now() / 1000);
          const daysSinceCreation = Math.floor((nowUnix - createdAt) / 86400);
          const expectedDay = Math.min(daysSinceCreation, Number(data.durationDays));
          const currentDay = Number(data.currentDay);
          const missedDays = Math.max(0, expectedDay - currentDay);

          parsed.push({
            publicKey: pdaOrId, // Maintain compatibility
            owner: data.owner,
            commitmentId: [Number(commitIdBigInt)], // Simplification
            title: metadata.title || `Commitment #${String(pdaOrId).substring(0, 6)}`,
            category: metadata.category || 'Other',
            description: metadata.description || '',
            stakeAmount: Number(ethers.formatUnits(data.stakeAmount, 18)),
            remainingStake: Number(ethers.formatUnits(data.remainingStake, 18)),
            durationDays: Number(data.durationDays),
            dailyTargetMinutes: Number(data.dailyTargetMinutes),
            currentDay,
            failedCount: Number(data.failedCount),
            earlyFinishCount: Number(data.earlyFinishCount),
            proofCount: Number(data.proofCount),
            status,
            isRedemption: data.isRedemption,
            createdAt,
            expectedDay,
            missedDays,
            isOverdue: status === 'active' && missedDays > 0,
          });
        } catch (err) {
          console.warn(`Failed to fetch on-chain data for ${pdaOrId}`, err);
        }
      }

      setCommitments(parsed);
    } catch (err) {
      console.error('Error fetching commitments:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchCommitments();
  }, [fetchCommitments]);

  return { commitments, isLoading, refetch: fetchCommitments };
}
