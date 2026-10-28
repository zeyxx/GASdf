#!/usr/bin/env node
// Test GASdf against local Surfpool RPC (LiteSVM mainnet fork)

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.SURFPOOL_RPC_URL || 'http://192.168.0.25:8899';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function main() {
  console.log(`Connecting to Surfpool RPC at ${RPC_URL}...`);
  const conn = new Connection(RPC_URL, 'confirmed');

  const version = await conn.getVersion();
  console.log('Surfpool Version:', version);

  const slot = await conn.getSlot();
  console.log('Current Slot:', slot);

  const acc = await conn.getParsedAccountInfo(new PublicKey(USDC_MINT));
  console.log('USDC Account Data parsed successfully:', acc.value !== null);
  if (acc.value && acc.value.data) {
    console.log('Supply:', acc.value.data.parsed.info.supply);
    console.log('Decimals:', acc.value.data.parsed.info.decimals);
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
