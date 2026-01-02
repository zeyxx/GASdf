#!/usr/bin/env node
/**
 * Setup Address Lookup Table (ALT) for GASdf
 *
 * This script creates and extends an ALT with frequently used addresses.
 * Run once per environment to set up the ALT.
 *
 * Usage:
 *   node scripts/setup-alt.js create   # Create a new ALT
 *   node scripts/setup-alt.js extend   # Extend existing ALT with addresses
 *   node scripts/setup-alt.js status   # Show ALT status
 */

const {
  Connection,
  Keypair,
  PublicKey,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const bs58 = require('bs58');

// Load environment
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Core addresses to include in ALT
const CORE_ADDRESSES = [
  // System programs
  new PublicKey('11111111111111111111111111111111'), // System Program
  new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Token Program
  new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'), // Token-2022 Program
  new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), // Associated Token Program
  new PublicKey('SysvarRent111111111111111111111111111111111'), // Rent Sysvar

  // Jupiter
  new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), // Jupiter V6

  // Common tokens
  new PublicKey('So11111111111111111111111111111111111111112'), // WSOL
  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
  new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'), // USDT
  new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'), // mSOL
  new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'), // jitoSOL
];

async function getConnection() {
  const rpcUrl = process.env.RPC_URL ||
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com');

  return new Connection(rpcUrl, 'confirmed');
}

function getAuthority() {
  const privateKey = process.env.FEE_PAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('FEE_PAYER_PRIVATE_KEY not set');
  }

  const decode = bs58.default ? bs58.default.decode : bs58.decode;
  return Keypair.fromSecretKey(decode(privateKey));
}

async function createLookupTable() {
  console.log('Creating Address Lookup Table...\n');

  const connection = await getConnection();
  const authority = getAuthority();

  console.log('Authority:', authority.publicKey.toBase58());

  // Get recent slot for derivation
  const slot = await connection.getSlot();
  console.log('Using slot:', slot);

  // Create the lookup table
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: slot,
  });

  console.log('Lookup Table Address:', lookupTableAddress.toBase58());

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([authority]);

  console.log('\nSending transaction...');
  const signature = await connection.sendTransaction(tx);
  console.log('Signature:', signature);

  // Wait for confirmation
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  console.log('\n✓ Lookup table created successfully!');
  console.log('\nAdd to your .env:');
  console.log(`ALT_ADDRESS=${lookupTableAddress.toBase58()}`);

  return lookupTableAddress;
}

async function extendLookupTable(altAddress) {
  console.log('Extending Address Lookup Table...\n');

  const connection = await getConnection();
  const authority = getAuthority();

  const lookupTableAddress = altAddress
    ? new PublicKey(altAddress)
    : new PublicKey(process.env.ALT_ADDRESS);

  console.log('Lookup Table:', lookupTableAddress.toBase58());
  console.log('Authority:', authority.publicKey.toBase58());

  // Get current ALT to check existing addresses
  const altResult = await connection.getAddressLookupTable(lookupTableAddress);
  if (!altResult.value) {
    throw new Error('Lookup table not found');
  }

  const existingAddresses = new Set(
    altResult.value.state.addresses.map((a) => a.toBase58())
  );

  console.log('Current addresses:', existingAddresses.size);

  // Get addresses to add (filter out already existing)
  const addressesToAdd = [];

  // Add ASDF mint if configured
  if (process.env.ASDF_MINT && !process.env.ASDF_MINT.includes('Fake')) {
    try {
      const asdfMint = new PublicKey(process.env.ASDF_MINT);
      if (!existingAddresses.has(asdfMint.toBase58())) {
        addressesToAdd.push(asdfMint);
        console.log('Adding ASDF mint:', asdfMint.toBase58());
      }
    } catch {
      console.log('Invalid ASDF_MINT, skipping');
    }
  }

  // Add treasury if configured
  if (process.env.TREASURY_ADDRESS) {
    try {
      const treasury = new PublicKey(process.env.TREASURY_ADDRESS);
      if (!existingAddresses.has(treasury.toBase58())) {
        addressesToAdd.push(treasury);
        console.log('Adding Treasury:', treasury.toBase58());
      }
    } catch {
      console.log('Invalid TREASURY_ADDRESS, skipping');
    }
  }

  // Add core addresses
  for (const addr of CORE_ADDRESSES) {
    if (!existingAddresses.has(addr.toBase58())) {
      addressesToAdd.push(addr);
      console.log('Adding:', addr.toBase58());
    }
  }

  if (addressesToAdd.length === 0) {
    console.log('\n✓ All addresses already in lookup table!');
    return;
  }

  console.log(`\nAdding ${addressesToAdd.length} new addresses...`);

  // Extend in batches of 20 (Solana limit)
  const BATCH_SIZE = 20;
  for (let i = 0; i < addressesToAdd.length; i += BATCH_SIZE) {
    const batch = addressesToAdd.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} addresses`);

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lookupTableAddress,
      authority: authority.publicKey,
      payer: authority.publicKey,
      addresses: batch,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [extendIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([authority]);

    const signature = await connection.sendTransaction(tx);
    console.log('Signature:', signature);

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });
  }

  console.log('\n✓ Lookup table extended successfully!');
}

async function showStatus() {
  console.log('Address Lookup Table Status\n');

  const connection = await getConnection();

  const altAddress = process.env.ALT_ADDRESS;
  if (!altAddress) {
    console.log('ALT_ADDRESS not configured in .env');
    console.log('\nRun: node scripts/setup-alt.js create');
    return;
  }

  console.log('ALT Address:', altAddress);

  try {
    const lookupTableAddress = new PublicKey(altAddress);
    const result = await connection.getAddressLookupTable(lookupTableAddress);

    if (!result.value) {
      console.log('\n✗ Lookup table not found on-chain');
      return;
    }

    const alt = result.value;
    console.log('Authority:', alt.state.authority?.toBase58() || 'None (frozen)');
    console.log('Deactivation Slot:', alt.state.deactivationSlot?.toString() || 'Active');
    console.log('Addresses:', alt.state.addresses.length);

    console.log('\nAddresses in table:');
    alt.state.addresses.forEach((addr, i) => {
      console.log(`  ${i.toString().padStart(2)}: ${addr.toBase58()}`);
    });

    // Calculate potential savings
    const addressCount = alt.state.addresses.length;
    const withoutAlt = addressCount * 32;
    const withAlt = addressCount * 1; // Just indexes
    console.log(`\nSize savings: ${withoutAlt} → ${withAlt} bytes (${withoutAlt - withAlt} bytes saved)`);
  } catch (error) {
    console.log('\n✗ Error:', error.message);
  }
}

// Main
const command = process.argv[2];

switch (command) {
  case 'create':
    createLookupTable().catch(console.error);
    break;
  case 'extend':
    extendLookupTable(process.argv[3]).catch(console.error);
    break;
  case 'status':
    showStatus().catch(console.error);
    break;
  default:
    console.log('Usage:');
    console.log('  node scripts/setup-alt.js create   # Create new ALT');
    console.log('  node scripts/setup-alt.js extend   # Extend existing ALT');
    console.log('  node scripts/setup-alt.js status   # Show ALT status');
}
