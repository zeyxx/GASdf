#!/usr/bin/env node
/**
 * Manual $ASDF burn test
 * Burns $ASDF tokens from treasury to prove the burn mechanism works
 */

const { Keypair, Transaction, PublicKey } = require('@solana/web3.js');
const {
  createBurnInstruction,
  getAssociatedTokenAddress,
  getAccount,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

const TREASURY_ADDRESS = new PublicKey('9F5NUrZYd7jm5BqDYyXXmTWX9Y1Gt3T11NR7GAnRM68w');
const ASDF_MINT = new PublicKey('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

async function main() {
  const { Connection } = require('@solana/web3.js');
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              $ASDF BURN TEST - MAINNET                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Load fee payer (treasury owner)
  const feePayerPath = path.join(__dirname, '../.keys/mainnet-fee-payer.json');
  const keyData = JSON.parse(fs.readFileSync(feePayerPath, 'utf-8'));
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(keyData));

  console.log(`Treasury: ${TREASURY_ADDRESS.toBase58()}`);
  console.log(`$ASDF Mint: ${ASDF_MINT.toBase58()}\n`);

  // Get treasury token account
  const treasuryAta = await getAssociatedTokenAddress(ASDF_MINT, TREASURY_ADDRESS);

  let balance;
  try {
    const account = await getAccount(connection, treasuryAta);
    balance = Number(account.amount);
    console.log(`Treasury $ASDF balance: ${balance} units (${(balance / 1e6).toFixed(6)} $ASDF)`);
  } catch (e) {
    console.log('❌ Treasury has no $ASDF token account');
    return;
  }

  if (balance === 0) {
    console.log('❌ No $ASDF to burn');
    return;
  }

  // Calculate 80% to burn (following 80/20 model)
  const burnAmount = Math.floor(balance * 0.8);
  const keepAmount = balance - burnAmount;

  console.log(`\n--- 80/20 Treasury Model ---`);
  console.log(`Total: ${balance} units`);
  console.log(`Burn (80%): ${burnAmount} units → DESTROYED FOREVER 🔥`);
  console.log(`Keep (20%): ${keepAmount} units → Operations`);

  if (burnAmount === 0) {
    console.log('\n❌ Burn amount too small (rounds to 0)');
    return;
  }

  // Build burn transaction
  console.log('\n🔥 Executing burn...');

  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: blockhash,
  });

  // Burn instruction - permanently destroys tokens
  transaction.add(
    createBurnInstruction(
      treasuryAta,           // token account to burn from
      ASDF_MINT,             // mint
      feePayer.publicKey,    // owner (authority)
      burnAmount             // amount to burn
    )
  );

  transaction.sign(feePayer);
  const signature = await connection.sendRawTransaction(transaction.serialize());

  console.log(`   TX submitted: ${signature.slice(0, 20)}...`);

  await connection.confirmTransaction(signature, 'confirmed');

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    🔥 BURN COMPLETE! 🔥                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log(`   Burned: ${burnAmount} units (${(burnAmount / 1e6).toFixed(6)} $ASDF)`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Explorer: https://solscan.io/tx/${signature}`);
  console.log(`\n   These tokens are PERMANENTLY DESTROYED.`);
  console.log(`   Total $ASDF supply reduced by ${(burnAmount / 1e6).toFixed(6)}`);

  // Verify new balance
  const newAccount = await getAccount(connection, treasuryAta);
  const newBalance = Number(newAccount.amount);
  console.log(`\n   Treasury balance: ${balance} → ${newBalance} units`);

  return { signature, burned: burnAmount };
}

main()
  .then((result) => {
    if (result) {
      console.log('\n✅ Burn test successful!');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
