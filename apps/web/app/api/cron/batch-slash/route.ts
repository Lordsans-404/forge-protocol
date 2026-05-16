import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/cron/batch-slash
 *
 * Runs every 3 days. Finds 'failed' commitments in Supabase that haven't
 * had their on-chain stake slashed yet, and triggers the EVM slash call.
 *
 * Currently: logs eligible targets (on-chain slash call TODO when contract is finalized).
 * Triggered by: Vercel Cron (vercel.json)
 */
export async function GET(request: Request) {
  try {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch failed commitments that may need on-chain slash
    const { data: failedCommitments, error: fetchError } = await supabaseAdmin
      .from('commitments')
      .select('id, user_id, title, onchain_id, stake_amount, failed_count')
      .eq('status', 'failed');

    if (fetchError) {
      console.error('❌ Supabase fetch error:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!failedCommitments || failedCommitments.length === 0) {
      console.log('✅ No failed commitments found for batch slash');
      return NextResponse.json({ evaluated: 0, slashed: 0 });
    }

    console.log(`🔍 Found ${failedCommitments.length} failed commitment(s) for batch slash evaluation`);

    // Check which ones already have a slash event recorded
    const slashedIds = new Set<string>();
    const { data: existingSlashes } = await supabaseAdmin
      .from('slash_events')
      .select('commitment_id')
      .in('commitment_id', failedCommitments.map(c => c.id));

    (existingSlashes ?? []).forEach(s => slashedIds.add(s.commitment_id));

    const pending = failedCommitments.filter(c => !slashedIds.has(c.id));
    console.log(`📋 ${pending.length} commitments pending on-chain slash`);

    // TODO: For each pending commitment, call ForgeProtocol.sol slash() via ethers
    // const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_EVM_RPC_URL);
    // const signer = new ethers.Wallet(process.env.EVM_AUTHORITY_PRIVATE_KEY!, provider);
    // const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    // await contract.slash(commitment.onchain_id);

    return NextResponse.json({
      evaluated: failedCommitments.length,
      alreadySlashed: slashedIds.size,
      pendingOnChain: pending.length,
      pending: pending.map(c => ({ id: c.id, title: c.title, onchain_id: c.onchain_id })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Batch slash cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
