// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TreasuryProxy
 * @notice EIP-1967 upgradeable proxy holding DAO treasury funds.
 *         Only owner (the IntentLockExecutor) can upgrade or transfer funds.
 */
contract TreasuryProxy {
    // EIP-1967 slots
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    event Upgraded(address indexed implementation);
    event AdminChanged(address previousAdmin, address newAdmin);

    error Unauthorized();
    error UpgradeFailed();

    modifier onlyAdmin() {
        if (msg.sender != _getAdmin()) revert Unauthorized();
        _;
    }

    constructor(address initialAdmin, address initialImplementation) {
        _setAdmin(initialAdmin);
        _setImplementation(initialImplementation);
    }

    function implementation() external view returns (address) {
        return _getImplementation();
    }

    function admin() external view returns (address) {
        return _getAdmin();
    }

    function owner() external view returns (address) {
        return _getAdmin();
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        address prev = _getAdmin();
        _setAdmin(newOwner);
        emit AdminChanged(prev, newOwner);
    }

    function upgradeTo(address newImplementation) external onlyAdmin {
        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyAdmin {
        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
        if (data.length > 0) {
            (bool success, ) = newImplementation.delegatecall(data);
            if (!success) revert UpgradeFailed();
        }
    }

    /// @notice Batched self-calls used by the obfuscated-payload scenario.
    /// @dev    delegatecall preserves msg.sender, so the inner onlyAdmin checks
    ///         still bind to the calling executor rather than to this proxy.
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

    function withdrawERC20(address token, address to, uint256 amount) external onlyAdmin {
        IERC20(token).transfer(to, amount);
    }

    function _getAdmin() internal view returns (address adm) {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            adm := sload(slot)
        }
    }

    function _setAdmin(address newAdmin) internal {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            sstore(slot, newAdmin)
        }
    }

    function _getImplementation() internal view returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    function _setImplementation(address newImpl) internal {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImpl)
        }
    }

    fallback() external payable {
        address impl = _getImplementation();
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
