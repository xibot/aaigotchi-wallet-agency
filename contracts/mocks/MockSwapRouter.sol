// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSwapRouter {
    using SafeERC20 for IERC20;

    event TokenPulled(address indexed token, address indexed from, address indexed recipient, uint256 amount);
    event NativePulled(address indexed from, address indexed recipient, uint256 amount);

    function pullToken(address token, uint256 amount, address recipient) external {
        IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
        emit TokenPulled(token, msg.sender, recipient, amount);
    }

    function pullNative(address payable recipient) external payable {
        (bool ok, ) = recipient.call{ value: msg.value }("");
        require(ok, "native transfer failed");
        emit NativePulled(msg.sender, recipient, msg.value);
    }
}
