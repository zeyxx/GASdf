#!/usr/bin/env node
/**
 * Setup treasury $ASDF token account (one-time setup)
 */

const { Keypair, Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

const TREASURY_ADDRESS = new PublicKey('9F5NUrZYd7jm5BqDYyXXmTWX9Y1Gt3T11NR7GAnRM68w');
const ASDF_MINT = new PublicKey('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

async function main() {
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Load fee payer
  const feePayerPath = path.join(__dirname, '../.keys/mainnet-fee-payer.json');
  const keyData = JSON.parse(fs.readFileSync(feePayerPath, 'utf-8'));
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(keyData));

  console.log('Setting up treasury $ASDF token account...');
  console.log(`Treasury: ${TREASURY_ADDRESS.toBase58()}`);
  console.log(`$ASDF Mint: ${ASDF_MINT.toBase58()}`);

  const treasuryAta = await getAssociatedTokenAddress(ASDF_MINT, TREASURY_ADDRESS);
  console.log(`Treasury ATA: ${treasuryAta.toBase58()}`);

  // Check if already exists
  try {
    const account = await getAccount(connection, treasuryAta);
    console.log(`\n✓ Treasury ATA already exists!`);
    console.log(`  Balance: ${Number(account.amount) / 1e6} $ASDF`);
    return;
  } catch (e) {
    console.log('\nCreating treasury ATA...');
  }

  // Create ATA
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: blockhash });

  tx.add(createAssociatedTokenAccountInstruction(
    feePayer.publicKey,  // payer
    treasuryAta,         // ata
    TREASURY_ADDRESS,    // owner
    ASDF_MINT            // mint
  ));

  tx.sign(feePayer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');

  console.log(`\n✓ Treasury ATA created!`);
  console.log(`  Signature: ${sig}`);
  console.log(`  Explorer: https://solscan.io/tx/${sig}`);
}

main().catch(console.error);
