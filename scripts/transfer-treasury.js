#!/usr/bin/env node
/**
 * Transfer tokens from old treasury to new treasury (fee payer)
 *
 * Usage:
 *   OLD_TREASURY_KEY="<base58_private_key>" node scripts/transfer-treasury.js
 */

const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const bs58 = require('bs58');

const ASDF_MINT = new PublicKey('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
const NEW_TREASURY = new PublicKey('2BoUm4xwqsF6KguCu3hhdSx9PNgem98e3tk8Ax3qNdXb');
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function main() {
  const oldTreasuryKey = process.env.OLD_TREASURY_KEY;

  if (!oldTreasuryKey) {
    console.error('ERROR: Set OLD_TREASURY_KEY environment variable');
    console.log('Usage: OLD_TREASURY_KEY="<base58_private_key>" node scripts/transfer-treasury.js');
    process.exit(1);
  }

  // Decode the old treasury keypair
  const decode = bs58.default ? bs58.default.decode : bs58.decode;
  const oldTreasury = Keypair.fromSecretKey(decode(oldTreasuryKey));

  console.log('=== Treasury Token Transfer ===');
  console.log('Old Treasury:', oldTreasury.publicKey.toBase58());
  console.log('New Treasury:', NEW_TREASURY.toBase58());
  console.log('Token:', '$ASDF');
  console.log();

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get old treasury's ASDF balance
  const oldAta = await getAssociatedTokenAddress(ASDF_MINT, oldTreasury.publicKey);

  let balance;
  try {
    const account = await getAccount(connection, oldAta);
    balance = account.amount;
    console.log('Old Treasury $ASDF Balance:', Number(balance) / 1e6, '$ASDF');
  } catch (e) {
    console.error('No $ASDF found in old treasury');
    process.exit(1);
  }

  if (balance === 0n) {
    console.log('Nothing to transfer');
    process.exit(0);
  }

  // Get new treasury's ASDF ATA
  const newAta = await getAssociatedTokenAddress(ASDF_MINT, NEW_TREASURY);

  // Check if new ATA exists
  let newAtaExists = false;
  try {
    await getAccount(connection, newAta);
    newAtaExists = true;
  } catch (e) {
    console.log('New treasury ATA does not exist - will be created by GASdf on next quote');
  }

  if (!newAtaExists) {
    console.error('ERROR: New treasury needs an ATA for $ASDF first');
    console.log('Request a quote with $ASDF as payment token to create it, then run this script again');
    process.exit(1);
  }

  // Create transfer instruction
  const transferIx = createTransferInstruction(
    oldAta,
    newAta,
    oldTreasury.publicKey,
    balance,
    [],
    TOKEN_PROGRAM_ID
  );

  // Build transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: oldTreasury.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(transferIx);

  tx.sign(oldTreasury);

  console.log();
  console.log('Transferring', Number(balance) / 1e6, '$ASDF...');

  const signature = await connection.sendRawTransaction(tx.serialize());
  console.log('Signature:', signature);
  console.log('Explorer:', `https://solscan.io/tx/${signature}`);

  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  console.log();
  console.log('✅ Transfer complete!');
}

main().catch(console.error);
