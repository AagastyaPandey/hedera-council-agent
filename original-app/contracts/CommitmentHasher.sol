// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CommitmentHasher
 * @notice Produces the cryptographic execution commitment defined in
 *         AegisDAO IntentLock Section 4.1. Used both in the real executor
 *         and as the ground-truth reference for TypeScript parity tests.
 *
 *         commitment = keccak256(abi.encode(
 *             COMMIT_TYPEHASH,
 *             chainId,
 *             executor,
 *             proposalId,
 *             version,
 *             versionHash,
 *             actionsHash,
 *             intentHash,
 *             disclosureHash
 *         ))
 */
contract CommitmentHasher {
    bytes32 public constant COMMIT_TYPEHASH = keccak256(
        "Commitment(uint256 chainId,address executor,uint256 proposalId,uint256 version,bytes32 versionHash,bytes32 actionsHash,bytes32 intentHash,bytes32 disclosureHash)"
    );

    /// @notice Represents a single executable action in a proposal.
    struct Action {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Hash an ordered array of actions. Matches Section 4.1 hashActions.
    /// @dev    Each action leaf = keccak256(abi.encode(target, value, keccak256(data)))
    ///         actionsHash     = keccak256(abi.encodePacked(leaves))
    function hashActions(Action[] calldata actions) public pure returns (bytes32) {
        bytes32[] memory leaves = new bytes32[](actions.length);
        for (uint256 i; i < actions.length; ++i) {
            leaves[i] = keccak256(
                abi.encode(
                    actions[i].target,
                    actions[i].value,
                    keccak256(actions[i].data)
                )
            );
        }
        return keccak256(abi.encodePacked(leaves));
    }

    /// @notice Compute the full commitment hash.
    function computeCommitment(
        uint256 chainId,
        address executor,
        uint256 proposalId,
        uint256 version,
        bytes32 versionHash,
        bytes32 actionsHash,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                COMMIT_TYPEHASH,
                chainId,
                executor,
                proposalId,
                version,
                versionHash,
                actionsHash,
                intentHash,
                disclosureHash
            )
        );
    }

    /// @notice Convenience: hash actions then compute full commitment in one call.
    function computeCommitmentWithActions(
        uint256 chainId,
        address executor,
        uint256 proposalId,
        uint256 version,
        bytes32 versionHash,
        Action[] calldata actions,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) public pure returns (bytes32 commitment, bytes32 actionsHash) {
        actionsHash = hashActions(actions);
        commitment = computeCommitment(
            chainId,
            executor,
            proposalId,
            version,
            versionHash,
            actionsHash,
            intentHash,
            disclosureHash
        );
    }

    /// @notice Expose the COMMIT_TYPEHASH for parity testing.
    function getCommitTypehash() public pure returns (bytes32) {
        return COMMIT_TYPEHASH;
    }
}
