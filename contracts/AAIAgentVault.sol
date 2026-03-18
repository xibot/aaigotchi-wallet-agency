// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AAIAgentVault {
    using SafeERC20 for IERC20;

    error OnlyController();
    error CallFailed(bytes reason);
    error NativeTransferFailed();

    address public immutable controller;

    constructor(address controller_) {
        controller = controller_;
    }

    receive() external payable {}

    modifier onlyController() {
        if (msg.sender != controller) {
            revert OnlyController();
        }
        _;
    }

    function transferNative(address payable to, uint256 amount) external onlyController {
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) {
            revert NativeTransferFailed();
        }
    }

    function transferToken(address token, address to, uint256 amount) external onlyController {
        IERC20(token).safeTransfer(to, amount);
    }

    function approveToken(address token, address spender, uint256 amount) external onlyController {
        IERC20(token).forceApprove(spender, amount);
    }

    function execute(address target, uint256 value, bytes calldata data) external onlyController returns (bytes memory result) {
        (bool ok, bytes memory response) = target.call{ value: value }(data);
        if (!ok) {
            revert CallFailed(response);
        }
        return response;
    }
}
