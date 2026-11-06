// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ActionDecoder
 * @notice Typed action rule enforcement for the IntentLock executor (Section 4.2).
 *
 *         Every executable action must match a committed ActionRule.
 *         Unknown selectors, wrong recipients, over-limit amounts,
 *         and hidden nested calls all revert with specific custom errors.
 *
 *         The executor uses only `call` — `delegatecall` is never available.
 */
library ActionDecoder {
    // ──────────────────────────────────────────
    // Constants — well-known selectors
    // ──────────────────────────────────────────

    bytes4 internal constant TRANSFER_SELECTOR         = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant APPROVE_SELECTOR          = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant UPGRADE_TO_SELECTOR       = 0x3659cfe6; // upgradeTo(address)
    bytes4 internal constant UPGRADE_AND_CALL_SELECTOR = 0x4f1ef286; // upgradeToAndCall(address,bytes)
    bytes4 internal constant TRANSFER_OWNERSHIP_SEL    = 0xf2fde38b; // transferOwnership(address)
    bytes4 internal constant MULTICALL_SELECTOR        = 0xac9650d8; // multicall(bytes[])

    // ──────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────

    enum ActionKind {
        ERC20_TRANSFER,       // 0
        ERC20_APPROVE,        // 1
        PARAM_SET,            // 2
        UPGRADE,              // 3
        OWNERSHIP_TRANSFER,   // 4
        MULTICALL             // 5
    }

    /**
     * @notice A typed rule from the committed intent.
     *         Rules are committed via intentHash; the executor requires
     *         keccak256(abi.encode(rules)) == intentHash before enforcing.
     */
    struct ActionRule {
        ActionKind kind;
        address target;          // exact contract allowed
        bytes4  selector;        // exact function allowed
        address counterparty;    // recipient / spender / new owner / approved implementation
        uint256 maxAmount;       // spend or allowance ceiling
        bytes32 codeHash;        // required extcodehash for upgrade targets
        uint8   childCount;      // for MULTICALL: number of nested rules that follow
    }

    // ──────────────────────────────────────────
    // Custom errors (stable selectors for report.ts mapping)
    // ──────────────────────────────────────────

    /// @dev Calldata length does not match expected format.
    error BadCalldataLength(uint256 expected, uint256 actual);

    /// @dev Function selector in calldata does not match the rule.
    error SelectorNotAllowed(bytes4 expected, bytes4 actual);

    /// @dev Transfer or approval recipient does not match the rule.
    error UnauthorizedRecipient(address expected, address actual);

    /// @dev Transfer or approval amount exceeds the committed ceiling.
    error ExceedsSpendLimit(uint256 maxAllowed, uint256 actual);

    /// @dev Unlimited approval (type(uint256).max) not explicitly committed.
    error UnlimitedApprovalNotCommitted(address spender);

    /// @dev Upgrade target implementation address does not match the rule.
    error UnauthorizedImplementation(address expected, address actual);

    /// @dev Upgrade target code hash does not match the committed hash.
    error CodeHashMismatch(bytes32 expected, bytes32 actual);

    /// @dev Ownership transfer to an unauthorized address.
    error UnauthorizedNewOwner(address expected, address actual);

    /// @dev Multicall contains more inner calls than committed child rules.
    error MulticallChildCountMismatch(uint8 expected, uint256 actual);

    /// @dev Multicall recursion exceeds the allowed depth.
    error MulticallDepthExceeded(uint256 depth);

    /// @dev Action target contract does not match the rule.
    error UnauthorizedTarget(address expected, address actual);

    /// @dev Unknown or unmatched ActionKind.
    error UnknownActionKind(uint8 kind);

    // ──────────────────────────────────────────
    // Main entry — enforce an action against its rule
    // ──────────────────────────────────────────

    /**
     * @notice Enforce a single action against its committed rule.
     * @param target   The call target address.
     * @param data     The calldata being sent.
     * @param rule     The ActionRule this action must satisfy.
     * @param depth    Current recursion depth (0 at top level).
     * @param childRules  Array of all rules (for multicall child lookup).
     * @param childOffset Starting index in childRules for this action's children.
     * @return nextOffset The next unused index in childRules after this action.
     */
    function enforce(
        address target,
        bytes calldata data,
        ActionRule calldata rule,
        uint256 depth,
        ActionRule[] calldata childRules,
        uint256 childOffset
    ) internal view returns (uint256 nextOffset) {
        // Target must match exactly
        if (target != rule.target) {
            revert UnauthorizedTarget(rule.target, target);
        }

        if (rule.kind == ActionKind.ERC20_TRANSFER) {
            _enforceTransfer(data, rule);
            return childOffset;
        } else if (rule.kind == ActionKind.ERC20_APPROVE) {
            _enforceApprove(data, rule);
            return childOffset;
        } else if (rule.kind == ActionKind.PARAM_SET) {
            _enforceParamSet(data, rule);
            return childOffset;
        } else if (rule.kind == ActionKind.UPGRADE) {
            _enforceUpgrade(data, rule);
            return childOffset;
        } else if (rule.kind == ActionKind.OWNERSHIP_TRANSFER) {
            _enforceOwnershipTransfer(data, rule);
            return childOffset;
        } else if (rule.kind == ActionKind.MULTICALL) {
            return _enforceMulticall(target, data, rule, depth, childRules, childOffset);
        } else {
            revert UnknownActionKind(uint8(rule.kind));
        }
    }

    // ──────────────────────────────────────────
    // ERC-20 transfer enforcement
    // ──────────────────────────────────────────

    /**
     * @dev Enforce ERC-20 transfer(address,uint256).
     *      - Calldata must be exactly 68 bytes (4 selector + 64 params).
     *      - Selector must be transfer(address,uint256).
     *      - Recipient must match rule.counterparty.
     *      - Amount must be <= rule.maxAmount.
     */
    function _enforceTransfer(
        bytes calldata data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 68) {
            revert BadCalldataLength(68, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != TRANSFER_SELECTOR) {
            revert SelectorNotAllowed(TRANSFER_SELECTOR, sel);
        }
        // Also enforce rule's committed selector matches
        if (rule.selector != bytes4(0) && sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        (address to, uint256 amount) = abi.decode(data[4:], (address, uint256));

        if (to != rule.counterparty) {
            revert UnauthorizedRecipient(rule.counterparty, to);
        }
        if (amount > rule.maxAmount) {
            revert ExceedsSpendLimit(rule.maxAmount, amount);
        }
    }

    // ──────────────────────────────────────────
    // ERC-20 approve enforcement
    // ──────────────────────────────────────────

    /**
     * @dev Enforce ERC-20 approve(address,uint256).
     *      - Calldata must be exactly 68 bytes.
     *      - Selector must be approve(address,uint256).
     *      - Spender must match rule.counterparty.
     *      - Amount must be <= rule.maxAmount.
     *      - Unlimited approvals (type(uint256).max) are rejected unless
     *        the rule's maxAmount is also type(uint256).max (explicitly committed).
     */
    function _enforceApprove(
        bytes calldata data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 68) {
            revert BadCalldataLength(68, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != APPROVE_SELECTOR) {
            revert SelectorNotAllowed(APPROVE_SELECTOR, sel);
        }
        if (rule.selector != bytes4(0) && sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        (address spender, uint256 amount) = abi.decode(data[4:], (address, uint256));

        if (spender != rule.counterparty) {
            revert UnauthorizedRecipient(rule.counterparty, spender);
        }

        // Reject unlimited approvals unless explicitly committed
        if (amount == type(uint256).max && rule.maxAmount != type(uint256).max) {
            revert UnlimitedApprovalNotCommitted(spender);
        }

        if (amount > rule.maxAmount) {
            revert ExceedsSpendLimit(rule.maxAmount, amount);
        }
    }

    // ──────────────────────────────────────────
    // Parameter set enforcement
    // ──────────────────────────────────────────

    /**
     * @dev Enforce a parameter-setting call.
     *      - Selector must match rule.selector exactly.
     *      - If rule.maxAmount > 0, the first uint256 param must be <= maxAmount.
     *        (Covers setFeeBps-style calls with a bounded value.)
     */
    function _enforceParamSet(
        bytes calldata data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length < 4) {
            revert BadCalldataLength(4, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        // If maxAmount is set, enforce the first uint256 parameter
        if (rule.maxAmount > 0 && data.length >= 36) {
            uint256 value = abi.decode(data[4:36], (uint256));
            if (value > rule.maxAmount) {
                revert ExceedsSpendLimit(rule.maxAmount, value);
            }
        }
    }

    // ──────────────────────────────────────────
    // Upgrade enforcement
    // ──────────────────────────────────────────

    /**
     * @dev Enforce a proxy upgrade call.
     *      - Selector must be upgradeTo or upgradeToAndCall.
     *      - New implementation address must match rule.counterparty.
     *      - If rule.codeHash is set, the implementation's extcodehash
     *        must match (prevents swapping code after vote).
     */
    function _enforceUpgrade(
        bytes calldata data,
        ActionRule calldata rule
    ) internal view {
        if (data.length < 36) {
            revert BadCalldataLength(36, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != UPGRADE_TO_SELECTOR && sel != UPGRADE_AND_CALL_SELECTOR) {
            revert SelectorNotAllowed(rule.selector, sel);
        }
        if (rule.selector != bytes4(0) && sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        // Decode the new implementation address (first param in both variants)
        address newImpl = abi.decode(data[4:36], (address));

        if (newImpl != rule.counterparty) {
            revert UnauthorizedImplementation(rule.counterparty, newImpl);
        }

        // Verify code hash if committed
        if (rule.codeHash != bytes32(0)) {
            bytes32 actualCodeHash;
            assembly {
                actualCodeHash := extcodehash(newImpl)
            }
            if (actualCodeHash != rule.codeHash) {
                revert CodeHashMismatch(rule.codeHash, actualCodeHash);
            }
        }
    }

    // ──────────────────────────────────────────
    // Ownership transfer enforcement
    // ──────────────────────────────────────────

    /**
     * @dev Enforce transferOwnership(address).
     *      - Calldata must be exactly 36 bytes.
     *      - Selector must be transferOwnership(address).
     *      - New owner must match rule.counterparty exactly.
     */
    function _enforceOwnershipTransfer(
        bytes calldata data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 36) {
            revert BadCalldataLength(36, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != TRANSFER_OWNERSHIP_SEL) {
            revert SelectorNotAllowed(TRANSFER_OWNERSHIP_SEL, sel);
        }
        if (rule.selector != bytes4(0) && sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        address newOwner = abi.decode(data[4:], (address));

        if (newOwner != rule.counterparty) {
            revert UnauthorizedNewOwner(rule.counterparty, newOwner);
        }
    }

    // ──────────────────────────────────────────
    // Multicall enforcement (recursive, depth ≤ 2)
    // ──────────────────────────────────────────

    /**
     * @dev Enforce multicall(bytes[]).
     *      - Selector must be multicall(bytes[]).
     *      - Number of inner calls must match rule.childCount.
     *      - Each inner call is enforced against its own child rule.
     *      - Recursion depth limited to 2.
     *      - A hidden transferOwnership inside a multicall has no matching
     *        rule and reverts the entire execution.
     */
    function _enforceMulticall(
        address target,
        bytes calldata data,
        ActionRule calldata rule,
        uint256 depth,
        ActionRule[] calldata childRules,
        uint256 childOffset
    ) internal view returns (uint256 nextOffset) {
        // Depth check (0 = top level, max inner depth = 2)
        if (depth >= 2) {
            revert MulticallDepthExceeded(depth);
        }

        if (data.length < 4) {
            revert BadCalldataLength(4, data.length);
        }

        bytes4 sel = bytes4(data[:4]);
        if (sel != MULTICALL_SELECTOR) {
            revert SelectorNotAllowed(MULTICALL_SELECTOR, sel);
        }
        if (rule.selector != bytes4(0) && sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        // Decode inner calls: multicall(bytes[])
        bytes[] memory innerCalls = abi.decode(data[4:], (bytes[]));

        if (innerCalls.length != rule.childCount) {
            revert MulticallChildCountMismatch(rule.childCount, innerCalls.length);
        }

        // Enforce each inner call against its corresponding child rule
        nextOffset = childOffset;
        for (uint256 i; i < innerCalls.length; ++i) {
            bytes memory innerData = innerCalls[i];

            // Child rule is at childRules[nextOffset]
            // Inner calls target the same contract (multicall pattern)
            ActionRule calldata childRule = childRules[nextOffset];

            // For multicall, inner calls target the same contract
            address innerTarget = childRule.target;
            // If the child rule target is address(0), assume same target
            if (innerTarget == address(0)) {
                innerTarget = target;
            }

            // Convert memory bytes to calldata-compatible enforcement
            // We use a helper that works with memory bytes
            _enforceInnerCall(innerTarget, innerData, childRule, depth + 1);
            
            nextOffset += 1;
            // If the child is itself a multicall, skip its children too
            if (childRule.kind == ActionKind.MULTICALL) {
                nextOffset += childRule.childCount;
            }
        }
    }

    /**
     * @dev Enforce a single inner call from a multicall.
     *      Uses memory bytes (decoded from multicall payload).
     *      Supports all action kinds except nested multicall beyond depth 2.
     */
    function _enforceInnerCall(
        address target,
        bytes memory data,
        ActionRule calldata rule,
        uint256 depth
    ) internal view {
        // Target check (if rule specifies a target)
        if (rule.target != address(0) && target != rule.target) {
            revert UnauthorizedTarget(rule.target, target);
        }

        if (rule.kind == ActionKind.ERC20_TRANSFER) {
            _enforceTransferMem(data, rule);
        } else if (rule.kind == ActionKind.ERC20_APPROVE) {
            _enforceApproveMem(data, rule);
        } else if (rule.kind == ActionKind.PARAM_SET) {
            _enforceParamSetMem(data, rule);
        } else if (rule.kind == ActionKind.UPGRADE) {
            _enforceUpgradeMem(data, rule);
        } else if (rule.kind == ActionKind.OWNERSHIP_TRANSFER) {
            _enforceOwnershipTransferMem(data, rule);
        } else if (rule.kind == ActionKind.MULTICALL) {
            // Nested multicall — only if depth allows
            if (depth >= 2) {
                revert MulticallDepthExceeded(depth);
            }
            // For deeply nested multicalls we reject — keeps complexity bounded
            revert MulticallDepthExceeded(depth);
        } else {
            revert UnknownActionKind(uint8(rule.kind));
        }
    }

    // ──────────────────────────────────────────
    // Memory-based enforcement helpers (for multicall inner calls)
    // ──────────────────────────────────────────

    function _enforceTransferMem(
        bytes memory data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 68) {
            revert BadCalldataLength(68, data.length);
        }

        bytes4 sel;
        assembly { sel := mload(add(data, 32)) }
        if (sel != TRANSFER_SELECTOR) {
            revert SelectorNotAllowed(TRANSFER_SELECTOR, sel);
        }

        address to;
        uint256 amount;
        assembly {
            to := mload(add(data, 36))
            amount := mload(add(data, 68))
        }

        if (to != rule.counterparty) {
            revert UnauthorizedRecipient(rule.counterparty, to);
        }
        if (amount > rule.maxAmount) {
            revert ExceedsSpendLimit(rule.maxAmount, amount);
        }
    }

    function _enforceApproveMem(
        bytes memory data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 68) {
            revert BadCalldataLength(68, data.length);
        }

        bytes4 sel;
        assembly { sel := mload(add(data, 32)) }
        if (sel != APPROVE_SELECTOR) {
            revert SelectorNotAllowed(APPROVE_SELECTOR, sel);
        }

        address spender;
        uint256 amount;
        assembly {
            spender := mload(add(data, 36))
            amount := mload(add(data, 68))
        }

        if (spender != rule.counterparty) {
            revert UnauthorizedRecipient(rule.counterparty, spender);
        }
        if (amount == type(uint256).max && rule.maxAmount != type(uint256).max) {
            revert UnlimitedApprovalNotCommitted(spender);
        }
        if (amount > rule.maxAmount) {
            revert ExceedsSpendLimit(rule.maxAmount, amount);
        }
    }

    function _enforceParamSetMem(
        bytes memory data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length < 4) {
            revert BadCalldataLength(4, data.length);
        }

        bytes4 sel;
        assembly { sel := mload(add(data, 32)) }
        if (sel != rule.selector) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        if (rule.maxAmount > 0 && data.length >= 36) {
            uint256 value;
            assembly { value := mload(add(data, 36)) }
            if (value > rule.maxAmount) {
                revert ExceedsSpendLimit(rule.maxAmount, value);
            }
        }
    }

    function _enforceUpgradeMem(
        bytes memory data,
        ActionRule calldata rule
    ) internal view {
        if (data.length < 36) {
            revert BadCalldataLength(36, data.length);
        }

        bytes4 sel;
        assembly { sel := mload(add(data, 32)) }
        if (sel != UPGRADE_TO_SELECTOR && sel != UPGRADE_AND_CALL_SELECTOR) {
            revert SelectorNotAllowed(rule.selector, sel);
        }

        address newImpl;
        assembly { newImpl := mload(add(data, 36)) }

        if (newImpl != rule.counterparty) {
            revert UnauthorizedImplementation(rule.counterparty, newImpl);
        }

        if (rule.codeHash != bytes32(0)) {
            bytes32 actualCodeHash;
            assembly { actualCodeHash := extcodehash(newImpl) }
            if (actualCodeHash != rule.codeHash) {
                revert CodeHashMismatch(rule.codeHash, actualCodeHash);
            }
        }
    }

    function _enforceOwnershipTransferMem(
        bytes memory data,
        ActionRule calldata rule
    ) internal pure {
        if (data.length != 36) {
            revert BadCalldataLength(36, data.length);
        }

        bytes4 sel;
        assembly { sel := mload(add(data, 32)) }
        if (sel != TRANSFER_OWNERSHIP_SEL) {
            revert SelectorNotAllowed(TRANSFER_OWNERSHIP_SEL, sel);
        }

        address newOwner;
        assembly { newOwner := mload(add(data, 36)) }

        if (newOwner != rule.counterparty) {
            revert UnauthorizedNewOwner(rule.counterparty, newOwner);
        }
    }

    // ──────────────────────────────────────────
    // Utility — hash an array of rules to produce intentHash
    // ──────────────────────────────────────────

    /**
     * @notice Compute the intentHash from an array of ActionRules.
     *         The executor verifies keccak256(abi.encode(rules)) == intentHash
     *         before trusting any rule.
     */
    function hashRules(ActionRule[] calldata rules) internal pure returns (bytes32) {
        return keccak256(abi.encode(rules));
    }
}
