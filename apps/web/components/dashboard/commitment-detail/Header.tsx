'use client';

import React from 'react';
import { ShieldCheck, Sunset, LayoutList, FileText, Clock, Calendar, Flag, XCircle } from 'lucide-react';
import { GrowthGallery } from './GrowthGallery';

interface CommitmentHeaderProps {
    title: string;
    category: string;
    description: string;
    targetMinutes: number;
    stakeAmount: number;
    daysCompleted: number;
    daysTotal: number;
    remainingStake: number;
    failedCount: number;
    earlyFinishCount: number;
    statusLabel: string;
    walletAddress?: string;
}

/**
 * CommitmentHeader component displays the main information and progress of a commitment
 */
export const CommitmentHeader: React.FC<CommitmentHeaderProps> = ({
    title,
    category,
    description,
    targetMinutes,
    stakeAmount,
    daysCompleted,
    daysTotal,
    remainingStake,
    failedCount,
    earlyFinishCount,
    statusLabel,
    walletAddress,
}) => {
    const maxFailures = daysTotal <= 7 ? 1 : 2;

    return (
        <>
            {/* Stake Card */}
            <div className="bg-card rounded-2xl border border-white/5 p-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-primary/10 transition-all"></div>
                <div className="flex items-center justify-between mb-6">
                    <span className="font-label-caps text-label-caps text-muted-foreground">CURRENT STAKE</span>
                </div>
                <div className="flex items-baseline gap-2">
                    <span className="font-display-timer text-4xl text-foreground font-mono">{(stakeAmount / 1e18).toFixed(2)}</span>
                    <span className="font-headline-card text-muted-foreground">USDT</span>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-primary">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="font-body-main">Smart Contract Locked</span>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-card rounded-2xl border border-white/5 p-5">
                    <span className="font-label-caps text-label-caps text-muted-foreground block mb-3">Failures</span>
                    <div className="flex items-center gap-3">
                        <span className="font-display-timer text-3xl text-error font-mono">{failedCount}<span className="text-muted-foreground text-xl">/{maxFailures}</span></span>
                        <XCircle className="w-5 h-5 text-error" />
                        <div className="flex gap-1 ml-auto">
                            <div className={`w-2 h-2 rounded-full ${failedCount > 0 ? 'bg-error' : 'bg-white/10'}`}></div>
                            {maxFailures > 1 && (
                                <div className={`w-2 h-2 rounded-full ${failedCount > 1 ? 'bg-error' : 'bg-white/10'}`}></div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="bg-card rounded-2xl border border-white/5 p-5">
                    <span className="font-label-caps text-label-caps text-muted-foreground block mb-3">Early Finish</span>
                    <div className="flex items-center gap-3">
                        <span className="font-display-timer text-3xl text-streak-orange font-mono">{earlyFinishCount}</span>
                        <Sunset className="w-5 h-5 text-streak-orange" />
                    </div>
                </div>
            </div>

            {/* Habit Details */}
            <div className="bg-card rounded-2xl border border-white/5 p-6 space-y-6">
                <h3 className="font-headline-card text-lg text-foreground border-b border-white/5 pb-4">Habit Details</h3>
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <LayoutList className="w-4 h-4" />
                            <span className="font-body-main text-sm">Category</span>
                        </div>
                        <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-label-caps uppercase">{category}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <FileText className="w-4 h-4" />
                            <span className="font-body-main text-sm">Description</span>
                        </div>
                        <span className="text-foreground font-body-main text-sm max-w-[150px] text-right truncate" title={description}>{description}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            <span className="font-body-main text-sm">Daily Commitment</span>
                        </div>
                        <span className="text-foreground font-body-main text-sm">{targetMinutes} mins/day</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <Calendar className="w-4 h-4" />
                            <span className="font-body-main text-sm">Duration</span>
                        </div>
                        <span className="text-foreground font-body-main text-sm">{daysTotal} Days Streak</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <Flag className="w-4 h-4" />
                            <span className="font-body-main text-sm">Status</span>
                        </div>
                        <span className={`font-body-main text-sm font-semibold ${statusLabel === 'Active' ? 'text-primary' : statusLabel === 'Completed' ? 'text-blue-400' : 'text-error'}`}>{statusLabel}</span>
                    </div>
                </div>
            </div>

            <GrowthGallery walletAddress={walletAddress} />
        </>
    );
};
