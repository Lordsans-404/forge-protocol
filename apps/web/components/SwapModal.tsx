'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAccount, useBalance, useSendTransaction, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';

import { X, ArrowDownUp, Loader2, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';

/** Minimum 0G required per swap — enough to be meaningful but low for devnet testing */
const MIN_0G_AMOUNT = 0.01;

/** 0G buffer kept in wallet so user can still pay future gas fees */
const GAS_RESERVE_0G = 0.005;

/** Authority wallet that receives 0G and acts as USDT mint authority */
const AUTHORITY_PUBKEY = process.env.NEXT_PUBLIC_EVM_AUTHORITY_ADDRESS ?? '';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type SwapStatus = 'idle' | 'awaiting-signature' | 'confirming' | 'minting' | 'success' | 'error';

/**
 * SwapModal implements a two-phase devnet 0G → USDT exchange:
 *   Phase 1 — User signs a real 0G transfer to the authority wallet (on-chain proof of payment).
 *   Phase 2 — Backend verifies the transfer on-chain, then mints equivalent USDT to the user.
 *
 * This mirrors a real DEX flow without deploying a custom swap contract.
 */
export default function SwapModal({ isOpen, onClose }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  
  const { data: balanceData, refetch: refetchBalance } = useBalance({
    address: address,
  });

  const { sendTransactionAsync } = useSendTransaction();

  const [ogAmount, setOgAmount] = useState<string>('0.1');
  const [status, setStatus] = useState<SwapStatus>('idle');
  const [mintTxSig, setMintTxSig] = useState<string | null>(null);
  const [ogTxSig, setOgTxSig] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ogToUsdtRate, setOgToUsdtRate] = useState<number | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState<boolean>(true);

  const ogBalance = balanceData ? parseFloat(formatEther(balanceData.value)) : null;

  /** Derived USDT output amount from the current 0G input */
  const usdtOutput = ogToUsdtRate ? parseFloat(ogAmount || '0') * ogToUsdtRate : 0;

  const parsedOg = parseFloat(ogAmount);
  const isValidAmount =
    !isNaN(parsedOg) &&
    parsedOg >= MIN_0G_AMOUNT &&
    ogBalance !== null &&
    parsedOg <= ogBalance - GAS_RESERVE_0G;

  /** Fetches the real-time SOL/0G → USDT rate from CoinGecko API */
  const fetchRate = useCallback(async () => {
    try {
      setIsFetchingRate(true);
      // Since 0G might not be on CoinGecko yet, we mock the rate or use SOL's rate for testing parity
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      if (data?.solana?.usd) {
        setOgToUsdtRate(data.solana.usd);
      } else {
        throw new Error('Invalid data format from CoinGecko');
      }
    } catch (err) {
      console.error('Failed to fetch price, using fallback rate 150:', err);
      setOgToUsdtRate(150);
    } finally {
      setIsFetchingRate(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchRate();
      if (address) {
        refetchBalance();
      }
    }
  }, [isOpen, address, refetchBalance, fetchRate]);

  // Reset all state when modal is dismissed
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStatus('idle');
        setMintTxSig(null);
        setOgTxSig(null);
        setErrorMsg(null);
        setOgAmount('0.1');
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSwap = async () => {
    if (!AUTHORITY_PUBKEY) {
      setErrorMsg('System Error: NEXT_PUBLIC_EVM_AUTHORITY_ADDRESS is not set.');
      setStatus('error');
      return;
    }
    
    if (!address || !isValidAmount || !publicClient) return;

    setErrorMsg(null);
    setMintTxSig(null);
    setOgTxSig(null);

    try {
      // ── Phase 1: Transfer 0G from user to authority ──────────────────────
      setStatus('awaiting-signature');

      const hash = await sendTransactionAsync({
        to: AUTHORITY_PUBKEY as `0x${string}`,
        value: parseEther(parsedOg.toString()),
      });

      setOgTxSig(hash);

      // ── Phase 2: Wait for on-chain confirmation ───────────────────────────
      setStatus('confirming');

      // Wait for the transaction to be mined before calling the backend
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash,
        retryCount: 20,
        retryDelay: 2000
      });
      
      if (receipt.status !== 'success') {
        throw new Error('Transaction reverted on-chain.');
      }
      
      // ── Phase 3: Backend verifies transfer and mints USDT ─────────────────
      setStatus('minting');

      const response = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          transactionHash: hash,
          usdtAmount: usdtOutput,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'USDT transfer failed after 0G transfer.');
      }

      setMintTxSig(data.txSignature);
      setStatus('success');
      refetchBalance();
    } catch (err: any) {
      const message =
        err?.message?.includes('User rejected') || err?.name === 'UserRejectedRequestError'
          ? 'Transaction cancelled. No 0G was transferred.'
          : err?.message || 'An unexpected error occurred.';
      setErrorMsg(message);
      setStatus('error');
    }
  };

  const loadingLabel: Record<string, string> = {
    'awaiting-signature': 'Approve in wallet...',
    confirming: 'Confirming transfer...',
    minting: 'Sending USDT...',
  };

  const isLoading =
    status === 'awaiting-signature' || status === 'confirming' || status === 'minting';

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_0_60px_rgba(78,222,163,0.12)] backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <ArrowDownUp className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-playfair text-xl font-bold text-white">Get USDT</h2>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">0G Testnet</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-surface-container-high hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-2 rounded-xl border border-secondary/20 bg-secondary/10 px-3 py-2.5">
            <Zap className="h-4 w-4 shrink-0 text-secondary" />
            <p className="text-xs leading-5 text-secondary/90">
              <strong>Testnet.</strong> Swap native 0G token for testnet USDT.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-surface-container-high/70 p-4">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                You Send
              </label>
              {ogBalance !== null && (
                <button
                  className="text-xs font-medium text-primary/80 transition-colors hover:text-primary"
                  onClick={() =>
                    setOgAmount(Math.max(0, ogBalance - GAS_RESERVE_0G).toFixed(3))
                  }
                  disabled={isLoading}
                >
                  Max: {ogBalance.toFixed(3)} 0G
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2">
                <span className="text-sm font-bold text-white">0G</span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={ogAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    setOgAmount(val);
                  }
                }}
                className="flex-1 w-full min-w-0 appearance-none bg-transparent text-right text-2xl font-bold text-white outline-none"
                placeholder="0.1"
                disabled={isLoading || status === 'success'}
              />
            </div>
          </div>

          <div className="flex justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/70">
              <ArrowDownUp className="h-4 w-4 text-muted-foreground/70" />
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/10 p-4">
            <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              You Receive
            </label>
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
                <span className="text-sm font-bold text-primary">$</span>
                <span className="text-sm font-bold text-white">USDT</span>
              </div>
              <span className="flex-1 text-right text-2xl font-bold text-primary">
                {usdtOutput > 0
                  ? usdtOutput.toLocaleString('en-US', { maximumFractionDigits: 2 })
                  : '0'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <p className="text-center text-xs text-muted-foreground">
              Rate: 1 0G = {isFetchingRate ? '...' : ogToUsdtRate?.toFixed(2)} USDT
            </p>
            {isFetchingRate && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>

          {isLoading && (
            <div className="flex items-center justify-between px-2">
              {['awaiting-signature', 'confirming', 'minting'].map((step, i) => (
                <React.Fragment key={step}>
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                      status === step
                        ? 'bg-primary border-primary text-primary-foreground'
                        : ['awaiting-signature', 'confirming', 'minting'].indexOf(status) > i
                        ? 'bg-primary/20 border-primary/45 text-primary'
                        : 'bg-surface-container-high/70 border-border text-muted-foreground'
                    }`}>
                      {i + 1}
                    </div>
                    <span className="text-center text-[9px] text-muted-foreground">
                      {['Sign', 'Confirm', 'Receive'][i]}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className={`flex-1 h-px mx-1 transition-all ${
                      ['awaiting-signature', 'confirming', 'minting'].indexOf(status) > i
                        ? 'bg-primary/35'
                        : 'bg-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {status === 'success' && mintTxSig && (
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm font-semibold text-primary">
                  {usdtOutput.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT sent to your wallet!
                </p>
              </div>
              <div className="space-y-1">
                {ogTxSig && (
                  <a
                    href={`https://chainscan-galileo.0g.ai/tx/${ogTxSig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-white"
                  >
                    0G Transfer: {ogTxSig.slice(0, 24)}...
                  </a>
                )}
                <a
                  href={`https://chainscan-galileo.0g.ai/tx/${mintTxSig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-white"
                >
                  USDT Transfer: {mintTxSig.slice(0, 24)}...
                </a>
              </div>
            </div>
          )}

          {status === 'error' && errorMsg && (
            <div className="flex items-start gap-2 rounded-2xl border border-error/25 bg-error/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
              <p className="text-sm text-error">{errorMsg}</p>
            </div>
          )}

          {!isValidAmount && status === 'idle' && parsedOg > 0 && (
            <p className="text-center text-xs text-secondary/90">
              {ogBalance !== null && parsedOg > ogBalance - GAS_RESERVE_0G
                ? `Keep at least ${GAS_RESERVE_0G} 0G for gas fees.`
                : `Minimum swap is ${MIN_0G_AMOUNT} 0G.`}
            </p>
          )}

          {status === 'success' ? (
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-primary py-4 font-bold uppercase tracking-[0.12em] text-primary-foreground transition-[background-color,transform,box-shadow] hover:bg-primary/90 active:scale-[0.98] shadow-[0_0_20px_rgba(78,222,163,0.24)]"
            >
              Done — USDT Added ✓
            </button>
          ) : (
            <button
              onClick={handleSwap}
              disabled={!address || !isValidAmount || isLoading || isFetchingRate || ogToUsdtRate === null}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-bold uppercase tracking-[0.12em] text-primary-foreground transition-[background-color,transform,box-shadow] hover:bg-primary/90 active:scale-[0.98] shadow-[0_0_20px_rgba(78,222,163,0.24)] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {loadingLabel[status]}
                </>
              ) : (
                <>
                  <ArrowDownUp className="w-5 h-5" />
                  Swap 0G → USDT
                </>
              )}
            </button>
          )}

          {!address && (
            <p className="text-center text-xs text-muted-foreground">Connect your EVM wallet to swap.</p>
          )}
        </div>
      </div>
    </div>
  );
}
