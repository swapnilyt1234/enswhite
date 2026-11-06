// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {MockAuthorizationUSDT} from "./RelayCompany.t.sol";
import {EnsWhiteCompany} from "../src/EnsWhiteCompany.sol";

contract EnsWhiteCompanyTest is Test {
    EnsWhiteCompany company;
    MockAuthorizationUSDT token;
    uint256 constant ATTESTER=501;
    uint256 constant DEPARTMENT=502;
    address vendor=address(0xBEEF);
    bytes32 salt=keccak256("salt");
    function setUp() public {
        vm.warp(1_000_000);vm.chainId(1874);
        token=new MockAuthorizationUSDT();company=new EnsWhiteCompany(address(token),vm.addr(ATTESTER),100);
        company.setLimits(vm.addr(DEPARTMENT),500000,3000000);company.registerVendor(vendor,500000);
        token.mint(vm.addr(DEPARTMENT),1000000);
    }
    function policy(uint256 weekly,uint256 perCall,uint256 expiry) private view returns(EnsWhiteCompany.IdentityPolicy memory) {
        return EnsWhiteCompany.IdentityPolicy(keccak256("marketing.acme.enswhite.eth"),keccak256("copydesk.vendors.enswhite.eth"),weekly,perCall,expiry,block.timestamp+60);
    }
    function pay(bytes32 requestId,uint256 amount,EnsWhiteCompany.IdentityPolicy memory identity,bool tamper,string memory expected) private {
        bytes32 domain=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("EnsWhiteCompany"),keccak256("1"),block.chainid,address(company)));
        bytes32 digest=keccak256(abi.encodePacked("\x19\x01",domain,keccak256(abi.encode(company.IDENTITY_TYPEHASH(),requestId,vm.addr(DEPARTMENT),vendor,identity.deptNode,identity.vendorNode,identity.weeklyMax,identity.perCallMax,identity.nameExpiry,identity.validUntil))));
        (uint8 pv,bytes32 pr,bytes32 ps)=vm.sign(ATTESTER,digest);
        bytes memory signature=abi.encodePacked(pr,ps,pv);
        if(tamper)identity.vendorNode=keccak256("evil.eth");
        digest=keccak256(abi.encodePacked("\x19\x01",token.DOMAIN_SEPARATOR(),keccak256(abi.encode(keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),vm.addr(DEPARTMENT),address(company),amount,0,block.timestamp+300,company.paymentNonce(vendor,requestId,salt)))));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(DEPARTMENT,digest);
        address dept=vm.addr(DEPARTMENT);
        if(bytes(expected).length>0)vm.expectRevert(bytes(expected));
        company.pay(dept,vendor,amount,requestId,salt,0,block.timestamp+300,v,r,s,identity,signature);
    }
    function testENSAttestedPaymentAndFee() public {pay(keccak256("one"),100000,policy(300000,200000,block.timestamp+3600),false,"");assertEq(token.balanceOf(vendor),99000);assertEq(company.feePool(),1000);}
    function testExpiredNameCannotPay() public {pay(keccak256("one"),100000,policy(300000,200000,block.timestamp),false,"ENS policy expired");}
    function testAlteredVendorNameCannotPay() public {pay(keccak256("one"),100000,policy(300000,200000,block.timestamp+3600),true,"Invalid ENS policy signature");}
    function testENSPerCallLimitCannotBeBypassed() public {pay(keccak256("one"),100000,policy(300000,50000,block.timestamp+3600),false,"ENS per-call limit");}
    function testENSWeeklyLimitCannotBeBypassed() public {pay(keccak256("one"),100000,policy(150000,200000,block.timestamp+3600),false,"");pay(keccak256("two"),100000,policy(150000,200000,block.timestamp+3600),false,"ENS weekly limit");}
}
