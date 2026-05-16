import { useState, useRef } from 'react';
import { ethers } from 'ethers';
import { getContract } from '@/lib/contract';

export interface AIResult {
  isValid: boolean;
  confidenceScore: number;
  minutes: number;
  activity: string;
  relevance: string;
  reason: string;
}

export function useProofSubmission(
  onchainId: string, // formerly pda
  commitment: any, 
  title: string, 
  category: string, 
  description: string,
  targetMinutes: number,
  minimumMinutes: number,
  elapsedMinutes: number,
  connection: any, // kept for legacy compatibility signature
  wallet: any, // kept for legacy compatibility signature
  onSuccess: () => void
) {
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [proofHash, setProofHash] = useState<string>(''); // EVM uses string for hash
  const [actualMinutes, setActualMinutes] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('File too large. Maximum size is 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setProofImage(reader.result as string);
      setSubmitError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleValidateProof = async (onValidating: () => void, onResult: () => void, onUploadError: () => void) => {
    if (!proofImage) return;

    if (elapsedMinutes < minimumMinutes) {
      setSubmitError(`Timer duration insufficient (${elapsedMinutes}/${minimumMinutes} min). Go back and continue.`);
      return;
    }

    onValidating();
    setSubmitError(null);

    try {
      const res = await fetch('/api/validate-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: proofImage,
          onchainId, // added to link the proof hash to DB
          targetMinutes,
          elapsedMinutes,
          commitmentTitle: title,
          commitmentCategory: category,
          commitmentDescription: description,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setAiResult(data.aiResult);
        // EVM proofHash must be a string. If the API returns an array, convert it to a hex string.
        let pHash = data.proofHash;
        if (Array.isArray(pHash)) {
          pHash = ethers.hexlify(new Uint8Array(pHash));
        } else if (typeof pHash !== 'string') {
          pHash = String(pHash);
        }
        setProofHash(pHash);
        setActualMinutes(data.actualMinutes);
        onResult();
      } else {
        setSubmitError(data.error || 'AI validation failed');
        onUploadError();
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Validation request failed');
      onUploadError();
    }
  };

  const handleSubmitOnChain = async () => {
    if (!commitment || !aiResult || !onchainId) return;

    if (!aiResult.isValid) {
      setSubmitError('Invalid proof. Please upload a matching activity proof.');
      return;
    }
    if (elapsedMinutes < minimumMinutes) {
      setSubmitError('Timer duration does not meet minimum requirements.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!(window as any).ethereum) throw new Error('No crypto wallet found');
      
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = getContract(signer);

      const nextDay = (commitment.currentDay || 0) + 1;
      const commitIdBigInt = BigInt(onchainId);

      // Call the EVM smart contract
      const tx = await contract.submitProof(commitIdBigInt, nextDay, proofHash, actualMinutes);
      
      console.log('Proof transaction submitted, waiting for confirmation...', tx.hash);
      await tx.wait();

      // Sync transaction signature via EVM event webhook processor
      fetch('/api/events/onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHash: tx.hash }),
      }).catch(err => console.warn('Webhook sync failed (ignoring):', err));

      setSubmitSuccess(true);
      onSuccess();
    } catch (err: any) {
      console.error('Submit proof error:', err);
      // Format ethers error gracefully
      let errMsg = err.message || 'Failed to submit proof to the blockchain';
      if (err.reason) errMsg = err.reason;
      if (err.info?.error?.message) errMsg = err.info.error.message;
      setSubmitError(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    proofImage,
    setProofImage,
    aiResult,
    setAiResult,
    isSubmitting,
    submitError,
    setSubmitError,
    submitSuccess,
    fileInputRef,
    handleImageSelect,
    handleValidateProof,
    handleSubmitOnChain
  };
}
