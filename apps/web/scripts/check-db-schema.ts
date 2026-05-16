// Script untuk cek apakah Supabase schema sudah di-migrate atau belum
// Jalankan: bun run scripts/check-db-schema.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE env vars. Jalankan dari folder apps/web dengan .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  console.log('\n🔍 Checking Supabase Schema...\n');

  // 1. Check users table columns
  const { data: userCols } = await supabase.rpc('exec_sql', {
    query: `SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY column_name`
  }).catch(() => ({ data: null }));

  // Fallback: try direct query to detect schema
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('*')
    .limit(1);

  if (userErr) {
    console.log('❌ Cannot read users table:', userErr.message);
  } else if (userRow && userRow.length > 0) {
    const keys = Object.keys(userRow[0]);
    const hasWalletAddress = keys.includes('wallet_address');
    const hasSolanaPubkey = keys.includes('solana_pubkey');
    console.log('📋 users table columns:', keys.join(', '));
    console.log(hasWalletAddress ? '✅ wallet_address column EXISTS (EVM schema)' : '⚠️  wallet_address NOT FOUND');
    console.log(hasSolanaPubkey ? '🔴 solana_pubkey still exists (OLD schema — need migration!)' : '✅ solana_pubkey removed');
  } else {
    console.log('📋 users table is empty — but checking schema...');

    // Try inserting a test user with EVM wallet address
    const testWallet = '0xtest_schema_check_' + Date.now();
    const { error: insertErr } = await supabase
      .from('users')
      .insert({ wallet_address: testWallet });

    if (!insertErr) {
      console.log('✅ users.wallet_address column EXISTS (EVM schema ready!)');
      // Clean up
      await supabase.from('users').delete().eq('wallet_address', testWallet);
    } else if (insertErr.message.includes('wallet_address')) {
      console.log('🔴 wallet_address column NOT FOUND — schema needs migration!');
      console.log('   Run: supabase_migration_v1_to_v2.sql in Supabase SQL Editor');
    } else {
      console.log('⚠️  users insert error:', insertErr.message);
    }
  }

  // 2. Check commitments table
  const { data: commitRow } = await supabase
    .from('commitments')
    .select('*')
    .limit(1);

  if (commitRow !== null) {
    if (commitRow.length > 0) {
      const keys = Object.keys(commitRow[0]);
      const hasOnchainId = keys.includes('onchain_id');
      const hasPdaAddress = keys.includes('pda_address');
      console.log('\n📋 commitments table columns:', keys.join(', '));
      console.log(hasOnchainId ? '✅ onchain_id column EXISTS (EVM schema)' : '⚠️  onchain_id NOT FOUND');
      console.log(hasPdaAddress ? '🔴 pda_address still exists (OLD schema!)' : '✅ pda_address removed');
    } else {
      console.log('\n📋 commitments table is empty');
      // Try checking via insert test
      const { error: commitInsertErr } = await supabase
        .from('commitments')
        .insert({ onchain_id: 'test_schema_check', title: 'test', user_id: '00000000-0000-0000-0000-000000000000', duration_days: 7, daily_target_minutes: 10 });
      
      if (!commitInsertErr || !commitInsertErr.message.includes('onchain_id')) {
        console.log('✅ commitments.onchain_id column appears to exist');
      } else {
        console.log('🔴 commitments.onchain_id NOT FOUND — schema needs migration!');
      }
    }
  }

  // 3. Check tokens table (new in v2)
  const { data: tokenData, error: tokenErr } = await supabase
    .from('tokens')
    .select('address, symbol')
    .limit(5);

  if (tokenErr) {
    console.log('\n🔴 tokens table does NOT exist — schema needs migration!');
  } else {
    console.log(`\n✅ tokens table EXISTS with ${tokenData?.length || 0} token(s):`);
    tokenData?.forEach((t: any) => console.log(`   - ${t.symbol}: ${t.address}`));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📌 Jika ada 🔴 di atas, jalankan migration script ini di Supabase SQL Editor:');
  console.log('   supabase_migration_v1_to_v2.sql');
  console.log('='.repeat(60) + '\n');
}

checkSchema().catch(console.error);
