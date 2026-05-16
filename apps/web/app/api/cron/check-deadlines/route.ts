import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/cron/check-deadlines
 *
 * Daily cron: checks all active commitments against today's date.
 * If a user has missed a daily proof window → marks commitment as failed in Supabase.
 * On-chain enforcement (actual stake slash) is handled by /api/cron/batch-slash.
 *
 * Triggered by: Vercel Cron (vercel.json) every day at 00:00 UTC
 */
export async function GET(request: Request) {
  try {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all active commitments
    const { data: activeCommitments, error: fetchError } = await supabaseAdmin
      .from('commitments')
      .select('id, user_id, title, duration_days, daily_target_minutes, stake_amount, created_at, failed_count, start_date')
      .eq('status', 'active');

    if (fetchError) {
      console.error('❌ Fetch error:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!activeCommitments || activeCommitments.length === 0) {
      return NextResponse.json({ checked: 0, missed: 0 });
    }

    console.log(`🔍 Checking ${activeCommitments.length} active commitments...`);

    let missedCount = 0;
    const results: any[] = [];

    const nowUtc = new Date();
    const todayUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate()));

    for (const commitment of activeCommitments) {
      try {
        // Calculate how many days have elapsed since start
        const startDate = commitment.start_date
          ? new Date(commitment.start_date)
          : new Date(commitment.created_at);
        const startUtc = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
        const daysSinceStart = Math.floor((todayUtc.getTime() - startUtc.getTime()) / 86400_000);

        // Expected day = how many proofs should have been submitted by now
        const expectedDay = Math.min(daysSinceStart, commitment.duration_days);

        // Check how many proofs have been submitted
        const { count: proofCount } = await supabaseAdmin
          .from('daily_proofs')
          .select('id', { count: 'exact', head: true })
          .eq('commitment_id', commitment.id)
          .eq('status', 'approved');

        const submitted = proofCount ?? 0;
        const missed = expectedDay - submitted;

        if (missed <= 0) {
          results.push({ id: commitment.id, title: commitment.title, status: 'on_track', submitted, expected: expectedDay });
          continue;
        }

        // User has missed at least one day
        missedCount++;
        const failedCount = commitment.failed_count ?? 0;
        const newFailedCount = failedCount + 1;
        const newStatus = newFailedCount >= 2 ? 'failed' : 'failed'; // Both lead to failed for now

        console.log(`⚠️ "${commitment.title}" missed ${missed} day(s). Marking as failed.`);

        await supabaseAdmin
          .from('commitments')
          .update({ status: newStatus, failed_count: newFailedCount, updated_at: new Date().toISOString() })
          .eq('id', commitment.id);

        // Log slash event (off-chain record; actual on-chain slash via batch-slash cron)
        await supabaseAdmin.from('slash_events').insert({
          commitment_id: commitment.id,
          user_id: commitment.user_id,
          slashed_amount: (commitment.stake_amount ?? 0) * (newFailedCount >= 2 ? 1 : 0.4),
          fail_count_at_slash: newFailedCount,
          tx_hash: `cron-deadline-${Date.now()}`,
          reason: `Auto: missed Day ${expectedDay} (submitted ${submitted}, expected ${expectedDay})`,
        });

        results.push({ id: commitment.id, title: commitment.title, status: 'missed', submitted, expected: expectedDay, missed, newStatus });
      } catch (err: any) {
        console.error(`❌ Error processing ${commitment.id}:`, err.message);
        results.push({ id: commitment.id, error: err.message });
      }
    }

    console.log(`📊 Cron Summary: ${activeCommitments.length} checked, ${missedCount} missed`);

    return NextResponse.json({
      checked: activeCommitments.length,
      missed: missedCount,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error: any) {
    console.error('❌ Cron check-deadlines error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
