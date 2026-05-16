import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ethers } from 'ethers';
import { createHash } from 'crypto';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ZG_RPC_URL = process.env.ZG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const ZG_INDEXER_URL = process.env.ZG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';

/**
 * Compute a deterministic root hash from image bytes using SHA-256.
 * Replaces the 0G SDK MemData.merkleTree() — same anti-plagiarism guarantee,
 * zero external dependencies.
 */
function computeRootHash(base64Data: string): string {
  const imageBytes = Buffer.from(base64Data, 'base64');
  return '0x' + createHash('sha256').update(imageBytes).digest('hex');
}

/**
 * Upload image bytes to 0G Storage via the HTTP JSON-RPC API.
 * Replaces the SDK's Indexer.upload() — no WebSocket, no peer deps.
 * Failure is non-fatal: proof is still recorded even if storage fails.
 */
async function uploadTo0GStorage(base64Data: string, rootHash: string): Promise<void> {
  const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const signer = new ethers.Wallet(process.env.EVM_AUTHORITY_PRIVATE_KEY!, provider);
  const signerAddress = await signer.getAddress();

  // 0G Storage upload via indexer REST endpoint
  const res = await fetch(`${ZG_INDEXER_URL}/v1/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signer': signerAddress,
    },
    body: JSON.stringify({
      data: base64Data,
      rootHash,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`0G Storage HTTP ${res.status}: ${body}`);
  }
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

    // ─── Step 1: Hitung rootHash (SHA-256, gratis, deterministik) ────────────
    const rootHash = computeRootHash(base64Data);
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
      ? `The user's commitment is: "${commitmentTitle}" (Category: ${commitmentCategory || 'Other'}).${commitmentDescription ? ` Description: "${commitmentDescription}".` : ''}`
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

    // ─── Step 4: AI reject → return tanpa simpan ──────────────────────────────
    if (!aiResult.isValid) {
      return NextResponse.json({ success: true, aiResult, actualMinutes: elapsedMinutes || 0 });
    }

    // ─── Step 5: AI valid → upload ke 0G Storage (non-fatal) ─────────────────
    try {
      await uploadTo0GStorage(base64Data, rootHash);
      console.log('✅ Uploaded to 0G Storage, rootHash:', rootHash);
    } catch (storageErr: any) {
      console.error('⚠️ 0G Storage upload failed (non-fatal):', storageErr.message);
    }

    // ─── Step 6: Bangun proofHash bytes untuk on-chain ────────────────────────
    const rootHashBytes = Array.from(Buffer.from(rootHash.replace('0x', ''), 'hex'));

    // ─── Step 7: Simpan ke Supabase ───────────────────────────────────────────
    const { data: commitmentInfo } = await supabaseAdmin
      .from('commitments')
      .select('id, user_id')
      .eq('onchain_id', String(onchainId))
      .single();

    if (commitmentInfo) {
      await supabaseAdmin.from('proof_hashes').insert({
        storage_root_hash: rootHash,
        user_id: commitmentInfo.user_id,
        commitment_id: commitmentInfo.id,
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