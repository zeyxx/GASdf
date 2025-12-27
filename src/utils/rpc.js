const { Connection } = require('@solana/web3.js');
const config = require('./config');

let connection = null;

function getConnection() {
  if (!connection) {
    connection = new Connection(config.RPC_URL, 'confirmed');
  }
  return connection;
}

async function getLatestBlockhash() {
  const conn = getConnection();
  return conn.getLatestBlockhash('confirmed');
}

async function sendTransaction(signedTx) {
  const conn = getConnection();
  const signature = await conn.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  return signature;
}

async function confirmTransaction(signature, blockhash, lastValidBlockHeight) {
  const conn = getConnection();
  const result = await conn.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );
  return result;
}

async function getBalance(pubkey) {
  const conn = getConnection();
  return conn.getBalance(pubkey);
}

async function getTokenBalance(pubkey, mint) {
  const conn = getConnection();
  const tokenAccounts = await conn.getTokenAccountsByOwner(pubkey, { mint });
  if (tokenAccounts.value.length === 0) return 0;

  const balance = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
  return parseInt(balance.value.amount);
}

/**
 * Check if a blockhash is still valid (not expired)
 * Blockhashes are valid for ~150 blocks (~60-90 seconds)
 */
async function isBlockhashValid(blockhash) {
  const conn = getConnection();
  try {
    const result = await conn.isBlockhashValid(blockhash, { commitment: 'confirmed' });
    return result.value;
  } catch (error) {
    // If RPC fails, we can't determine validity - reject for safety
    return false;
  }
}

/**
 * Simulate a transaction before sending
 * Returns { success: true } or { success: false, error: string, logs: string[] }
 */
async function simulateTransaction(signedTx) {
  const conn = getConnection();
  try {
    const result = await conn.simulateTransaction(signedTx, {
      sigVerify: true,
      commitment: 'confirmed',
    });

    if (result.value.err) {
      return {
        success: false,
        error: JSON.stringify(result.value.err),
        logs: result.value.logs || [],
        unitsConsumed: result.value.unitsConsumed,
      };
    }

    return {
      success: true,
      logs: result.value.logs || [],
      unitsConsumed: result.value.unitsConsumed,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      logs: [],
    };
  }
}

module.exports = {
  getConnection,
  getLatestBlockhash,
  sendTransaction,
  confirmTransaction,
  getBalance,
  getTokenBalance,
  isBlockhashValid,
  simulateTransaction,
};
