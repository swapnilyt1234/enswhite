// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestContract} from "../src/TestContract.sol";

contract TestContractTest {
    function testInitialValueIsZero() public {
        TestContract target = new TestContract();
        require(target.value() == 0, "Initial value must be zero");
    }

    function testFuzzSetValue(uint256 newValue) public {
        TestContract target = new TestContract();
        target.setValue(newValue);
        require(target.value() == newValue, "Stored value must match");
    }
}
