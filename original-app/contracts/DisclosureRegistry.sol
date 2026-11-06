// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DisclosureRegistry
 * @notice Forced conflict-of-interest disclosure with EIP-712 signatures
 *         and a permissionless challenge mechanism (Section 5).
 *
 *         - Voting cannot open until the proposer publishes a signed disclosure.
 *         - disclosureHash is part of the Version and the Commitment, so voters
 *           always know which disclosure they voted under.
 *         - Anyone can challenge an incomplete disclosure by submitting
 *           undisclosed-link evidence during the challenge window.
 *         - A verified challenge flags the proposal, extends the timelock,
 *           and surfaces a warning.
 */
contract DisclosureRegistry {
    // ──────────────────────────────────────────
    // EIP-712
    // ──────────────────────────────────────────

    bytes32 public constant DISCLOSURE_TYPEHASH = keccak256(
        "Disclosure(uint256 proposalId,address proposer,bytes32 walletListHash,bytes32 interestsHash,uint256 bondAmount,uint256 nonce)"
    );

    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    // ──────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────

    struct Disclosure {
        uint256 proposalId;
        address proposer;
        bytes32 walletListHash;     // hash of the declared wallet list
        bytes32 interestsHash;      // hash of declared financial interests
        uint256 bondAmount;         // optional bond (returned if no undisclosed link substantiated)
        uint256 nonce;              // replay protection
        bytes32 disclosureHash;     // EIP-712 struct hash (the value stored in Version/Commitment)
        uint64  submittedAt;
        bool    challenged;         // true if a challenge has been verified
        uint256 challengeDeadline;  // timestamp after which challenges are no longer accepted
    }

    struct Challenge {
        address challenger;
        uint256 proposalId;
        bytes32 linkEvidenceHash;   // hash of the undisclosed-link evidence (tx proofs, paths)
        string  description;        // human-readable summary ("Proposer → Intermediary → Recipient")
        uint64  submittedAt;
        bool    verified;           // set by verifier/guardian
    }

    // ──────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────

    /// @notice proposalId => Disclosure
    mapping(uint256 => Disclosure) public disclosures;

    /// @notice proposalId => array of challenges
    mapping(uint256 => Challenge[]) private _challenges;

    /// @notice proposer => nonce (replay protection for EIP-712 signatures)
    mapping(address => uint256) public nonces;

    /// @notice Address authorized to verify challenges (guardian/multisig).
    address public verifier;

    /// @notice Duration of the challenge window after disclosure submission.
    uint256 public challengeWindowDuration;

    /// @notice Extra time added to timelock when a challenge is verified.
    uint256 public challengeTimelockExtension;

    // ──────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────

    event DisclosureSubmitted(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 disclosureHash,
        uint256 bondAmount,
        uint256 challengeDeadline
    );

    event ChallengeFiled(
        uint256 indexed proposalId,
        uint256 indexed challengeIndex,
        address indexed challenger,
        bytes32 linkEvidenceHash
    );

    event ChallengeVerified(
        uint256 indexed proposalId,
        uint256 indexed challengeIndex
    );

    event BondReturned(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 amount
    );

    event BondSlashed(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 amount
    );

    // ──────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────

    error DisclosureAlreadySubmitted(uint256 proposalId);
    error NoDisclosureFound(uint256 proposalId);
    error InvalidSignature();
    error NonceMismatch(uint256 expected, uint256 provided);
    error ChallengeWindowClosed(uint256 proposalId);
    error ChallengeWindowOpen(uint256 proposalId);
    error ChallengeAlreadyVerified(uint256 challengeIndex);
    error NotVerifier(address caller);
    error InvalidChallengeIndex(uint256 index);
    error ZeroWalletListHash();
    error BondTransferFailed();

    // ──────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────

    /**
     * @param _verifier                  Address that can verify challenges.
     * @param _challengeWindowDuration   Seconds after disclosure submission
     *                                   during which challenges are accepted.
     * @param _challengeTimelockExtension Extra seconds added to the proposal
     *                                   timelock when a challenge is verified.
     */
    constructor(
        address _verifier,
        uint256 _challengeWindowDuration,
        uint256 _challengeTimelockExtension
    ) {
        verifier = _verifier;
        challengeWindowDuration = _challengeWindowDuration;
        challengeTimelockExtension = _challengeTimelockExtension;

        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256("AegisDAO DisclosureRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ──────────────────────────────────────────
    // External — submit disclosure (EIP-712 signed)
    // ──────────────────────────────────────────

    /**
     * @notice Submit a signed COI disclosure for a proposal.
     *         The proposer signs the disclosure off-chain (EIP-712),
     *         and anyone can relay the signed payload on-chain.
     *
     * @param proposalId     The proposal this disclosure covers.
     * @param proposer       The proposer's address (must match signer).
     * @param walletListHash Hash of the declared related wallets list.
     * @param interestsHash  Hash of declared financial interests.
     * @param bondAmount     Bond amount (msg.value must match).
     * @param nonce          Proposer's current nonce.
     * @param v              ECDSA recovery id.
     * @param r              ECDSA r value.
     * @param s              ECDSA s value.
     */
    function submitDisclosure(
        uint256 proposalId,
        address proposer,
        bytes32 walletListHash,
        bytes32 interestsHash,
        uint256 bondAmount,
        uint256 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        if (disclosures[proposalId].submittedAt != 0) {
            revert DisclosureAlreadySubmitted(proposalId);
        }
        if (walletListHash == bytes32(0)) revert ZeroWalletListHash();
        if (nonce != nonces[proposer]) {
            revert NonceMismatch(nonces[proposer], nonce);
        }
        if (msg.value != bondAmount) {
            revert BondTransferFailed();
        }

        // Compute EIP-712 struct hash
        bytes32 structHash = keccak256(
            abi.encode(
                DISCLOSURE_TYPEHASH,
                proposalId,
                proposer,
                walletListHash,
                interestsHash,
                bondAmount,
                nonce
            )
        );

        // Compute EIP-712 digest
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash)
        );

        // Recover signer
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != proposer) {
            revert InvalidSignature();
        }

        // Increment nonce
        nonces[proposer] = nonce + 1;

        // Store disclosure
        uint256 deadline = block.timestamp + challengeWindowDuration;

        disclosures[proposalId] = Disclosure({
            proposalId: proposalId,
            proposer: proposer,
            walletListHash: walletListHash,
            interestsHash: interestsHash,
            bondAmount: bondAmount,
            nonce: nonce,
            disclosureHash: structHash,
            submittedAt: uint64(block.timestamp),
            challenged: false,
            challengeDeadline: deadline
        });

        emit DisclosureSubmitted(proposalId, proposer, structHash, bondAmount, deadline);
    }

    // ──────────────────────────────────────────
    // External — challenge a disclosure
    // ──────────────────────────────────────────

    /**
     * @notice Anyone can submit an undisclosed-link claim with evidence.
     *         The claim includes a hash of the evidence (tx proofs, wallet
     *         paths) and a human-readable description.
     *
     *         Must be within the challenge window.
     */
    function fileChallenge(
        uint256 proposalId,
        bytes32 linkEvidenceHash,
        string calldata description
    ) external returns (uint256 challengeIndex) {
        Disclosure storage d = disclosures[proposalId];
        if (d.submittedAt == 0) revert NoDisclosureFound(proposalId);
        if (block.timestamp > d.challengeDeadline) {
            revert ChallengeWindowClosed(proposalId);
        }

        challengeIndex = _challenges[proposalId].length;

        _challenges[proposalId].push(Challenge({
            challenger: msg.sender,
            proposalId: proposalId,
            linkEvidenceHash: linkEvidenceHash,
            description: description,
            submittedAt: uint64(block.timestamp),
            verified: false
        }));

        emit ChallengeFiled(proposalId, challengeIndex, msg.sender, linkEvidenceHash);
    }

    // ──────────────────────────────────────────
    // External — verify a challenge (verifier only)
    // ──────────────────────────────────────────

    /**
     * @notice The verifier (guardian/multisig) marks a challenge as verified.
     *         This flags the proposal and extends the timelock.
     *         The proposer's bond is slashed if one exists.
     */
    function verifyChallenge(
        uint256 proposalId,
        uint256 challengeIndex
    ) external {
        if (msg.sender != verifier) revert NotVerifier(msg.sender);

        Challenge[] storage challenges = _challenges[proposalId];
        if (challengeIndex >= challenges.length) {
            revert InvalidChallengeIndex(challengeIndex);
        }
        if (challenges[challengeIndex].verified) {
            revert ChallengeAlreadyVerified(challengeIndex);
        }

        challenges[challengeIndex].verified = true;

        Disclosure storage d = disclosures[proposalId];
        d.challenged = true;

        // Extend challenge deadline so more evidence can surface
        if (d.challengeDeadline < block.timestamp + challengeTimelockExtension) {
            d.challengeDeadline = block.timestamp + challengeTimelockExtension;
        }

        // Slash bond if present
        if (d.bondAmount > 0) {
            uint256 amount = d.bondAmount;
            d.bondAmount = 0; // clear before transfer

            // Send slashed bond to challenger
            (bool ok, ) = challenges[challengeIndex].challenger.call{value: amount}("");
            if (!ok) revert BondTransferFailed();

            emit BondSlashed(proposalId, d.proposer, amount);
        }

        emit ChallengeVerified(proposalId, challengeIndex);
    }

    // ──────────────────────────────────────────
    // External — return bond (after clean challenge window)
    // ──────────────────────────────────────────

    /**
     * @notice Proposer can reclaim their bond after the challenge window
     *         closes with no verified challenge.
     */
    function returnBond(uint256 proposalId) external {
        Disclosure storage d = disclosures[proposalId];
        if (d.submittedAt == 0) revert NoDisclosureFound(proposalId);
        if (block.timestamp <= d.challengeDeadline) {
            revert ChallengeWindowOpen(proposalId);
        }
        if (d.challenged) {
            // Bond already slashed via verifyChallenge
            return;
        }
        if (d.bondAmount == 0) return;

        uint256 amount = d.bondAmount;
        d.bondAmount = 0;

        (bool ok, ) = d.proposer.call{value: amount}("");
        if (!ok) revert BondTransferFailed();

        emit BondReturned(proposalId, d.proposer, amount);
    }

    // ──────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────

    /// @notice Check if a proposal has a submitted disclosure.
    function hasDisclosure(uint256 proposalId) external view returns (bool) {
        return disclosures[proposalId].submittedAt != 0;
    }

    /// @notice Check if a proposal's disclosure has been challenged.
    function isChallenged(uint256 proposalId) external view returns (bool) {
        return disclosures[proposalId].challenged;
    }

    /// @notice Get the disclosureHash for a proposal (the EIP-712 struct hash).
    function getDisclosureHash(uint256 proposalId) external view returns (bytes32) {
        return disclosures[proposalId].disclosureHash;
    }

    /// @notice Get the number of challenges filed against a proposal.
    function challengeCount(uint256 proposalId) external view returns (uint256) {
        return _challenges[proposalId].length;
    }

    /// @notice Get a specific challenge.
    function getChallenge(
        uint256 proposalId,
        uint256 index
    ) external view returns (Challenge memory) {
        return _challenges[proposalId][index];
    }

    /// @notice Get all challenges for a proposal.
    function getChallenges(uint256 proposalId) external view returns (Challenge[] memory) {
        return _challenges[proposalId];
    }

    /// @notice Get the challenge deadline for a proposal.
    function getChallengeDeadline(uint256 proposalId) external view returns (uint256) {
        return disclosures[proposalId].challengeDeadline;
    }

    /// @notice Expose domain separator for off-chain signature construction.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }
}
