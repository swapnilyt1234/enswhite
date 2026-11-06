// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {RelayCompany} from "../src/RelayCompany.sol";

contract MockAuthorizationUSDT is ERC20, EIP712 {
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    constructor() ERC20("Tether USD", "USDT") EIP712("Tether USD", "1") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function DOMAIN_SEPARATOR() external view returns (bytes32) { return _domainSeparatorV4(); }
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        require(msg.sender == to, "Recipient must submit");
        require(block.timestamp > validAfter && block.timestamp < validBefore, "Outside window");
        require(!authorizationState[from][nonce], "Used nonce");
        bytes32 typehash = keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
        require(ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce))), v, r, s) == from, "Wrong signer");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}

contract RelayCompanyTest is Test {
    MockAuthorizationUSDT token;
    RelayCompany company;
    uint256 constant ATTESTER = 101;
    uint256 constant DEPT = 102;
    uint256 constant FINANCE = 103;
    address vendor = address(0xBEEF);
    address dept;
    bytes32 requestId = keccak256("order-1");
    bytes32 salt = keccak256("salt");
    function setUp() public {
        vm.warp(1_000_000);
        token = new MockAuthorizationUSDT();
        company = new RelayCompany(address(token), vm.addr(ATTESTER), 100);
        dept = vm.addr(DEPT);
        company.setFinance(vm.addr(FINANCE));
        company.setLimits(dept, 300_000, 500_000);
        company.registerVendor(vendor, 1_000_000);
        token.mint(address(company), 5_000_000);
        _topUp(keccak256("pay_1"), 5_000_000, "");
        company.allocate(dept, 1_000_000);
    }
    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("RelayCompany"), keccak256("1"), block.chainid, address(company))), structHash));
    }
    function _topUp(bytes32 paymentId, uint256 amount, string memory expectedError) internal {
        uint256 deadline = block.timestamp + 300;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER, _digest(keccak256(abi.encode(company.TOP_UP_TYPEHASH(), paymentId, amount, deadline))));
        if (bytes(expectedError).length > 0) vm.expectRevert(bytes(expectedError));
        company.topUp(paymentId, amount, deadline, abi.encodePacked(r, s, v));
    }
    function _signature(address targetVendor, bytes32 id, uint256 amount) internal view returns (bytes32) {
        bytes32 typehash = keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), keccak256(abi.encode(typehash, dept, address(company), amount, 0, block.timestamp + 300, company.paymentNonce(targetVendor, id, salt)))));
    }
    function _pay(address targetVendor, bytes32 id, uint256 amount, address signedVendor, string memory expectedError) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DEPT, _signature(signedVendor, id, amount));
        if (bytes(expectedError).length > 0) vm.expectRevert(bytes(expectedError));
        company.pay(dept, targetVendor, amount, id, salt, 0, block.timestamp + 300, v, r, s);
    }
    function testTopUpReplayReverts() public {
        _topUp(keccak256("pay_1"), 5_000_000, "Payment already credited");
    }
    function testUnbackedTopUpReverts() public {
        _topUp(keccak256("pay_2"), 1_000_000, "Pool not prefunded");
    }
    function testUnregisteredVendorReverts() public {
        _pay(address(0xBAD), requestId, 100_000, address(0xBAD), "Vendor not allowed or price exceeded");
    }
    function testPerCallLimitReverts() public {
        _pay(vendor, requestId, 300_001, vendor, "Per-call limit exceeded");
    }
    function testDailyLimitRevertsAndResets() public {
        _pay(vendor, requestId, 300_000, vendor, "");
        _pay(vendor, keccak256("order2"), 300_000, vendor, "Daily limit exceeded");
        vm.warp(block.timestamp + 1 days);
        _pay(vendor, keccak256("order2"), 300_000, vendor, "");
    }
    function testRedirectedVendorFailsSignature() public {
        company.registerVendor(address(0xBAD), 1_000_000);
        _pay(address(0xBAD), requestId, 100_000, vendor, "Wrong signer");
    }
    function testFeeMathAndWithdrawCannotTakeCompanyCredit() public {
        _pay(vendor, requestId, 100_000, vendor, "");
        assertEq(token.balanceOf(vendor), 99_000);
        assertEq(company.feePool(), 1_000);
        assertEq(company.companyBalance(), 4_000_000);
        company.withdrawFees(address(0xCAFE));
        assertEq(token.balanceOf(address(0xCAFE)), 1_000);
        assertEq(token.balanceOf(address(company)), 4_000_000);
    }
    function testReplayRequestReverts() public {
        _pay(vendor, requestId, 100_000, vendor, "");
        _pay(vendor, requestId, 100_000, vendor, "Request already paid");
    }
    function testOnlyRecipientCanExecuteAuthorization() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DEPT, _signature(vendor, requestId, 100_000));
        bytes32 nonce = company.paymentNonce(vendor, requestId, salt);
        vm.expectRevert("Recipient must submit");
        token.receiveWithAuthorization(dept, address(company), 100_000, 0, block.timestamp + 300, nonce, v, r, s);
    }
    function testFinanceAllocatesWithoutHoldingWBTAndCannotReplay() public {
        uint256 deadline = block.timestamp + 300;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FINANCE, _digest(keccak256(abi.encode(company.ALLOCATE_TYPEHASH(), dept, 100_000, 0, deadline))));
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.prank(address(0xCAFE)); company.allocateBySig(dept, 100_000, 0, deadline, sig);
        assertEq(token.balanceOf(dept), 1_100_000);
        assertEq(vm.addr(FINANCE).balance, 0);
        vm.expectRevert("Invalid allocation nonce/deadline"); company.allocateBySig(dept, 100_000, 0, deadline, sig);
    }
    function testUnauthorizedAllocationReverts() public {
        vm.prank(address(0xBAD)); vm.expectRevert("Not finance or owner"); company.allocate(dept, 1);
    }
}
