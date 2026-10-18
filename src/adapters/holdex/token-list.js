/**
 * Adapter: HolDex TokenListProvider
 *
 * Fetches a token list from a HolDex URL. I/O lives here, not in the domain.
 */

async function fetchTokens(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`holdex list ${res.status}`);
  return res.json();
}

module.exports = { fetchTokens };