import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ZG_INDEXER_URL = (process.env.ZG_INDEXER_URL || "Not Found");

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get('userId');
    const walletAddress = req.nextUrl.searchParams.get('walletAddress');

    let finalUserId = userId;

    if (!finalUserId && walletAddress) {
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('wallet_address', walletAddress.toLowerCase())
            .single();
        if (user) finalUserId = user.id;
    }

    if (!finalUserId) {
        return NextResponse.json({ error: 'userId or valid walletAddress is required' }, { status: 400 });
    }

    const { data: proofs, error } = await supabaseAdmin
        .from('proof_hashes')
        .select('id, storage_root_hash, commitment_id, daily_proof_id, created_at')
        .eq('user_id', finalUserId)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error }, { status: 500 });

    const gallery = proofs.map(p => ({
        ...p,
        image_url: `/api/gallery/image?root=${p.storage_root_hash}`,
    }));

    return NextResponse.json({ gallery });
}