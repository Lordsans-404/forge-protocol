import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/debug/commitments?owner=<wallet_address>
 * Dev-only: Inspect raw Supabase data for a given wallet to debug why
 * commitments aren't showing on the dashboard.
 */
export async function GET(request: Request) {
  // Only enable in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');

    if (!owner) {
      return NextResponse.json({ error: 'Missing ?owner= param' }, { status: 400 });
    }

    const ownerLower = owner.toLowerCase();

    // 1. Check user record
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('wallet_address', ownerLower)
      .single();

    // 2. Also try case-insensitive search for any variant
    const { data: allUsers } = await supabaseAdmin
      .from('users')
      .select('id, wallet_address')
      .ilike('wallet_address', ownerLower);

    // 3. If user found, fetch their commitments
    let commitments: any[] = [];
    if (user) {
      const { data, error } = await supabaseAdmin
        .from('commitments')
        .select('*')
        .eq('user_id', user.id);
      commitments = data || [];
    }

    // 4. Also fetch all commitments in DB (last 20) to show the state
    const { data: allCommitments } = await supabaseAdmin
      .from('commitments')
      .select('id, user_id, onchain_id, title, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      query: { owner, ownerLower },
      userFound: !!user,
      user: user || null,
      userError: userError?.message || null,
      allUsersMatchingWallet: allUsers || [],
      commitmentsForUser: commitments,
      allRecentCommitmentsInDB: allCommitments || [],
      onchainIdsForUser: commitments.map((c: any) => ({
        onchain_id: c.onchain_id,
        title: c.title,
        status: c.status,
        isValidBigInt: (() => { try { BigInt(c.onchain_id); return true; } catch { return false; } })(),
        startsWithHex: String(c.onchain_id).startsWith('0x'),
        length: String(c.onchain_id).length,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
