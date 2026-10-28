/**
 * Atomic Subscription Transaction Builder Adapter.
 * Uses @solana/kit and @solana-program/token.
 * Proven pattern: Jupiter swap (user wallet) -> decode wire tx -> decompile with ALTs
 * -> swap fee payer to Kora signer -> append SPL BurnChecked -> recompress.
 */

import {
  address,
  type Address,
  type Instruction,
  createSolanaRpc,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessageFetchingLookupTables,
} from '@solana/kit';
import { fetchAddressLookupTable } from '@solana-program/address-lookup-table';
import {
  getBurnCheckedInstruction,
  getCloseAccountInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { ASDF_MINT } from '../../domain/quote/decision.js';

export interface VerifyAtomicTxParams {
  base64WireTx: string;
  expectedBuyerPubkey: string;
  expectedFeePayer: string;
  expectedBurnAmountBaseUnits: bigint;
}

export interface VerifyAtomicTxResult {
  valid: boolean;
  reason?: string;
  burnFound?: boolean;
  burnAmount?: bigint;
}

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASDF_MINT_ADDRESS = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

export function verifyAtomicSubscriptionTxIntegrity(
  params: VerifyAtomicTxParams,
): VerifyAtomicTxResult {
  try {
    const wireBytes = getBase64Encoder().encode(params.base64WireTx);
    const decoded = getTransactionDecoder().decode(wireBytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);

    if (!compiled || compiled.version !== 0) {
      return { valid: false, reason: 'Unsupported or invalid transaction version' };
    }

    if (!compiled.staticAccounts || compiled.staticAccounts.length === 0) {
      return { valid: false, reason: 'No static accounts in transaction' };
    }

    if (compiled.staticAccounts[0] !== params.expectedFeePayer) {
      return { valid: false, reason: 'Fee payer mismatch' };
    }

    const buyer = params.expectedBuyerPubkey;
    const numSigners = compiled.header?.numSignerAccounts ?? 0;
    const buyerIsSigner = compiled.staticAccounts
      .slice(0, numSigners)
      .includes(buyer as (typeof compiled.staticAccounts)[number]);
    if (!compiled.staticAccounts.includes(buyer as (typeof compiled.staticAccounts)[number]) && !buyerIsSigner) {
      return { valid: false, reason: 'Buyer not present in transaction' };
    }

    for (const ix of compiled.instructions ?? []) {
      const programId = compiled.staticAccounts[ix.programAddressIndex];
      if (programId !== TOKEN_PROGRAM_ID) continue;

      const data = ix.data as Uint8Array | undefined;
      if (!data || data.length === 0) continue;

      const discriminator = data[0];
      if (discriminator !== 15 && discriminator !== 8) continue;

      const accountIndices = ix.accountIndices ?? [];
      if (accountIndices.length < 3) continue;

      const mintAddr = compiled.staticAccounts[accountIndices[1]];
      const authorityAddr = compiled.staticAccounts[accountIndices[2]];
      if (mintAddr !== ASDF_MINT_ADDRESS) continue;
      if (authorityAddr !== buyer) continue;

      let burnAmount: bigint | undefined;
      if (discriminator === 15) {
        if (data.length < 9) {
          return { valid: false, reason: 'Invalid BurnChecked instruction data', burnFound: true };
        }
        let amt = 0n;
        for (let i = 0; i < 8; i++) {
          amt |= BigInt(data[1 + i]) << BigInt(8 * i);
        }
        burnAmount = amt;
        if (amt !== params.expectedBurnAmountBaseUnits) {
          return {
            valid: false,
            reason: 'Burn amount mismatch',
            burnFound: true,
            burnAmount: amt,
          };
        }
      } else if (data.length >= 9) {
        let amt = 0n;
        for (let i = 0; i < 8; i++) {
          amt |= BigInt(data[1 + i]) << BigInt(8 * i);
        }
        burnAmount = amt;
        if (amt !== params.expectedBurnAmountBaseUnits) {
          return {
            valid: false,
            reason: 'Burn amount mismatch',
            burnFound: true,
            burnAmount: amt,
          };
        }
      }

      return { valid: true, burnFound: true, burnAmount: burnAmount ?? params.expectedBurnAmountBaseUnits };
    }

    return { valid: false, reason: 'No valid burn instruction found', burnFound: false };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Failed to decode transaction',
    };
  }
}

export interface BuildAtomicSubscriptionTxParams {
  userWallet: string;
  inputMint: string;
  inputAmountBaseUnits: bigint;
  burnAsdfBaseUnits: bigint;
  feePayerAddress: string;
  rpcUrl: string;
  jupiterApiKey?: string;
  slippageBps?: number;
  wrapAndUnwrapSol?: boolean;
}

export class AtomicSubscriptionTxBuilder {
  private jupiterBaseUrl: string;

  constructor(jupiterBaseUrl: string = 'https://lite-api.jup.ag/swap/v1') {
    this.jupiterBaseUrl = jupiterBaseUrl;
  }

  /**
   * Fetches quote and wire transaction from Jupiter swap endpoint.
   */
  async fetchJupiterSwapTx(
    userWallet: Address,
    inputMint: Address,
    amountBaseUnits: bigint,
    slippageBps: number = 50,
    wrapAndUnwrapSol: boolean = true,
    jupiterApiKey?: string,
  ): Promise<{ quoteOutAmount: string; wireTransaction: string }> {
    const headers: Record<string, string> = {};
    if (jupiterApiKey) headers['x-api-key'] = jupiterApiKey;
    const quoteUrl = `${this.jupiterBaseUrl}/quote?inputMint=${inputMint}&outputMint=${ASDF_MINT}&amount=${amountBaseUnits}&slippageBps=${slippageBps}`;
    const quoteRes = await fetch(quoteUrl, { headers });
    if (!quoteRes.ok) {
      throw new Error(`Jupiter quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
    }
    const quoteData = (await quoteRes.json()) as { outAmount: string };

    const swapUrl = `${this.jupiterBaseUrl}/swap`;
    const swapRes = await fetch(swapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: userWallet,
        wrapAndUnwrapSol,
      }),
    });

    if (!swapRes.ok) {
      throw new Error(`Jupiter swap failed: ${swapRes.status} ${await swapRes.text()}`);
    }

    const swapData = (await swapRes.json()) as { swapTransaction: string };
    return { quoteOutAmount: quoteData.outAmount, wireTransaction: swapData.swapTransaction };
  }

  /**
   * Builds the complete atomic wire transaction (Base64) ready for user signature.
   */
  async buildAtomicSubscriptionTx(params: BuildAtomicSubscriptionTxParams): Promise<{
    base64WireTx: string;
    recentBlockhash: string;
    burnAmountBaseUnits: string;
  }> {
    const rpc = createSolanaRpc(params.rpcUrl);
    const userWalletAddr = address(params.userWallet);
    const inputMintAddr = address(params.inputMint);
    const feePayerAddr = address(params.feePayerAddress);

    // 1. Fetch swap transaction from Jupiter
    const swapPlan = await this.fetchJupiterSwapTx(
      userWalletAddr,
      inputMintAddr,
      params.inputAmountBaseUnits,
      params.slippageBps ?? 50,
      params.wrapAndUnwrapSol ?? true,
      params.jupiterApiKey,
    );

    // 2. Decode wire transaction & decompile fetching ALTs
    const wireBytes = getBase64Encoder().encode(swapPlan.wireTransaction);
    const decoded = getTransactionDecoder().decode(wireBytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
    if (compiled.version !== 0) {
      throw new Error('Only v0 transactions supported');
    }

    const decompiled = await decompileTransactionMessageFetchingLookupTables(compiled, rpc);

    // 3. Cache Address Lookup Tables for recompression
    const lookupAddresses = compiled.addressTableLookups?.map((l) => l.lookupTableAddress) ?? [];
    const addressesByLookupTableAddress: Record<Address, Address[]> = {};
    for (const tableAddress of lookupAddresses) {
      const table = await fetchAddressLookupTable(rpc, tableAddress);
      addressesByLookupTableAddress[tableAddress] = [...table.data.addresses];
    }

    // 4. Derive user's ASDF ATA & check on-chain existence
    const [userAsdfAta] = await findAssociatedTokenPda({
      mint: address(ASDF_MINT),
      owner: userWalletAddr,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // Check if user already holds an ATA on-chain
    let userHadAta = false;
    try {
      const ataInfo = await rpc.getAccountInfo(userAsdfAta).send();
      userHadAta = ataInfo.value !== null;
    } catch {
      userHadAta = false;
    }

    // 5. Append SPL BurnChecked instruction
    const burnIx = getBurnCheckedInstruction({
      account: userAsdfAta,
      mint: address(ASDF_MINT),
      authority: userWalletAddr,
      amount: params.burnAsdfBaseUnits,
      decimals: 6, // ASDF has 6 decimals
    });

    const instructions: Instruction[] = [...decompiled.instructions, burnIx as unknown as Instruction];

    // If user did not have an ATA beforehand, close it post-burn and refund rent to feePayer
    if (!userHadAta) {
      const closeIx = getCloseAccountInstruction({
        account: userAsdfAta,
        destination: feePayerAddr,
        owner: userWalletAddr,
      });
      instructions.push(closeIx as unknown as Instruction);
    }

    // 6. Refresh blockhash & re-point Fee Payer to Kora
    if (decompiled.version !== 0) {
      throw new Error('Only v0 transaction messages supported');
    }

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    let message = { ...decompiled, instructions };
    message = setTransactionMessageFeePayer(feePayerAddr, message);
    message = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message);

    // 7. Recompress with ALTs preserved
    const compressed = compressTransactionMessageUsingAddressLookupTables(
      message,
      addressesByLookupTableAddress,
    );

    // 8. Compile transaction and return wire transaction base64 ready for user signature
    const compiledTx = compileTransaction(compressed);
    const wireTx = getBase64EncodedWireTransaction(compiledTx);

    return {
      base64WireTx: wireTx,
      recentBlockhash: latestBlockhash.blockhash,
      burnAmountBaseUnits: params.burnAsdfBaseUnits.toString(),
    };
  }
}
