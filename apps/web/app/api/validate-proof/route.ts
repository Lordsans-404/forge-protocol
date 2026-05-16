import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ZG_RPC_URL = (process.env.ZG_RPC_URL || "Not Found");
const ZG_INDEXER_URL = (process.env.ZG_INDEXER_URL || "Not Found");

// Hitung rootHash TANPA upload — gratis, deterministik
async function computeRootHash(base64Data: string): Promise<{ memData: MemData; rootHash: string }> {
  const imageBytes = new Uint8Array(Buffer.from(base64Data, 'base64'));
  const memData = new MemData(imageBytes);

  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null) throw new Error(`MerkleTree error: ${treeErr}`);

  const rootHash = tree?.rootHash();
  if (!rootHash) throw new Error('Failed to compute rootHash');

  return { memData, rootHash };
}

// Upload ke 0G Storage
async function uploadTo0GStorage(memData: MemData): Promise<void> {
  const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const signer = new ethers.Wallet(process.env.EVM_AUTHORITY_PRIVATE_KEY!, provider);
  const indexer = new Indexer(ZG_INDEXER_URL);

  const [, uploadErr] = await indexer.upload(memData, ZG_RPC_URL, signer);
  if (uploadErr !== null) throw new Error(`Upload failed: ${uploadErr}`);
}

export async function POST(req: NextRequest) {
  try {
    const {
      image,
      onchainId,
      targetMinutes,
      elapsedMinutes,
      commitmentTitle,
      commitmentCategory,
      commitmentDescription,
    } = await req.json();

    if (!image || !onchainId) {
      return NextResponse.json({ error: 'Image and onchainId are required' }, { status: 400 });
    }

    const base64Data = image.split(',')[1] || image;

    // ─── Step 1: Hitung rootHash (belum upload, belum keluar biaya) ───────────
    const { memData, rootHash } = await computeRootHash(base64Data);
    console.log('Image rootHash:', rootHash);

    // ─── Step 2: Cek duplikat pakai rootHash di Supabase ─────────────────────
    const { data: existingProof } = await supabaseAdmin
      .from('proof_hashes')
      .select('id')
      .eq('storage_root_hash', rootHash)
      .single();

    if (existingProof) {
      return NextResponse.json({
        success: false,
        error: 'Rejected: This image has already been submitted as proof.',
      }, { status: 400 });
    }

    // ─── Step 3: AI Validation (Groq) ─────────────────────────────────────────
    const activityContext = commitmentTitle
      ? `The user's commitment is: "${commitmentTitle}" (Category: ${commitmentCategory || 'Other'}).${commitmentDescription ? ` Description: "${commitmentDescription}".` : ''
      }`
      : 'No specific commitment context provided.';

    const prompt = `
      You are an AI Auditor for Forge Protocol, a habit-building platform where users stake real money on their commitments.
      Your job is to verify if the uploaded image is a legitimate proof of activity completion.

      === COMMITMENT CONTEXT ===
      ${activityContext}
      Daily target: ${targetMinutes || 0} minutes.

      === YOUR TASK ===
      1. Does the image show an activity that is RELEVANT to the commitment title/description above?
      2. If category type is 'fitness' or 'workout' then check, Is there a visible timer, stopwatch, app dashboard, or any indicator showing duration/progress?
      3. Rate your CONFIDENCE (0-100) that this is a genuine, valid proof:
         - 0-29: Very suspicious (stock photo, unrelated content, no timer, clearly fake)
         - 30-59: Somewhat confident (related activity but weak evidence)
         - 60-79: Confident (clear activity match with some duration evidence)
         - 80-100: Very confident (perfect match with clear timer/duration visible)
      4. Is the image a generic stock photo, AI-generated, or a screenshot of a website (not allowed)?

      === SCORING RULES ===
      - If the image has NO relation to the commitment title → score below 20
      - If there's no visible timer/duration indicator → cap score at 50
      - If the activity matches AND timer is visible → score 60+
      - Stock photos or clearly fake images → score 0-10

      Output MUST be valid JSON:
      {
        "isValid": true/false,
        "confidenceScore": number (0-100),
        "activity": "string describing detected activity",
        "relevance": "string explaining how the image relates to the commitment",
        "reason": "short explanation of the score"
      }
      Set isValid to TRUE only if confidenceScore >= 30.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const aiResult = JSON.parse(chatCompletion.choices[0]?.message?.content || '{}');
    if ((aiResult.confidenceScore ?? 0) < 30) aiResult.isValid = false;

    // ─── Step 4: Kalau AI reject, langsung return — tidak ada upload/simpan ───
    if (!aiResult.isValid) {
      return NextResponse.json({
        success: true,
        aiResult,
        actualMinutes: elapsedMinutes || 0,
      });
    }

    // ─── Step 5: AI valid → upload ke 0G Storage ─────────────────────────────
    try {
      await uploadTo0GStorage(memData);
      console.log('Uploaded to 0G Storage, rootHash:', rootHash);
    } catch (storageErr: any) {
      console.error('0G Storage upload failed:', storageErr.message);
      // Tetap lanjut — proof tetap disimpan meski 0G gagal
    }

    // ─── Step 6: Bangun proof hash untuk on-chain (dari rootHash 0G) ──────────
    const rootHashBytes = Array.from(Buffer.from(rootHash.replace('0x', ''), 'hex'));

    // ─── Step 7: Simpan ke Supabase ───────────────────────────────────────────
    const { data: commitmentInfo } = await supabaseAdmin
      .from('commitments')
      .select('id, user_id')
      .eq('onchain_id', String(onchainId))
      .single();

    if (commitmentInfo) {
      await supabaseAdmin
        .from('proof_hashes')
        .insert({
          storage_root_hash: rootHash,
          user_id: commitmentInfo.user_id,
          commitment_id: commitmentInfo.id,
          // daily_proof_id: NULL dulu, diupdate oleh webhook setelah on-chain confirm
        });
    }

    return NextResponse.json({
      success: true,
      aiResult,
      proofHash: rootHashBytes,
      storageRootHash: rootHash,
      actualMinutes: elapsedMinutes || 0,
    });

  } catch (error: any) {
    console.error('Validation Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal Server Error',
    }, { status: 500 });
  }
}