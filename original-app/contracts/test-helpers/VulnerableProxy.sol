// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VulnerableProxy
 * @notice Proxy with explicit documented storage layout for simulation diff testing.
 *         Slot 0: admin
 *         Slot 1: implementation
 *         Slot 2: feeBps
 *         Slot 3: paused
 */
contract VulnerableProxy {
    // Documented storage layout
    address public admin;          // Slot 0
    address public implementation; // Slot 1
    uint256 public feeBps;         // Slot 2
    bool    public paused;         // Slot 3

    event Upgraded(address indexed newImplementation);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event FeeChanged(uint256 previousFee, uint256 newFee);

    error Unauthorized();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _admin, address _implementation) {
        admin = _admin;
        implementation = _implementation;
        feeBps = 30; // 0.3%
        paused = false;
    }

    function upgradeTo(address newImplementation) external onlyAdmin {
        implementation = newImplementation;
        emit Upgraded(newImplementation);
    }

    function owner() external view returns (address) {
        return admin;
    }

    function changeAdmin(address newAdmin) external onlyAdmin {
        address prev = admin;
        admin = newAdmin;
        emit AdminChanged(prev, newAdmin);
    }

    function setFee(uint256 newFee) external onlyAdmin {
        uint256 prev = feeBps;
        feeBps = newFee;
        emit FeeChanged(prev, newFee);
    }

    fallback() external payable {
        address impl = implementation;
        if (impl == address(0)) return;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
