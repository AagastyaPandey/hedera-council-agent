// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ProposalRegistry.sol";
import "./DisclosureRegistry.sol";
import "./IntentLockExecutor.sol";

/**
 * @title IntentGovernor
 * @notice Governance contract for AegisDAO IntentLock.
 *
 *         Manages the full proposal lifecycle:
 *         Draft → DisclosurePending → VotingOpen → Passed → Queued → Executed/Halted/Defeated
 *
 *         Voting is on a **commitment**, not a summary. The commitment is
 *         immutable once voting opens — any change creates a new version
 *         and a new vote round.
 *
 *         Supports `voteWithBrief` so voters can record which risk brief
 *         version they acknowledged, feeding the informed-vote ratio in
 *         the Evaluation Chain.
 *
 * @dev    See Sections 4.3, 5.1, 9.5 of the blueprint.
 */
contract IntentGovernor {
    // ──────────────────────────────────────────
    // EIP-712
    // ──────────────────────────────────────────

    string public constant EIP712_NAME = "AegisIntentGovernor";
    string public constant EIP712_VERSION = "1";

    bytes32 public constant INTENT_VOTE_TYPEHASH = keccak256(
        "IntentVote(uint256 govId,bytes32 commitment,uint8 support,bytes32 briefHash,string statement,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ──────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────

    enum GovProposalState {
        Draft,               // 0
        DisclosurePending,   // 1
        VotingOpen,          // 2
        Defeated,            // 3
        Passed,              // 4
        Queued,              // 5
        Executed,            // 6
        Halted,              // 7
        Cancelled            // 8
    }

    struct GovProposal {
        uint256            proposalId;
        bytes32            versionHash;        // version being voted on
        uint256            version;
        bytes32            commitment;          // full commitment hash
        bytes32            actionsHash;
        bytes32            intentHash;
        bytes32            disclosureHash;

        GovProposalState   state;

        // Voting parameters
        uint256            voteStart;           // block.timestamp when voting opens
        uint256            voteEnd;             // block.timestamp when voting closes
        uint256            snapshotBlock;       // block number for balance snapshot

        // Vote tallies
        uint256            forVotes;
        uint256            againstVotes;
        uint256            abstainVotes;

        // Informed voting
        uint256            informedForVotes;    // votes cast with a brief acknowledgment
        uint256            totalBriefAcks;      // count of voters who acknowledged a brief

        address            proposer;
    }

    struct Vote {
        uint8   support;       // 0 = against, 1 = for, 2 = abstain
        uint256 weight;
        bytes32 briefHash;     // 0x0 if not acknowledged
        bool    hasVoted;
    }

    // ──────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────

    /// @notice Governance token used for voting weight.
    IERC20 public immutable votingToken;

    /// @notice Proposal Registry for version verification.
    ProposalRegistry public immutable registry;

    /// @notice Disclosure Registry for COI checks.
    DisclosureRegistry public immutable disclosureRegistry;

    /// @notice Executor for queuing and execution.
    IntentLockExecutor public immutable executor;

    /// @notice Voting period duration in seconds.
    uint256 public votingPeriod;

    /// @notice Minimum tokens required for quorum (absolute amount).
    uint256 public quorum;

    /// @notice Timelock delay for queued proposals (seconds).
    uint256 public timelockDelay;

    /// @notice Next governance proposal nonce.
    uint256 public nextGovId = 1;

    /// @notice govId => GovProposal
    mapping(uint256 => GovProposal) public govProposals;

    /// @notice govId => voter => Vote
    mapping(uint256 => mapping(address => Vote)) public votes;

    /// @notice commitment => govId (reverse lookup)
    mapping(bytes32 => uint256) public commitmentToGovId;

    /// @notice voter => EIP-712 nonce (replay protection for signed votes)
    mapping(address => uint256) public nonces;

    // ──────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────

    event ProposalSubmitted(
        uint256 indexed govId,
        uint256 indexed proposalId,
        bytes32 commitment,
        address proposer
    );

    event DisclosureLinked(uint256 indexed govId, bytes32 disclosureHash);

    event VotingOpened(uint256 indexed govId, uint256 voteStart, uint256 voteEnd);

    event VoteCast(
        uint256 indexed govId,
        address indexed voter,
        uint8   support,
        uint256 weight,
        bytes32 briefHash
    );

    event VoteRelayed(
        uint256 indexed govId,
        address indexed voter,
        address indexed relayer,
        bytes32 briefHash
    );

    event ProposalPassed(uint256 indexed govId, bytes32 commitment);
    event ProposalDefeated(uint256 indexed govId);
    event ProposalQueuedInExecutor(uint256 indexed govId, bytes32 commitment);
    event ProposalCancelled(uint256 indexed govId);

    // ──────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────

    error InvalidState(GovProposalState expected, GovProposalState actual);
    error NotProposer(address caller, address expected);
    error NoDisclosure(uint256 proposalId);
    error DisclosureChallenged(uint256 proposalId);
    error AlreadyVoted(address voter);
    error VotingNotOpen(uint256 govId);
    error VotingStillOpen(uint256 govId);
    error InsufficientVotingPower(address voter);
    error QuorumNotReached(uint256 totalVotes, uint256 required);
    error ZeroCommitment();
    error BadSignature();
    error SignatureExpired(uint256 deadline);
    error NonceUsed(address signer, uint256 nonce);

    // ──────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────

    constructor(
        address _votingToken,
        address _registry,
        address _disclosureRegistry,
        address _executor,
        uint256 _votingPeriod,
        uint256 _quorum,
        uint256 _timelockDelay
    ) {
        votingToken = IERC20(_votingToken);
        registry = ProposalRegistry(_registry);
        disclosureRegistry = DisclosureRegistry(_disclosureRegistry);
        executor = IntentLockExecutor(payable(_executor));
        votingPeriod = _votingPeriod;
        quorum = _quorum;
        timelockDelay = _timelockDelay;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes("AegisIntentGovernor")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ──────────────────────────────────────────
    // Step 1: Submit proposal (Draft → DisclosurePending)
    // ──────────────────────────────────────────

    /**
     * @notice Submit a governance proposal with its commitment.
     *         The commitment binds the exact version, actions, intent,
     *         and disclosure that voters will vote on.
     *
     *         State: Draft → DisclosurePending
     */
    function submitProposal(
        uint256 proposalId,
        uint256 version,
        bytes32 versionHash,
        bytes32 actionsHash,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) external returns (uint256 govId) {
        if (actionsHash == bytes32(0)) revert ZeroCommitment();

        // Verify proposer is the proposal author
        address author = registry.proposalAuthor(proposalId);
        if (msg.sender != author) {
            revert NotProposer(msg.sender, author);
        }

        // Verify the versionHash exists and matches
        bytes32 latestVersion = registry.latestVersionHash(proposalId);
        // The submitted versionHash must be the latest
        require(versionHash == latestVersion, "Version is not latest");

        // Compute commitment (must match executor's computation)
        bytes32 commitment = _computeCommitment(
            proposalId, version, versionHash,
            actionsHash, intentHash, disclosureHash
        );

        govId = nextGovId++;

        govProposals[govId] = GovProposal({
            proposalId: proposalId,
            versionHash: versionHash,
            version: version,
            commitment: commitment,
            actionsHash: actionsHash,
            intentHash: intentHash,
            disclosureHash: disclosureHash,
            state: GovProposalState.DisclosurePending,
            voteStart: 0,
            voteEnd: 0,
            snapshotBlock: 0,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            informedForVotes: 0,
            totalBriefAcks: 0,
            proposer: msg.sender
        });

        commitmentToGovId[commitment] = govId;

        emit ProposalSubmitted(govId, proposalId, commitment, msg.sender);
    }

    // ──────────────────────────────────────────
    // Step 2: Open voting (DisclosurePending → VotingOpen)
    // ──────────────────────────────────────────

    /**
     * @notice Open voting. Requires a disclosure to be submitted.
     *         Voting cannot open without disclosure.
     *
     *         State: DisclosurePending → VotingOpen
     */
    function openVoting(uint256 govId) external {
        GovProposal storage p = govProposals[govId];
        if (p.state != GovProposalState.DisclosurePending) {
            revert InvalidState(GovProposalState.DisclosurePending, p.state);
        }
        if (msg.sender != p.proposer) {
            revert NotProposer(msg.sender, p.proposer);
        }

        // Voting cannot open without a disclosure
        if (!disclosureRegistry.hasDisclosure(p.proposalId)) {
            revert NoDisclosure(p.proposalId);
        }

        // Verify disclosure hash matches what was committed
        bytes32 storedDiscHash = disclosureRegistry.getDisclosureHash(p.proposalId);
        require(storedDiscHash == p.disclosureHash, "Disclosure hash mismatch");

        // Cannot open voting if disclosure is challenged
        if (disclosureRegistry.isChallenged(p.proposalId)) {
            revert DisclosureChallenged(p.proposalId);
        }

        p.state = GovProposalState.VotingOpen;
        p.voteStart = block.timestamp;
        p.voteEnd = block.timestamp + votingPeriod;
        p.snapshotBlock = block.number;

        // Commitment is now immutable — any change requires a new proposal
        emit VotingOpened(govId, p.voteStart, p.voteEnd);
        emit DisclosureLinked(govId, p.disclosureHash);
    }

    // ──────────────────────────────────────────
    // Step 3: Cast votes
    // ──────────────────────────────────────────

    /**
     * @notice Cast a vote on a governance proposal.
     * @param govId   The governance proposal ID.
     * @param support 0 = against, 1 = for, 2 = abstain.
     */
    function castVote(uint256 govId, uint8 support) external {
        _castVote(govId, support, bytes32(0));
    }

    /**
     * @notice Cast a vote with a brief acknowledgment hash.
     *         Records which risk brief version the voter saw,
     *         feeding the informed-vote ratio in Stage 3.
     *
     * @param govId     The governance proposal ID.
     * @param support   0 = against, 1 = for, 2 = abstain.
     * @param briefHash Hash of the risk brief version acknowledged.
     */
    function voteWithBrief(
        uint256 govId,
        uint8 support,
        bytes32 briefHash
    ) external {
        _castVote(govId, support, briefHash);
    }

    /**
     * @notice Cast a vote with an EIP-712 signature. A relayer submits the
     *         transaction; the voter's key never leaves the signing device.
     *
     *         The commitment is read from governor storage, never supplied by
     *         the caller, so the relayer cannot change what the voter signed.
     */
    function voteBySig(
        uint256 govId,
        address voter,
        uint8 support,
        bytes32 briefHash,
        string calldata statement,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) {
            revert SignatureExpired(deadline);
        }

        GovProposal storage p = govProposals[govId];
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_VOTE_TYPEHASH,
                govId,
                p.commitment,
                support,
                briefHash,
                keccak256(bytes(statement)),
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        (address signer, ECDSA.RecoverError err, bytes32 errArg) =
            ECDSA.tryRecoverCalldata(digest, signature);
        errArg; // silence unused-variable warning; the selector is enough

        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != voter) {
            revert BadSignature();
        }
        if (nonce != nonces[voter]) {
            revert NonceUsed(voter, nonce);
        }

        nonces[voter] = nonce + 1;
        _castVoteFor(voter, govId, support, briefHash);

        emit VoteRelayed(govId, voter, msg.sender, briefHash);
    }

    function _castVote(
        uint256 govId,
        uint8 support,
        bytes32 briefHash
    ) internal {
        _castVoteFor(msg.sender, govId, support, briefHash);
    }

    function _castVoteFor(
        address voter,
        uint256 govId,
        uint8 support,
        bytes32 briefHash
    ) internal {
        GovProposal storage p = govProposals[govId];
        if (p.state != GovProposalState.VotingOpen) {
            revert VotingNotOpen(govId);
        }
        if (block.timestamp < p.voteStart || block.timestamp > p.voteEnd) {
            revert VotingNotOpen(govId);
        }

        Vote storage v = votes[govId][voter];
        if (v.hasVoted) {
            revert AlreadyVoted(voter);
        }

        // The demo token has no historical checkpoints; weight is the
        // voter's balance when the vote is cast.
        uint256 weight = votingToken.balanceOf(voter);
        if (weight == 0) {
            revert InsufficientVotingPower(voter);
        }

        v.hasVoted = true;
        v.support = support;
        v.weight = weight;
        v.briefHash = briefHash;

        if (support == 0) {
            p.againstVotes += weight;
        } else if (support == 1) {
            p.forVotes += weight;
            if (briefHash != bytes32(0)) {
                p.informedForVotes += weight;
            }
        } else {
            p.abstainVotes += weight;
        }

        if (briefHash != bytes32(0)) {
            p.totalBriefAcks += 1;
        }

        emit VoteCast(govId, voter, support, weight, briefHash);
    }

    // ──────────────────────────────────────────
    // Step 4: Finalize voting (VotingOpen → Passed/Defeated)
    // ──────────────────────────────────────────

    /**
     * @notice Finalize the vote after the voting period ends.
     *         Transitions to Passed if quorum reached and forVotes > againstVotes,
     *         otherwise Defeated.
     */
    function finalizeVote(uint256 govId) external {
        GovProposal storage p = govProposals[govId];
        if (p.state != GovProposalState.VotingOpen) {
            revert InvalidState(GovProposalState.VotingOpen, p.state);
        }
        if (block.timestamp <= p.voteEnd) {
            revert VotingStillOpen(govId);
        }

        uint256 totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;

        if (totalVotes < quorum || p.forVotes <= p.againstVotes) {
            p.state = GovProposalState.Defeated;
            emit ProposalDefeated(govId);
        } else {
            p.state = GovProposalState.Passed;
            emit ProposalPassed(govId, p.commitment);
        }
    }

    // ──────────────────────────────────────────
    // Step 5: Queue into executor (Passed → Queued)
    // ──────────────────────────────────────────

    /**
     * @notice Queue a passed proposal into the executor's timelock.
     */
    function queueForExecution(uint256 govId) external {
        GovProposal storage p = govProposals[govId];
        if (p.state != GovProposalState.Passed) {
            revert InvalidState(GovProposalState.Passed, p.state);
        }

        // Queue in executor
        bytes32 commitment = executor.queue(
            p.proposalId,
            p.version,
            p.versionHash,
            p.actionsHash,
            p.intentHash,
            p.disclosureHash,
            timelockDelay
        );

        p.state = GovProposalState.Queued;

        emit ProposalQueuedInExecutor(govId, commitment);
    }

    // ──────────────────────────────────────────
    // Cancel (proposer or if disclosure gets challenged)
    // ──────────────────────────────────────────

    /**
     * @notice Cancel a proposal. Only the proposer can cancel,
     *         and only before execution.
     */
    function cancelProposal(uint256 govId) external {
        GovProposal storage p = govProposals[govId];
        if (msg.sender != p.proposer) {
            revert NotProposer(msg.sender, p.proposer);
        }
        require(
            p.state != GovProposalState.Executed &&
            p.state != GovProposalState.Cancelled,
            "Cannot cancel in current state"
        );

        GovProposalState prevState = p.state;
        p.state = GovProposalState.Cancelled;

        // If it was queued in executor, cancel there too
        if (prevState == GovProposalState.Queued) {
            executor.cancel(p.commitment);
        }

        emit ProposalCancelled(govId);
    }

    // ──────────────────────────────────────────
    // Sync state from executor
    // ──────────────────────────────────────────

    /**
     * @notice Sync the governor state with the executor state.
     *         Called after execution or halting to update the governor.
     */
    function syncFromExecutor(uint256 govId) external {
        GovProposal storage p = govProposals[govId];
        if (p.state != GovProposalState.Queued) {
            revert InvalidState(GovProposalState.Queued, p.state);
        }

        IntentLockExecutor.ProposalState execState = executor.getState(p.commitment);

        if (execState == IntentLockExecutor.ProposalState.Executed) {
            p.state = GovProposalState.Executed;
        } else if (execState == IntentLockExecutor.ProposalState.Halted) {
            p.state = GovProposalState.Halted;
        } else if (execState == IntentLockExecutor.ProposalState.Cancelled) {
            p.state = GovProposalState.Cancelled;
        }
    }

    // ──────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────

    function getGovProposal(uint256 govId) external view returns (GovProposal memory) {
        return govProposals[govId];
    }

    function getVote(uint256 govId, address voter) external view returns (Vote memory) {
        return votes[govId][voter];
    }

    /// @notice Informed-vote ratio: share of forVotes that acknowledged a brief.
    function informedVoteRatio(uint256 govId) external view returns (uint256 numerator, uint256 denominator) {
        GovProposal storage p = govProposals[govId];
        return (p.informedForVotes, p.forVotes);
    }

    /// @notice Check if quorum would be reached with current votes.
    function quorumReached(uint256 govId) external view returns (bool) {
        GovProposal storage p = govProposals[govId];
        uint256 totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
        return totalVotes >= quorum;
    }

    // ──────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────

    /**
     * @dev Mirror the executor's commitment computation.
     *      Must produce the same hash.
     */
    function _computeCommitment(
        uint256 proposalId,
        uint256 version,
        bytes32 versionHash,
        bytes32 actionsHash,
        bytes32 intentHash,
        bytes32 disclosureHash
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                executor.COMMIT_TYPEHASH(),
                block.chainid,
                address(executor),
                proposalId,
                version,
                versionHash,
                actionsHash,
                intentHash,
                disclosureHash
            )
        );
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }
}
