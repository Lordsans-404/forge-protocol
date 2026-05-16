import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';











// --- MOCKED SOLANA DEPENDENCIES FOR EVM MIGRATION ---
const PublicKey = class { constructor(val?: any) {}; toBase58() { return ''; } toBuffer() { return Buffer.from([]); } static findProgramAddressSync(...args: any[]): [any, any] { return [{toBase58: () => '', toBuffer: () => Buffer.from([])}, 0]; } };
const Connection = class { constructor(url?: any, c?: any) {}; async getTransaction() { return null; } async getBalance() { return 0; } async getAccountInfo(...args: any[]) { return { lamports: 0 } as any; } async getLatestBlockhash() { return { blockhash: '', lastValidBlockHeight: 0 }; } async confirmTransaction() {} async sendRawTransaction() { return ''; } };
const Keypair = class { publicKey = new PublicKey(); static fromSecretKey() { return new Keypair(); } static generate() { return new Keypair(); } };
const LAMPORTS_PER_SOL = 1000000000;
const Program = class { account = { commitmentAccount: { fetch: async () => ({}) }, proofRecord: { fetch: async () => ({}) } }; programId = new PublicKey(); methods = { completeCommitment: (...args: any[]) => ({ accounts: (...args: any[]) => ({ rpc: async (...args2: any[]) => '', simulate: async (...args3: any[]) => ({}) }) }), submitProof: (...args: any[]) => ({ accounts: (...args: any[]) => ({ rpc: async (...args2: any[]) => '', simulate: async (...args3: any[]) => ({}) }) }), createCommitment: (...args: any[]) => ({ accounts: (...args: any[]) => ({ rpc: async (...args2: any[]) => '', simulate: async (...args3: any[]) => ({}) }) }) }; constructor(idl?: any, provider?: any) {} };
const AnchorProvider = class { constructor(c?: any, w?: any, o?: any) {} };
const BN = class { constructor(val?: any) {} toArrayLike(...args: any[]) { return Buffer.from([]); } toNumber() { return 0; } };
const SystemProgram = { programId: new PublicKey(), transfer: (...args: any[]) => {} };
const Transaction = class { recentBlockhash = ''; feePayer: any = null; add(...args: any[]) { return this; } serialize() { return Buffer.from([]); } constructor(...args: any[]) {} };
const idl = {} as any;
const TOKEN_PROGRAM_ID = new PublicKey();
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey();
const createAssociatedTokenAccountInstruction: any = (...args: any[]) => ({});
const getAssociatedTokenAddressSync = (...args: any[]) => new PublicKey();
const executeBatchSlash = async (...args: any[]) => [] as any[];
type SlashTarget = any;
const buildMedalMetadata = (...args: any[]) => ({} as any);
// ---------------------------------------------------













export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 1. Fetch pending mints from queue
  const { data: queueItems, error: fetchError } = await supabaseAdmin
    .from('nft_mint_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10); // Batch size 10 to avoid timeouts

  if (fetchError) {
    console.error('[cron/retry-failed-medals] Error fetching queue:', fetchError);
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }

  if (!queueItems || queueItems.length === 0) {
    return NextResponse.json({ message: 'No pending mints in queue' });
  }

  const collectionId = process.env.CROSSMINT_COLLECTION_ID;
  const apiKey = process.env.CROSSMINT_API_KEY;

  if (!collectionId || !apiKey) {
    console.error('[cron/retry-failed-medals] Missing Crossmint credentials');
    return NextResponse.json({ error: 'Missing Crossmint credentials' }, { status: 500 });
  }

  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;

  for (const item of queueItems) {
    processedCount++;
    
    // Reconstruct metadata using the shared helper
    const metadata = buildMedalMetadata({
      userPubkey: item.owner_pubkey,
      commitmentId: item.commitment_id,
      title: item.title,
      category: item.category,
      durationDays: item.duration_days,
      earlyFinishCount: item.early_finish_count,
      txSignature: item.tx_signature,
    });

    try {
      const res = await fetch(
        `https://staging.crossmint.com/api/2022-06-09/collections/${collectionId}/nfts`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: `solana:${item.owner_pubkey}`,
            metadata,
            compressed: true,
          }),
        }
      );

      if (!res.ok) {
        const bodyText = await res.text();
        console.error(`[cron/retry-failed-medals] Crossmint API error for queue ${item.id}:`, bodyText);
        await updateFailedQueueItem(item);
        failCount++;
        continue;
      }

      const mintData = await res.json();
      
      if (!mintData?.id) {
        console.error(`[cron/retry-failed-medals] Unexpected response for queue ${item.id} — no mint ID`);
        await updateFailedQueueItem(item);
        failCount++;
        continue;
      }

      // Cache the new Champion Medal in Supabase
      const { error: cacheError } = await supabaseAdmin.from('nft_index_cache').insert({
        mint_address: mintData.id,
        owner_pubkey: item.owner_pubkey,
        name: metadata.name,
        image_url: metadata.image,
        nft_type: item.nft_type, // Typically 'completion_medal'
        commitment_id: item.commitment_id,
      });

      if (cacheError) {
        console.error(`[cron/retry-failed-medals] Failed to cache medal in nft_index_cache for queue ${item.id}:`, cacheError.message);
      }

      // Mark queue as minted
      await supabaseAdmin.from('nft_mint_queue').update({
        status: 'minted',
        last_attempted_at: new Date().toISOString(),
      }).eq('id', item.id);

      successCount++;

    } catch (err) {
      console.error(`[cron/retry-failed-medals] Network error calling Crossmint for queue ${item.id}:`, err);
      await updateFailedQueueItem(item);
      failCount++;
    }
  }

  return NextResponse.json({ processedCount, successCount, failCount });
}

/**
 * Helper to update retry_count and status if it exceeds max retries.
 */
async function updateFailedQueueItem(item: any) {
  const newRetryCount = (item.retry_count || 0) + 1;
  const status = newRetryCount >= 5 ? 'failed' : 'pending'; // Max 5 retries
  
  await supabaseAdmin.from('nft_mint_queue').update({
    status,
    retry_count: newRetryCount,
    last_attempted_at: new Date().toISOString()
  }).eq('id', item.id);
}
