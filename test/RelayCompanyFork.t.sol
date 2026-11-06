// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {RelayCompany} from "../src/RelayCompany.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface RealUSDTDomain { function DOMAIN_SEPARATOR() external view returns (bytes32); }

contract RelayCompanyForkTest is Test {
    function testForkRealUSDTReceivesBoundAuthorizationAndPaysVendor() public {
        vm.skip(!vm.envOr("WHITECHAIN_FORK_TEST", false));
        vm.createSelectFork("https://rpc.testnet.whitechain.io");
        address token = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
        uint256 attesterKey = 301;
        uint256 departmentKey = 302;
        RelayCompany company = new RelayCompany(token, vm.addr(attesterKey), 100);
        address department = vm.addr(departmentKey);
        address vendor = address(0xBEEF);
        company.setLimits(department, 500_000, 3_000_000);
        company.registerVendor(vendor, 100_000);
        uint256 vendorBefore = IERC20(token).balanceOf(vendor);
        vm.prank(0x4F961b8Abd8AF7cCdCcc4F76cd7326d8FbEa0594);
        require(IERC20(token).transfer(address(company), 5_000_000));
        bytes32 paymentId = keccak256("fork-razorpay");
        uint256 deadline = block.timestamp + 300;
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("RelayCompany"), keccak256("1"), block.chainid, address(company)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(company.TOP_UP_TYPEHASH(), paymentId, 5_000_000, deadline))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);
        company.topUp(paymentId, 5_000_000, deadline, abi.encodePacked(r, s, v));
        company.allocate(department, 3_000_000);
        bytes32 requestId = keccak256("copydesk-work");
        bytes32 salt = keccak256("random-order-salt");
        bytes32 typehash = keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
        digest = keccak256(abi.encodePacked("\x19\x01", RealUSDTDomain(token).DOMAIN_SEPARATOR(), keccak256(abi.encode(typehash, department, address(company), 100_000, 0, deadline, company.paymentNonce(vendor, requestId, salt)))));
        (v, r, s) = vm.sign(departmentKey, digest);
        vm.prank(address(0xCAFE)); company.pay(department, vendor, 100_000, requestId, salt, 0, deadline, v, r, s);
        assertEq(department.balance, 0);
        assertEq(IERC20(token).balanceOf(department), 2_900_000);
        assertEq(IERC20(token).balanceOf(vendor), vendorBefore + 99_000);
        assertEq(company.feePool(), 1_000);
        assertEq(company.companyBalance(), 2_000_000);
    }
}
