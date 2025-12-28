#!/usr/bin/env node
/**
 * Test the holder tier system on devnet
 *
 * Usage: node scripts/test-tiers-devnet.js [wallet_address]
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

// Constants
const ASDF_DECIMALS = 6;
const ASDF_UNIT = Math.pow(10, ASDF_DECIMALS);
const ORIGINAL_SUPPLY = 1_000_000_000;

// Real $ASDF mint on mainnet (for testing formula)
const ASDF_MINT_MAINNET = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

// RPC endpoints
const RPC_DEVNET = 'https://api.devnet.solana.com';
const RPC_MAINNET = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Core discount formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))
 */
function calculateDiscountFromShare(share) {
  if (share <= 0) return 0;
  const logShare = Math.log10(share);
  const discount = (logShare + 5) / 3;
  return Math.min(0.95, Math.max(0, discount));
}

/**
 * Get tier name based on share percentage
 */
function getTierName(sharePercent) {
  if (sharePercent >= 1) return { name: 'WHALE', emoji: '🐋' };
  if (sharePercent >= 0.1) return { name: 'OG', emoji: '👑' };
  if (sharePercent >= 0.01) return { name: 'BELIEVER', emoji: '💎' };
  if (sharePercent >= 0.001) return { name: 'HOLDER', emoji: '🙌' };
  return { name: 'NORMIE', emoji: '👤' };
}

/**
 * Break-even fee calculation
 */
function calculateBreakEvenFee(txCost) {
  const TREASURY_RATIO = 0.20;
  return Math.ceil(txCost / TREASURY_RATIO);
}

/**
 * Apply discount with break-even floor
 */
function applyDiscount(baseFee, discount, txCost = 5000) {
  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = Math.ceil(baseFee * (1 - discount));
  return Math.max(discountedFee, breakEvenFee);
}

async function getCirculatingSupply(connection, mintAddress) {
  try {
    const mint = new PublicKey(mintAddress);
    const supplyInfo = await connection.getTokenSupply(mint);
    return parseInt(supplyInfo.value.amount) / ASDF_UNIT;
  } catch (error) {
    console.error('Failed to fetch supply:', error.message);
    return ORIGINAL_SUPPLY * 0.93; // Fallback
  }
}

async function getTokenBalance(connection, walletAddress, mintAddress) {
  try {
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(mint, wallet);
    const accountInfo = await connection.getTokenAccountBalance(ata);
    return parseInt(accountInfo.value.amount) / ASDF_UNIT;
  } catch (error) {
    return 0;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 $ASDF Holder Tier System - Test on Devnet/Mainnet');
  console.log('='.repeat(60));
  console.log();

  // Test 1: Formula verification
  console.log('📊 Formula Test: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))');
  console.log('-'.repeat(60));

  const testShares = [
    { share: 0.00001, expected: 0, label: '0.001% (10⁻⁵)' },
    { share: 0.0001, expected: 0.333, label: '0.01% (10⁻⁴)' },
    { share: 0.001, expected: 0.667, label: '0.1% (10⁻³)' },
    { share: 0.01, expected: 0.95, label: '1% (10⁻²)' },
    { share: 0.1, expected: 0.95, label: '10% (10⁻¹)' },
  ];

  for (const test of testShares) {
    const discount = calculateDiscountFromShare(test.share);
    const tier = getTierName(test.share * 100);
    const status = Math.abs(discount - test.expected) < 0.01 ? '✅' : '❌';
    console.log(`  ${status} Share ${test.label}: ${(discount * 100).toFixed(1)}% discount → ${tier.emoji} ${tier.name}`);
  }
  console.log();

  // Test 2: Tier thresholds
  console.log('🎯 Tier Thresholds (by % of supply):');
  console.log('-'.repeat(60));
  console.log('  NORMIE  👤  < 0.001%   →   0% discount');
  console.log('  HOLDER  🙌  ≥ 0.001%   →   0% discount');
  console.log('  BELIEVER 💎  ≥ 0.01%    →  33% discount');
  console.log('  OG      👑  ≥ 0.1%     →  67% discount');
  console.log('  WHALE   🐋  ≥ 1%       →  95% discount');
  console.log();

  // Test 3: Break-even floor
  console.log('💰 Break-Even Floor Test (treasury neutrality):');
  console.log('-'.repeat(60));
  const txCost = 5000;
  const breakEven = calculateBreakEvenFee(txCost);
  console.log(`  TX cost: ${txCost} lamports → Break-even fee: ${breakEven} lamports`);
  console.log(`  Treasury (20%): ${breakEven * 0.20} lamports = covers TX cost ✅`);
  console.log();

  // Test 4: Discount application with floor
  console.log('📉 Discount Application (with break-even floor):');
  console.log('-'.repeat(60));
  const baseFee = 100000; // 100k lamports

  for (const test of testShares) {
    const discount = calculateDiscountFromShare(test.share);
    const finalFee = applyDiscount(baseFee, discount, txCost);
    const savings = baseFee - finalFee;
    const tier = getTierName(test.share * 100);
    console.log(`  ${tier.emoji} ${tier.name.padEnd(8)} (${test.label.padEnd(15)}): ${baseFee} → ${finalFee} lamports (save ${savings})`);
  }
  console.log();

  // Test 5: Deflationary flywheel
  console.log('🔄 Deflationary Flywheel Test:');
  console.log('-'.repeat(60));
  const holding = 1_000_000; // 1M tokens

  const supplies = [
    { supply: 1_000_000_000, label: '1B (original)' },
    { supply: 930_000_000, label: '930M (7% burned)' },
    { supply: 500_000_000, label: '500M (50% burned)' },
    { supply: 100_000_000, label: '100M (90% burned)' },
  ];

  console.log(`  Holding: ${holding.toLocaleString()} $ASDF`);
  console.log();
  for (const s of supplies) {
    const share = holding / s.supply;
    const discount = calculateDiscountFromShare(share);
    const tier = getTierName(share * 100);
    console.log(`  Supply ${s.label.padEnd(20)}: ${(share * 100).toFixed(4)}% → ${(discount * 100).toFixed(1)}% discount → ${tier.emoji} ${tier.name}`);
  }
  console.log();

  // Test 6: Real mainnet check (if wallet provided)
  const walletArg = process.argv[2];
  if (walletArg) {
    console.log('🌐 Real Mainnet Balance Check:');
    console.log('-'.repeat(60));
    console.log(`  Wallet: ${walletArg}`);

    try {
      const connection = new Connection(RPC_MAINNET, 'confirmed');

      const [circulating, balance] = await Promise.all([
        getCirculatingSupply(connection, ASDF_MINT_MAINNET),
        getTokenBalance(connection, walletArg, ASDF_MINT_MAINNET),
      ]);

      const share = balance / circulating;
      const discount = calculateDiscountFromShare(share);
      const tier = getTierName(share * 100);

      console.log(`  $ASDF Balance: ${balance.toLocaleString()}`);
      console.log(`  Circulating: ${circulating.toLocaleString()}`);
      console.log(`  Share: ${(share * 100).toFixed(6)}%`);
      console.log(`  Discount: ${(discount * 100).toFixed(1)}%`);
      console.log(`  Tier: ${tier.emoji} ${tier.name}`);

      // Show fee example
      const baseFee = 100000;
      const finalFee = applyDiscount(baseFee, discount, 5000);
      console.log();
      console.log(`  Fee example: ${baseFee} → ${finalFee} lamports (save ${baseFee - finalFee})`);
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  } else {
    console.log('💡 Tip: Pass a wallet address to check real balance:');
    console.log('   node scripts/test-tiers-devnet.js <wallet_address>');
  }

  console.log();
  console.log('='.repeat(60));
  console.log('✅ All tier system tests completed');
  console.log('='.repeat(60));
}

main().catch(console.error);
