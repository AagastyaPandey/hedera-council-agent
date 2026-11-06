// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProposalRegistry
 * @notice Append-only, hash-chained proposal version registry (Section 3.1).
 *
 *         Every edit creates a new Version. Versions are chained via
 *         prevVersionHash, content-addressed, and immutable once stored.
 *         Nothing can be edited or deleted — amendments are new versions
 *         pointing at the previous one.
 *
 *         Voting binds to one specific versionHash. Any change after voting
 *         begins creates a new version and requires a new vote.
 */
contract ProposalRegistry {
    // ──────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────

    struct Version {
        bytes32 prevVersionHash;           // 0x0 for the first version
        bytes32 contentHash;               // hash of the proposal text
        bytes32 evidenceRoot;              // Merkle root of evidence manifest
        bytes32 financialAssumptionsHash;
        bytes32 technicalAssessmentHash;
        bytes32 intentHash;                // hash of confirmed structured intent
        bytes32 disclosureHash;            // hash of COI disclosure
        uint64  timestamp;
        address author;
    }

    // ──────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────

    /// @notice Next proposal ID to be assigned.
    uint256 public nextProposalId = 1;

    /// @notice proposalId => ordered list of version hashes.
    mapping(uint256 => bytes32[]) private _versionChain;

    /// @notice versionHash => full Version struct.
    mapping(bytes32 => Version) private _versions;

    /// @notice versionHash => proposalId (reverse lookup).
    mapping(bytes32 => uint256) private _versionToProposal;

    /// @notice proposalId => original author (creator of v1).
    mapping(uint256 => address) public proposalAuthor;

    // ──────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed versionHash,
        address indexed author
    );

    event VersionAdded(
        uint256 indexed proposalId,
        uint256 versionNumber,
        bytes32 indexed versionHash,
        bytes32 indexed prevVersionHash,
        address author
    );

    // ──────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────

    error ProposalDoesNotExist(uint256 proposalId);
    error NotProposalAuthor(uint256 proposalId, address caller);
    error PrevVersionMismatch(bytes32 expected, bytes32 provided);
    error VersionAlreadyExists(bytes32 versionHash);
    error ZeroContentHash();

    // ──────────────────────────────────────────
    // External — create a new proposal (v1)
    // ──────────────────────────────────────────

    /**
     * @notice Create a brand-new proposal with its first version.
     * @return proposalId  The assigned proposal ID.
     * @return versionHash The hash of the first version.
     */
    function createProposal(
        bytes32 contentHash,
        bytes32 evidenceRoot,
        bytes32 financialAssumptionsHash,
        bytes32 technicalAssessmentHash,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) external returns (uint256 proposalId, bytes32 versionHash) {
        if (contentHash == bytes32(0)) revert ZeroContentHash();

        proposalId = nextProposalId++;

        Version memory v = Version({
            prevVersionHash: bytes32(0),
            contentHash: contentHash,
            evidenceRoot: evidenceRoot,
            financialAssumptionsHash: financialAssumptionsHash,
            technicalAssessmentHash: technicalAssessmentHash,
            intentHash: intentHash,
            disclosureHash: disclosureHash,
            timestamp: uint64(block.timestamp),
            author: msg.sender
        });

        versionHash = _hashVersion(v);

        if (_versions[versionHash].timestamp != 0) {
            revert VersionAlreadyExists(versionHash);
        }

        _versions[versionHash] = v;
        _versionChain[proposalId].push(versionHash);
        _versionToProposal[versionHash] = proposalId;
        proposalAuthor[proposalId] = msg.sender;

        emit ProposalCreated(proposalId, versionHash, msg.sender);
        emit VersionAdded(proposalId, 1, versionHash, bytes32(0), msg.sender);
    }

    // ──────────────────────────────────────────
    // External — add a new version (amendment)
    // ──────────────────────────────────────────

    /**
     * @notice Append a new version to an existing proposal.
     *         Only the original proposal author can amend.
     *         The amendment must point to the current latest version.
     * @return versionHash The hash of the new version.
     */
    function addVersion(
        uint256 proposalId,
        bytes32 contentHash,
        bytes32 evidenceRoot,
        bytes32 financialAssumptionsHash,
        bytes32 technicalAssessmentHash,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) external returns (bytes32 versionHash) {
        if (_versionChain[proposalId].length == 0) {
            revert ProposalDoesNotExist(proposalId);
        }
        if (msg.sender != proposalAuthor[proposalId]) {
            revert NotProposalAuthor(proposalId, msg.sender);
        }
        if (contentHash == bytes32(0)) revert ZeroContentHash();

        bytes32 prevHash = latestVersionHash(proposalId);

        Version memory v = Version({
            prevVersionHash: prevHash,
            contentHash: contentHash,
            evidenceRoot: evidenceRoot,
            financialAssumptionsHash: financialAssumptionsHash,
            technicalAssessmentHash: technicalAssessmentHash,
            intentHash: intentHash,
            disclosureHash: disclosureHash,
            timestamp: uint64(block.timestamp),
            author: msg.sender
        });

        versionHash = _hashVersion(v);

        if (_versions[versionHash].timestamp != 0) {
            revert VersionAlreadyExists(versionHash);
        }

        _versions[versionHash] = v;
        _versionChain[proposalId].push(versionHash);
        _versionToProposal[versionHash] = proposalId;

        uint256 versionNumber = _versionChain[proposalId].length;
        emit VersionAdded(proposalId, versionNumber, versionHash, prevHash, msg.sender);
    }

    // ──────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────

    /// @notice Get the latest version hash for a proposal.
    function latestVersionHash(uint256 proposalId) public view returns (bytes32) {
        bytes32[] storage chain = _versionChain[proposalId];
        if (chain.length == 0) revert ProposalDoesNotExist(proposalId);
        return chain[chain.length - 1];
    }

    /// @notice Get the total number of versions for a proposal.
    function versionCount(uint256 proposalId) external view returns (uint256) {
        return _versionChain[proposalId].length;
    }

    /// @notice Get the version hash at a specific index (0-based).
    function versionAtIndex(uint256 proposalId, uint256 index) external view returns (bytes32) {
        return _versionChain[proposalId][index];
    }

    /// @notice Get the full Version struct for a given hash.
    function getVersion(bytes32 versionHash) external view returns (Version memory) {
        return _versions[versionHash];
    }

    /// @notice Get the proposal ID that a version belongs to.
    function getProposalId(bytes32 versionHash) external view returns (uint256) {
        return _versionToProposal[versionHash];
    }

    /// @notice Get the entire version chain for a proposal.
    function getVersionChain(uint256 proposalId) external view returns (bytes32[] memory) {
        return _versionChain[proposalId];
    }

    /// @notice Verify the hash chain integrity for a proposal.
    /// @return valid True if every version's prevVersionHash matches the
    ///         preceding entry and every stored hash recomputes correctly.
    function verifyChain(uint256 proposalId) external view returns (bool valid) {
        bytes32[] storage chain = _versionChain[proposalId];
        if (chain.length == 0) return false;

        for (uint256 i; i < chain.length; ++i) {
            Version storage v = _versions[chain[i]];
            bytes32 recomputed = _hashVersion(v);

            // Stored hash must match recomputation.
            if (recomputed != chain[i]) return false;

            // First version must point to 0x0; subsequent must point to previous.
            if (i == 0) {
                if (v.prevVersionHash != bytes32(0)) return false;
            } else {
                if (v.prevVersionHash != chain[i - 1]) return false;
            }
        }
        return true;
    }

    // ──────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────

    /// @dev Compute the keccak256 hash of a Version struct (content-addressed).
    function _hashVersion(Version memory v) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                v.prevVersionHash,
                v.contentHash,
                v.evidenceRoot,
                v.financialAssumptionsHash,
                v.technicalAssessmentHash,
                v.intentHash,
                v.disclosureHash,
                v.timestamp,
                v.author
            )
        );
    }
}
