// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FeeModule
 * @notice Parameter-tuning contract used in AegisDAO benign & multicall scenarios.
 */
contract FeeModule {
    uint256 public feeBps;
    address public owner;

    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error OnlyOwner();
    error FeeTooHigh(uint256 fee);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(uint256 initialFeeBps, address initialOwner) {
        feeBps = initialFeeBps;
        owner = initialOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        if (newFee > 1000) revert FeeTooHigh(newFee); // max 10%
        uint256 oldFee = feeBps;
        feeBps = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @notice Batched self-calls used by the Red-Team multicall scenarios.
    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i; i < data.length; ++i) {
            (bool ok, bytes memory result) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
            results[i] = result;
        }
    }
}
