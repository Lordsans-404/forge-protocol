import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/commitments
 * Simpan metadata commitment (title, dll) yang tidak ada on-chain ke Supabase.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { onchainId, owner, title, category, description, txHash, durationDays, dailyTargetMinutes, stakeAmount } = body;

    if (!onchainId || !owner || !title) {
      return NextResponse.json({ error: 'Missing required fields: onchainId, owner, title' }, { status: 400 });
    }

    if (durationDays < 7) {
      return NextResponse.json({ error: 'Commitment must be at least 7 days' }, { status: 400 });
    }

    if (dailyTargetMinutes < 10) {
      return NextResponse.json({ error: 'Daily target must be at least 10 minutes' }, { status: 400 });
    }

    // 1. Upsert user berdasarkan wallet_address
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .upsert(
        { wallet_address: owner.toLowerCase() },
        { onConflict: 'wallet_address' }
      )
      .select('id')
      .single();

    if (userError) {
      console.error('User upsert error:', userError);
      return NextResponse.json({ error: 'Failed to upsert user: ' + userError.message }, { status: 500 });
    }

    // 2. Dapatkan token_id (Pastikan token sudah terdaftar di tabel 'tokens')
    const tokenAddress = (process.env.NEXT_PUBLIC_EVM_MOCK_USDT_ADDRESS || '0x...').toLowerCase();
    let { data: token } = await supabaseAdmin
      .from('tokens')
      .select('id')
      .eq('address', tokenAddress)
      .single();

    // Fallback: Jika token belum ada, kita insert (hanya untuk development/demo)
    if (!token) {
      const { data: newToken, error: tokenError } = await supabaseAdmin
        .from('tokens')
        .insert({
          address: tokenAddress,
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 18
        })
        .select('id')
        .single();
      
      if (tokenError) {
        console.error('Token registration error:', tokenError);
        return NextResponse.json({ error: 'Failed to register token: ' + tokenError.message }, { status: 500 });
      }
      token = newToken;
    }

    // 3. Upsert commitment — semua kolom NOT NULL harus diisi
    const { error: commitError } = await supabaseAdmin
      .from('commitments')
      .upsert({
        user_id: user.id,
        onchain_id: onchainId,
        title: title,
        category: category,
        description: description,
        duration_days: durationDays || 7,
        daily_target_minutes: dailyTargetMinutes || 30,
        stake_amount: stakeAmount || 0,
        token_id: token.id,
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + (durationDays || 7) * 86400000).toISOString().split('T')[0],
      }, { onConflict: 'onchain_id' });

    if (commitError) {
      console.error('Commitment upsert error:', commitError);
      return NextResponse.json({ error: commitError.message }, { status: 500 });
    }

    console.log(`✅ Commitment "${title}" saved for user ${owner.substring(0, 8)}...`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API /commitments error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/commitments?owner=<wallet_address>
 * Fetch commitment metadata dari Supabase untuk merge dengan data on-chain.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');

    if (!owner) {
      return NextResponse.json({ error: 'Missing owner param' }, { status: 400 });
    }

    // Cari user dulu, lalu fetch commitments-nya
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('wallet_address', owner.toLowerCase())
      .single();

    if (!user) {
      return NextResponse.json({});
    }

    const { data, error } = await supabaseAdmin
      .from('commitments')
      .select('onchain_id, title, category, description')
      .eq('user_id', user.id);

    if (error) {
      console.error('Fetch commitments error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return sebagai map: { onchainId: { title, category, description } }
    const metadataMap: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      metadataMap[row.onchain_id] = {
        title: row.title,
        category: row.category,
        description: row.description
      };
    });

    return NextResponse.json(metadataMap);
  } catch (error: any) {
    console.error('API /commitments GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
