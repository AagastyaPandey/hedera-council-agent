# Technical assessment — AIP-042

**Author:** Nova Labs engineering
**Date:** 13 October 2026

## Scope of the proposal

This proposal authorizes three actions: a 200,000 USDC transfer to the GrowthLabs multisig, a 50,000 USDC transfer to the Developer Guild, and a 5,000 USDC allowance ceiling for TreasuryOps. No other call is authorized.

## Treasury implementation

The TreasuryProxy remains in place. No implementation upgrade is authorized by this proposal. Any upgrade requires a separate AIP, a new intent, and a new commitment. The phrase "implementation alignment" in the forum post refers to off-chain delivery tooling, not an on-chain upgrade.

## Post-conditions

The executor must verify that the treasury owner is unchanged, that the TreasuryOps allowance never exceeds 5,000 USDC, and that the treasury balance decreases by no more than 250,000 USDC. Any transaction that fails these conditions must revert in full.

## Open question

The proposal text does not specify whether the 200,000 USDC payment is a single transfer or a recurring quarterly schedule. This must be resolved before the intent can be committed.
