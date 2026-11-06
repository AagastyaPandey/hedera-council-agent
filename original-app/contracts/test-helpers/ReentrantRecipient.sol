// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../IntentLockExecutor.sol";
import "../libs/ActionDecoder.sol";

/**
 * @title ReentrantRecipient
 * @notice Malicious recipient used in Scenario 7 (Re-entrancy attack).
 *         Attempts to re-enter IntentLockExecutor.execute() during action dispatch.
 */
contract ReentrantRecipient {
    IntentLockExecutor public executor;
    bool public attacked;
    bytes public reentrancyRevertReason;

    // Parameters to attempt re-entrant execution
    uint256 public attackProposalId;
    uint256 public attackVersion;
    bytes32 public attackVersionHash;
    bytes32 public attackDisclosureHash;
    IntentLockExecutor.Action[] public attackActions;
    ActionDecoder.ActionRule[] public attackRules;

    event AttackAttempted(bool success, bytes reason);

    constructor(address _executor) {
        executor = IntentLockExecutor(payable(_executor));
    }

    function setAttackParams(
        uint256 proposalId,
        uint256 version,
        bytes32 versionHash,
        bytes32 disclosureHash,
        IntentLockExecutor.Action[] calldata actions,
        ActionDecoder.ActionRule[] calldata rules
    ) external {
        attackProposalId = proposalId;
        attackVersion = version;
        attackVersionHash = versionHash;
        attackDisclosureHash = disclosureHash;

        delete attackActions;
        for (uint256 i = 0; i < actions.length; i++) {
            attackActions.push(actions[i]);
        }

        delete attackRules;
        for (uint256 i = 0; i < rules.length; i++) {
            attackRules.push(rules[i]);
        }
    }

    /// @notice Target of the proposal action; calls back into executor
    function attackOnReceive() external payable {
        _reenter();
    }

    receive() external payable {
        _reenter();
    }

    fallback() external payable {
        _reenter();
    }

    bool public bubbleRevert = true;

    function setBubbleRevert(bool bubble) external {
        bubbleRevert = bubble;
    }

    function _reenter() internal {
        if (!attacked) {
            attacked = true;
            try executor.execute(
                attackProposalId,
                attackVersion,
                attackVersionHash,
                attackDisclosureHash,
                attackActions,
                attackRules
            ) {
                emit AttackAttempted(true, "");
            } catch (bytes memory reason) {
                reentrancyRevertReason = reason;
                emit AttackAttempted(false, reason);
                if (bubbleRevert) {
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
            }
        }
    }
}
