#!/usr/bin/env node
/**
 * Test the holder tier system - Elegant Pricing Model
 *
 * Usage: node scripts/test-tiers-devnet.js [wallet_address]
 */

const { Connection, PublicKey } = require('@solana/web3.js');

// ==========================================================================
// ELEGANT PRICING MODEL - All values derived from first principles
// ==========================================================================
//
// Constraint: Treasury (20%) must cover network costs
// Therefore: Fee × 0.20 ≥ Network Cost
//           Fee ≥ Network Cost × 5 (break-even)
//
// Formula:
//   NETWORK_FEE = 5000 lamports (Solana base fee)
//   BREAK_EVEN = NETWORK_FEE × 5 = 25000 (derived from 80/20 split)
//   BASE_FEE = BREAK_EVEN × MARKUP = 50000 (2x margin above break-even)
//
// ==========================================================================

const ASDF_DECIMALS = 6;
const ASDF_UNIT = Math.pow(10, ASDF_DECIMALS);
const ORIGINAL_SUPPLY = 1_000_000_000;

// Pricing constants (from config)
const NETWORK_FEE = 5000;
const TREASURY_RATIO = 0.20;
const MARKUP = 2.0;
const BASE_FEE = NETWORK_FEE * (1 / TREASURY_RATIO) * MARKUP; // 50000
const BREAK_EVEN = Math.ceil(NETWORK_FEE / TREASURY_RATIO);   // 25000

// Real $ASDF mint on mainnet
const ASDF_MINT_MAINNET = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

// RPC endpoints
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
 * Apply discount with break-even floor
 */
function applyDiscount(baseFee, discount) {
  const discountedFee = Math.ceil(baseFee * (1 - discount));
  return Math.max(discountedFee, BREAK_EVEN);
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

    // Get ALL token accounts for this wallet holding $ASDF
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
      mint: mint,
    });

    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
      const amount = account.account.data.parsed?.info?.tokenAmount?.uiAmount;
      if (amount) totalBalance += amount;
    }

    return totalBalance;
  } catch (error) {
    return 0;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     $ASDF Holder Tier System - Elegant Pricing Test            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  // Display pricing model
  console.log('📐 Pricing Model (derived from first principles):');
  console.log('─'.repeat(64));
  console.log(`   Network Fee:  ${NETWORK_FEE} lamports (Solana base fee)`);
  console.log(`   Treasury:     ${TREASURY_RATIO * 100}% of fees`);
  console.log(`   Break-even:   ${BREAK_EVEN} lamports (${NETWORK_FEE} ÷ ${TREASURY_RATIO})`);
  console.log(`   Markup:       ${MARKUP}x above break-even`);
  console.log(`   Base Fee:     ${BASE_FEE} lamports (${BREAK_EVEN} × ${MARKUP})`);
  console.log();

  // Test all tiers with simulated balances
  console.log('📊 Tier Pricing Table:');
  console.log('─'.repeat(64));
  console.log('Tier        │ Balance      │ Share    │ Discount │ Fee      │ USD');
  console.log('────────────┼──────────────┼──────────┼──────────┼──────────┼──────');

  // Get real circulating supply
  const connection = new Connection(RPC_MAINNET, 'confirmed');
  let circulating;
  try {
    circulating = await getCirculatingSupply(connection, ASDF_MINT_MAINNET);
  } catch {
    circulating = ORIGINAL_SUPPLY * 0.93;
  }

  const testCases = [
    { balance: Math.ceil(circulating * 0.01) },    // WHALE (~1%)
    { balance: Math.ceil(circulating * 0.001) },   // OG (~0.1%)
    { balance: Math.ceil(circulating * 0.0001) },  // BELIEVER (~0.01%)
    { balance: Math.ceil(circulating * 0.00001) }, // HOLDER (~0.001%)
    { balance: 0 },                                 // NORMIE
  ];

  for (const test of testCases) {
    const share = test.balance / circulating;
    const sharePercent = share * 100;
    const discount = calculateDiscountFromShare(share);
    const finalFee = applyDiscount(BASE_FEE, discount);
    const tier = getTierName(sharePercent);
    const usdFee = (finalFee / 1e9 * 200).toFixed(4); // $200/SOL

    const tierStr = `${tier.emoji} ${tier.name}`.padEnd(11);
    const balanceStr = test.balance.toLocaleString().padStart(12);
    const shareStr = (sharePercent.toFixed(4) + '%').padStart(8);
    const discountStr = (Math.round(discount * 100) + '%').padStart(8);
    const feeStr = finalFee.toLocaleString().padStart(8);
    const usdStr = ('$' + usdFee).padStart(7);

    console.log(`${tierStr} │ ${balanceStr} │ ${shareStr} │ ${discountStr} │ ${feeStr} │ ${usdStr}`);
  }

  console.log();
  console.log(`Circulating Supply: ${circulating.toLocaleString()} $ASDF`);
  console.log(`Burned: ${((1 - circulating / ORIGINAL_SUPPLY) * 100).toFixed(2)}%`);
  console.log();

  // Real wallet test if provided
  const walletArg = process.argv[2];
  if (walletArg) {
    console.log('🔍 Real Wallet Lookup:');
    console.log('─'.repeat(64));
    console.log(`Wallet: ${walletArg}`);

    try {
      const balance = await getTokenBalance(connection, walletArg, ASDF_MINT_MAINNET);
      const share = balance / circulating;
      const sharePercent = share * 100;
      const discount = calculateDiscountFromShare(share);
      const finalFee = applyDiscount(BASE_FEE, discount);
      const tier = getTierName(sharePercent);
      const usdFee = (finalFee / 1e9 * 200).toFixed(4);

      console.log(`Balance: ${balance.toLocaleString()} $ASDF`);
      console.log(`Share: ${sharePercent.toFixed(6)}%`);
      console.log(`Tier: ${tier.emoji} ${tier.name}`);
      console.log(`Discount: ${Math.round(discount * 100)}%`);
      console.log(`Fee: ${finalFee.toLocaleString()} lamports ($${usdFee})`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  } else {
    console.log('💡 Tip: Pass a wallet address to check real balance:');
    console.log('   node scripts/test-tiers-devnet.js <wallet_address>');
  }

  console.log();
  console.log('─'.repeat(64));
  console.log('Formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))');
  console.log('All pricing derived from: Network Fee → 80/20 Split → 2x Markup');
}

main().catch(console.error);
