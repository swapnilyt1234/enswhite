// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract TestContract {
    uint256 public value;

    function setValue(uint256 newValue) external {
        value = newValue;
    }
}
