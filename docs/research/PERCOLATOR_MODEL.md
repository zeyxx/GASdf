# GASdf Percolator Model: Decentralized Gas-as-a-Service

**Status:** Draft / Active Development
**Vision:** Transform GASdf from a monolithic, centralized relayer into a Permissionless "Gas-as-a-Service" protocol, where Liquidity Providers (LPs) stake SOL to earn yield from memecoin communities.

## 1. The Core Philosophy (Percolator x GASdf)

Currently, a relayer operator must pay Solana network fees (Base + Priority) out of their own pocket and hope to extract value from the tokens they collect. This is capital intensive and centralized.

The **Percolator Model** decentralizes this by introducing **Delegated Proof of Gas**:
1. **LPs (The Stakers):** Users deposit `SOL` into an on-chain Vault (PDA) to provide liquidity for network fees.
2. **Communities (The Memecoins):** Any community can launch their own GASdf node (`organ-gasdf`) via the CYNIC Sovereign Cloud, choosing which token (e.g., `$BONK`) is accepted for gas.
3. **The Operator (The Node):** The community runs the stateless Node.js proxy with a Hot Wallet containing minimal SOL to physically sign transactions.

## 2. On-Chain Execution Flow (Pinocchio)

When a user initiates a gasless swap paying in `$BONK`:

1. **Transaction Construction**: The user signs a transaction that includes the `GASdf::RelayWithVault` instruction.
2. **Operator Signature**: The Operator's Hot Wallet (`organ-gasdf`) co-signs as the *Fee Payer*, paying the Solana network fee (e.g., 0.005 SOL).
3. **Atomic Settlement (Smart Contract)**:
   - The program transfers the `$BONK` fee from the User to the **Vault Token Account**.
   - The program transfers the exact network fee (0.005 SOL) + an optional operator bounty from the **Vault SOL Account** back to the **Operator's Hot Wallet**.
4. **The Yield**: The Vault now has slightly less SOL, but holds `$BONK`. LPs effectively DCA their `SOL` into `$BONK` at a premium (the service fee). LPs earn yield in memecoins while providing a public good (Gasless transactions).

## 3. CYNIC Sovereign Cloud Infrastructure

To make this frictionless, the CYNIC Cloud handles the underlying infrastructure:
- **1-Click Organ Deployment**: A community inputs their token mint. The cloud provisions a secure environment running `organ-gasdf`.
- **Hot Wallet Enclave**: The Operator Hot Wallet is generated inside a secure enclave. It cannot be extracted, and its only permission is to sign transactions invoking the specific `GASdf::RelayWithVault` instruction.
- **Observability**: The Organ emits JSONL logs to the CYNIC Kernel, allowing real-time tracking of LP APY, volume, and burn rates.

## 4. Security & Safety

- **Zero Operator Risk**: The Operator is reimbursed atomically in the same transaction. If the Vault runs out of SOL, the transaction fails before the Operator's SOL is spent (thanks to Solana's atomic simulation).
- **Zero LP Risk**: The Vault code is immutable and written in Pinocchio (ultra-low CU). Funds can only be moved if the equivalent value in Memecoins is deposited according to an on-chain oracle or fixed rate.

---
*“We are building the AWS of Gasless Solana transactions.”*
