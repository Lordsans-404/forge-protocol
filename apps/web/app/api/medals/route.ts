import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');

    if (!owner) {
      return NextResponse.json({ error: 'Missing owner param' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('nft_index_cache')
      .select('token_id, name, image_url, nft_type, commitment_id')
      .eq('owner_address', owner.toLowerCase())
      .order('last_synced_at', { ascending: false });

    if (error) {
      console.error('Fetch medals error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Map token_id → mint_address for backwards compat with any older UI references
    const medals = (data || []).map((m: any) => ({ ...m, mint_address: m.token_id }));

    return NextResponse.json({ medals });
  } catch (error: any) {
    console.error('API /medals GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
