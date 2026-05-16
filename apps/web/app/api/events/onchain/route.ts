import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ethers } from 'ethers';
import { getContract } from '@/lib/contract';
import { mintCompletionMedal } from '@/lib/mintCompletionMedal';

const RPC_URL = process.env.NEXT_PUBLIC_EVM_RPC_URL || 'https://evmrpc-testnet.0g.ai';

// Token ID Cache
const tokenIdCache: Record<string, string> = {};

async function getTokenId(address: string) {
    const addr = address.toLowerCase();
    if (tokenIdCache[addr]) return tokenIdCache[addr];

    const { data: token } = await supabaseAdmin
        .from('tokens')
        .select('id')
        .eq('address', addr)
        .single();
    
    if (token) {
        tokenIdCache[addr] = token.id;
        return token.id;
    }

    // Auto-register common token if missing (Demo fallback)
    const { data: newToken } = await supabaseAdmin
        .from('tokens')
        .insert({ address: addr, symbol: 'USDT', name: 'Tether USD', decimals: 18 })
        .select('id')
        .single();
    
    if (newToken) {
        tokenIdCache[addr] = newToken.id;
        return newToken.id;
    }
    return null;
}

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        let eventsToProcess: any[] = [];

        if (Array.isArray(payload)) {
            eventsToProcess = payload;
        } else if (payload && payload.event) {
            eventsToProcess = [payload.event];
        } else if (payload && payload.transactionHash) {
            // Payload dari CreateCommitmentModal: { transactionHash: '0x...' }
            // Fetch receipt dan decode CommitmentCreated events secara langsung
            const txProvider = new ethers.JsonRpcProvider(RPC_URL);
            const txContract = getContract(txProvider);
            try {
                const receipt = await txProvider.getTransactionReceipt(payload.transactionHash);
                if (receipt) {
                    const forgeInterface = txContract.interface;
                    for (const log of receipt.logs) {
                        try {
                            const parsed = forgeInterface.parseLog({ topics: [...log.topics], data: log.data });
                            if (parsed) {
                                const eventData: any = {};
                                parsed.fragment.inputs.forEach((input: any, idx: number) => {
                                    eventData[input.name] = parsed.args[idx];
                                });
                                eventsToProcess.push({
                                    name: parsed.name,
                                    data: eventData,
                                    transactionHash: payload.transactionHash,
                                });
                            }
                        } catch { /* log dari contract lain — skip */ }
                    }
                }
            } catch (e) {
                console.warn('Could not parse receipt for transactionHash:', payload.transactionHash, e);
            }
        } else {
            return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
        }

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = getContract(provider);
        const defaultTokenAddr = (process.env.NEXT_PUBLIC_EVM_MOCK_USDT_ADDRESS || '0x...').toLowerCase();

        for (const event of eventsToProcess) {
            console.log(`\n✨ Event Terdeteksi: ${event.name}`);

            if (event.name === 'CommitmentCreated') {
                const { data: user } = await supabaseAdmin.from('users').select('id').eq('wallet_address', event.data.owner.toLowerCase()).single();
                const { data: commitment } = await supabaseAdmin.from('commitments').select('id').eq('onchain_id', String(event.data.commitmentId)).single();

                if (user && commitment) {
                    const amount = Number(ethers.formatUnits(event.data.stakeAmount, 18));
                    const tokenId = await getTokenId(defaultTokenAddr);

                    await supabaseAdmin.from('commitment_stakes').insert({
                        commitment_id: commitment.id,
                        user_id: user.id,
                        amount: amount,
                        token_id: tokenId,
                        tx_hash: event.transactionHash,
                        type: 'initial'
                    });
                    console.log('✅ Berhasil mencatat CommitmentStake di DB');
                }
            }
            else if (event.name === 'SlashExecuted') {
                const { data: commitment } = await supabaseAdmin.from('commitments').select('id, user_id').eq('onchain_id', String(event.data.commitmentId)).single();

                if (commitment) {
                    const slashedAmt = Number(ethers.formatUnits(event.data.slashedAmount, 18));
                    const failCount = event.data.failCount;

                    await supabaseAdmin.from('slash_events').insert({
                        commitment_id: commitment.id,
                        user_id: commitment.user_id,
                        slashed_amount: slashedAmt,
                        fail_count_at_slash: failCount,
                        tx_hash: event.transactionHash,
                        reason: 'Daily target not met / validation failed'
                    });
                    console.log('✅ Berhasil mencatat SlashEvent di DB');
                }
            }
            else if (event.name === 'CommitmentCompleted') {
                const { data: commitment } = await supabaseAdmin
                    .from('commitments')
                    .select('id, user_id, title, category, duration_days, users(wallet_address)')
                    .eq('onchain_id', String(event.data.commitmentId))
                    .single();

                const rewardAmt = Number(ethers.formatUnits(event.data.rewardAmount, 18));

                if (commitment) {
                    await supabaseAdmin.from('commitments').update({ status: 'completed' }).eq('id', commitment.id);
                    console.log('✅ Commitment status updated to completed in DB');

                    if (rewardAmt > 0) {
                        const tokenId = await getTokenId(defaultTokenAddr);
                        await supabaseAdmin.from('rewards').insert({
                            commitment_id: commitment.id,
                            user_id: commitment.user_id,
                            reward_type: 'completion', // Now an enum
                            amount: rewardAmt,
                            token_id: tokenId,
                            tx_hash: event.transactionHash,
                            is_claimed: true,
                            claimed_at: new Date().toISOString(),
                        });
                        console.log('✅ Reward claim recorded in DB');
                    }

                    // Mint a unique Champion Medal NFT (off-chain cache)
                    const userWallet = (commitment.users as any)?.wallet_address;
                    if (userWallet) {
                        const championTokenId = 'champ-' + event.data.commitmentId;
                        const championImageUrl = `https://image-place.vercel.app/sertifikat?text=${encodeURIComponent(commitment.title ?? 'Champion')}+%7C+${commitment.duration_days ?? 0}+Days&color=ffd700&bg=1a1a2e00&w=400&h=400&fontsize=32`;
                        await supabaseAdmin.from('nft_index_cache').upsert({
                            token_id: championTokenId,
                            owner_address: userWallet,
                            name: `Champion Medal: ${commitment.title}`,
                            nft_type: 'completion_medal',
                            commitment_id: commitment.id,
                            image_url: championImageUrl,
                            last_synced_at: new Date().toISOString(),
                        }, { onConflict: 'token_id' });
                        console.log('✅ Champion NFT Minted (Off-chain cache)');
                    }
                }
            }
            else if (event.name === 'ProofSubmitted') {
                const { data: commitmentInfo } = await supabaseAdmin.from('commitments')
                    .select('id, users(wallet_address, id),title')
                    .eq('onchain_id', String(event.data.commitmentId))
                    .single();

                if (commitmentInfo && commitmentInfo.users) {
                    const userId = (commitmentInfo.users as any).id;
                    const proofHashHex = event.data.proofHash;

                    if (proofHashHex) {
                        // 1. Create the proof record first to get daily_proof_id
                        const { data: proof } = await supabaseAdmin.from('daily_proofs').insert({
                            commitment_id: commitmentInfo.id,
                            user_id: userId,
                            day_number: event.data.dayNumber,
                            proof_url: 'on-chain-event', // Event doesn't have URL
                            proof_hash: proofHashHex,
                            tx_hash: event.transactionHash,
                            status: 'approved',
                            actual_minutes: event.data.actualMinutes || 0
                        }).select('id').single();

                        if (proof) {
                            await supabaseAdmin.from('proof_hashes').insert({
                                user_id: userId,
                                commitment_id: commitmentInfo.id,
                                daily_proof_id: proof.id,
                                image_hash: proofHashHex
                            });
                            console.log('✅ Berhasil mencatat proof dan image_hash di DB');

                            // Mint Daily Badge NFT (off-chain Supabase cache)
                            const dailyTokenId = (event.transactionHash || proof.id) + '-day' + event.data.dayNumber;
                            const ownerAddr = (commitmentInfo.users as any).wallet_address;
                            const badgeImageUrl = `https://image-place.vercel.app/sertifikat?text=${encodeURIComponent(commitmentInfo.title ?? 'Daily Commit')}+%7C+Day+${event.data.dayNumber}&color=ffd700&bg=1a1a2e00&w=400&h=400&fontsize=32`;

                            await supabaseAdmin.from('nft_index_cache').upsert({
                                token_id: dailyTokenId,
                                owner_address: ownerAddr,
                                name: `Daily Commit - ${commitmentInfo.title} - Day #${event.data.dayNumber}`,
                                nft_type: 'daily_badge',
                                commitment_id: commitmentInfo.id,
                                image_url: badgeImageUrl,
                                last_synced_at: new Date().toISOString(),
                            }, { onConflict: 'token_id' });
                            console.log('✅ Daily Badge NFT cached in Supabase');
                        }
                    }
                }
            }
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('❌ [EVM Event] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
