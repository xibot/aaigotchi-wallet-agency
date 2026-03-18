// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AAIAgentVault } from "./AAIAgentVault.sol";

contract AAIWalletAgency is Ownable {
    error NotTokenOwner();
    error NotAuthorized();
    error VaultAlreadyExists();
    error VaultMissing();
    error TargetNotAllowed();
    error ActionDisabled();
    error AmountTooHigh();
    error CooldownActive(uint256 readyAt);
    error ZeroAddress();
    error NativeValueMismatch();

    bytes32 public constant ACTION_SEND_NATIVE = keccak256("SEND_NATIVE");
    bytes32 public constant ACTION_SEND_ERC20 = keccak256("SEND_ERC20");
    bytes32 public constant ACTION_SWAP_CALL = keccak256("SWAP_CALL");

    struct Policy {
        bool sendEnabled;
        bool swapEnabled;
        uint96 nativeLimitWei;
        uint96 erc20Limit;
        uint32 cooldownSeconds;
        uint64 lastActionAt;
        address executor;
        address executorOwner;
    }

    IERC721 public immutable collection;

    mapping(uint256 => address) public vaultOf;
    mapping(uint256 => Policy) private policies;
    mapping(uint256 => mapping(address => bool)) public allowedTargetOf;

    event VaultCreated(uint256 indexed tokenId, address indexed vault, address indexed tokenOwner);
    event PolicyUpdated(
        uint256 indexed tokenId,
        bool sendEnabled,
        bool swapEnabled,
        uint256 nativeLimitWei,
        uint256 erc20Limit,
        uint256 cooldownSeconds,
        address executor
    );
    event TargetAllowanceUpdated(uint256 indexed tokenId, address indexed target, bool allowed);
    event ActionExecuted(
        uint256 indexed tokenId,
        address indexed vault,
        bytes32 indexed action,
        address caller,
        address asset,
        address target,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 callHash
    );

    constructor(address collection_, address initialOwner) Ownable(initialOwner) {
        if (collection_ == address(0) || initialOwner == address(0)) {
            revert ZeroAddress();
        }
        collection = IERC721(collection_);
    }

    function policyOf(uint256 tokenId) external view returns (Policy memory) {
        return policies[tokenId];
    }

    function createVault(uint256 tokenId) external returns (address vault) {
        _requireTokenOwner(tokenId, msg.sender);
        if (vaultOf[tokenId] != address(0)) {
            revert VaultAlreadyExists();
        }

        vault = address(new AAIAgentVault(address(this)));
        vaultOf[tokenId] = vault;

        emit VaultCreated(tokenId, vault, msg.sender);
    }

    function setPolicy(
        uint256 tokenId,
        bool sendEnabled,
        bool swapEnabled,
        uint96 nativeLimitWei,
        uint96 erc20Limit,
        uint32 cooldownSeconds,
        address executor
    ) external {
        _requireTokenOwner(tokenId, msg.sender);

        Policy storage policy = policies[tokenId];
        policy.sendEnabled = sendEnabled;
        policy.swapEnabled = swapEnabled;
        policy.nativeLimitWei = nativeLimitWei;
        policy.erc20Limit = erc20Limit;
        policy.cooldownSeconds = cooldownSeconds;
        policy.executor = executor;
        policy.executorOwner = executor == address(0) ? address(0) : msg.sender;

        emit PolicyUpdated(tokenId, sendEnabled, swapEnabled, nativeLimitWei, erc20Limit, cooldownSeconds, executor);
    }

    function allowTarget(uint256 tokenId, address target, bool allowed) external {
        _requireTokenOwner(tokenId, msg.sender);
        if (target == address(0)) {
            revert ZeroAddress();
        }

        allowedTargetOf[tokenId][target] = allowed;
        emit TargetAllowanceUpdated(tokenId, target, allowed);
    }

    function sendNative(
        uint256 tokenId,
        address payable target,
        uint256 amount,
        bytes32 receiptHash
    ) external returns (address vault) {
        Policy storage policy = policies[tokenId];
        _authorize(tokenId, policy);

        if (!policy.sendEnabled) {
            revert ActionDisabled();
        }
        if (!allowedTargetOf[tokenId][target]) {
            revert TargetNotAllowed();
        }
        if (amount > policy.nativeLimitWei) {
            revert AmountTooHigh();
        }

        _consumeCooldown(policy);
        vault = _requireVault(tokenId);
        AAIAgentVault(payable(vault)).transferNative(target, amount);

        emit ActionExecuted(tokenId, vault, ACTION_SEND_NATIVE, msg.sender, address(0), target, amount, receiptHash, bytes32(0));
    }

    function sendErc20(
        uint256 tokenId,
        address token,
        address target,
        uint256 amount,
        bytes32 receiptHash
    ) external returns (address vault) {
        Policy storage policy = policies[tokenId];
        _authorize(tokenId, policy);

        if (!policy.sendEnabled) {
            revert ActionDisabled();
        }
        if (!allowedTargetOf[tokenId][target]) {
            revert TargetNotAllowed();
        }
        if (amount > policy.erc20Limit) {
            revert AmountTooHigh();
        }

        _consumeCooldown(policy);
        vault = _requireVault(tokenId);
        AAIAgentVault(payable(vault)).transferToken(token, target, amount);

        emit ActionExecuted(tokenId, vault, ACTION_SEND_ERC20, msg.sender, token, target, amount, receiptHash, bytes32(0));
    }

    function swapWithCall(
        uint256 tokenId,
        address router,
        address tokenIn,
        uint256 amountIn,
        uint256 value,
        bytes calldata data,
        bytes32 receiptHash
    ) external returns (address vault, bytes memory result) {
        Policy storage policy = policies[tokenId];
        _authorize(tokenId, policy);

        if (!policy.swapEnabled) {
            revert ActionDisabled();
        }
        if (!allowedTargetOf[tokenId][router]) {
            revert TargetNotAllowed();
        }

        _consumeCooldown(policy);
        vault = _requireVault(tokenId);

        if (tokenIn == address(0)) {
            if (amountIn > policy.nativeLimitWei) {
                revert AmountTooHigh();
            }
            if (value != amountIn) {
                revert NativeValueMismatch();
            }
        } else {
            if (amountIn > policy.erc20Limit) {
                revert AmountTooHigh();
            }
            AAIAgentVault(payable(vault)).approveToken(tokenIn, router, amountIn);
        }

        result = AAIAgentVault(payable(vault)).execute(router, value, data);

        emit ActionExecuted(tokenId, vault, ACTION_SWAP_CALL, msg.sender, tokenIn, router, amountIn, receiptHash, keccak256(data));
    }

    function _authorize(uint256 tokenId, Policy storage policy) internal view {
        address currentOwner = collection.ownerOf(tokenId);
        if (msg.sender == currentOwner) {
            return;
        }
        if (msg.sender == policy.executor && policy.executorOwner == currentOwner) {
            return;
        }
        revert NotAuthorized();
    }

    function _consumeCooldown(Policy storage policy) internal {
        if (policy.cooldownSeconds > 0) {
            uint256 readyAt = uint256(policy.lastActionAt) + uint256(policy.cooldownSeconds);
            if (policy.lastActionAt != 0 && block.timestamp < readyAt) {
                revert CooldownActive(readyAt);
            }
        }
        policy.lastActionAt = uint64(block.timestamp);
    }

    function _requireTokenOwner(uint256 tokenId, address caller) internal view {
        if (collection.ownerOf(tokenId) != caller) {
            revert NotTokenOwner();
        }
    }

    function _requireVault(uint256 tokenId) internal view returns (address vault) {
        vault = vaultOf[tokenId];
        if (vault == address(0)) {
            revert VaultMissing();
        }
    }
}
