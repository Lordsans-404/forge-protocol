import { NextRequest, NextResponse } from 'next/server';

const ZG_INDEXER_URL = process.env.ZG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';

export async function GET(req: NextRequest) {
    const root = req.nextUrl.searchParams.get('root');
    if (!root) return NextResponse.json({ error: 'root is required' }, { status: 400 });

    const upstream = await fetch(`${ZG_INDEXER_URL}/file?root=${root}`);
    if (!upstream.ok) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

    const buffer = await upstream.arrayBuffer();

    // Deteksi format gambar dari magic bytes
    const bytes = new Uint8Array(buffer.slice(0, 4));
    let contentType = 'image/jpeg'; // default
    if (bytes[0] === 0x89 && bytes[1] === 0x50) contentType = 'image/png';
    else if (bytes[0] === 0x47 && bytes[1] === 0x49) contentType = 'image/gif';
    else if (bytes[0] === 0x52 && bytes[1] === 0x49) contentType = 'image/webp';

    return new NextResponse(buffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    });
}