// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RevertingView
 * @notice Test helper whose `owner()` reverts with data. Used to prove the
 *         Pre-vote Effect Preview reports a failed read in `unobserved`
 *         instead of treating it as zero.
 */
contract RevertingView {
    error ViewReverted(address caller);

    event Noop();

    function noop() external {
        emit Noop();
    }

    function owner() external view returns (address) {
        revert ViewReverted(msg.sender);
    }
}