import { useState, useEffect } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { ethers } from 'ethers';
import { getContract } from '@/lib/contract';

export function useCommitmentData(pda: string) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  
  const [commitment, setCommitment] = useState<any>(null);
  const [lastProof, setLastProof] = useState<any>(null);
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!address || !pda) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        const rpcUrl = process.env.NEXT_PUBLIC_EVM_RPC_URL || 'https://evmrpc-testnet.0g.ai';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = getContract(provider);
        
        let commitIdBigInt: bigint;
        try {
          commitIdBigInt = BigInt(pda);
        } catch {
          console.warn('Invalid onchain_id (not a bigint):', pda);
          setLoading(false);
          return;
        }

        // Fetch EVM on-chain commitment
        const account = await contract.getCommitment(commitIdBigInt);
        
        // Map the EVM properties to what the UI expects (matching legacy field names)
        const mappedAccount = {
          owner: account.owner,
          stakeAmount: { toNumber: () => Number(account.stakeAmount) },
          remainingStake: { toNumber: () => Number(account.remainingStake) },
          durationDays: Number(account.durationDays),
          dailyTargetMinutes: Number(account.dailyTargetMinutes),
          currentDay: Number(account.currentDay),
          failedCount: Number(account.failedCount),
          earlyFinishCount: Number(account.earlyFinishCount),
          proofCount: Number(account.proofCount),
          status: account.status,
          isRedemption: account.isRedemption,
          createdAt: { toNumber: () => Number(account.createdAt) }, // Legacy getter for UI
          lastProofAt: Number(account.lastProofAt)
        };
        
        setCommitment(mappedAccount);

        // Fetch last proof if any days completed
        if (mappedAccount.currentDay > 0) {
          // In EVM, we fetch the specific proof hash or info via contract or we just let it be empty 
          // because we don't have a specific `proofRecord` PDA anymore.
          // For now, we simulate a basic object so the UI doesn't crash if it expects lastProof to exist.
          setLastProof({
            dayNumber: mappedAccount.currentDay,
            submittedAt: { toNumber: () => mappedAccount.lastProofAt },
            // the proof info is usually checked off-chain in EVM via Supabase daily_proofs
          });
        }

        // Fetch metadata from Supabase
        const res = await fetch(`/api/commitments?owner=${address}`);
        if (res.ok) {
          const metadataMap = await res.json();
          // The API returns a map keyed by onchain_id
          const metadata = metadataMap[pda] || {};
          setTitle(metadata.title || `Commitment #${pda.substring(0, 6)}`);
          setCategory(metadata.category || 'Other');
          setDescription(metadata.description || '');
        }
      } catch (err) {
        console.error('Error fetching commitment:', err);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [address, pda]);

  return { 
    commitment, 
    lastProof, 
    title, 
    category, 
    description, 
    loading, 
    // Return empty objects for legacy connections to avoid breaking the UI
    connection: {}, 
    wallet: { publicKey: address } 
  };
}
