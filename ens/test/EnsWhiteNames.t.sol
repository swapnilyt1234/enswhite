// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {EnsWhiteNames,INameFactory,IEmployeeResolver} from "../src/EnsWhiteNames.sol";
import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {Grant} from "@ensdomains/contracts-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {VendorRegistrar} from "../src/VendorRegistrar.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
interface IBrandText {function resolve(bytes calldata,bytes calldata) external view returns(bytes memory);}
interface IAgentRegistry {
    function register() external returns(uint256);
    function ownerOf(uint256) external view returns(address);
    function getAgentWallet(uint256) external view returns(address);
    function setAgentURI(uint256,string calldata) external;
    function tokenURI(uint256) external view returns(string memory);
}

contract EnsWhiteNamesTest is Test,ERC1155Holder {
    function testForkHireScopedFinanceNontransferableAndFire() public {
        vm.skip(!vm.envOr("ENS_FORK_TEST",false));
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL",string("https://ethereum-sepolia-rpc.publicnode.com")),vm.envOr("ENS_FORK_BLOCK",uint256(12075000)));
        INameFactory factory=INameFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
        address impl=0x9BD8a88719068D09ecee662f36C0E3856708366a;
        Grant[] memory grants=new Grant[](1);grants[0]=Grant(address(this),0x1111111111111111111111111111111111111111111111111111111111111111);
        address root=factory.deployProxy(impl,123,abi.encodeWithSignature("initialize((address,uint256)[])",grants));
        EnsWhiteNames names=new EnsWhiteNames(address(factory),root,impl,0x115eb53F0c60696633855F90b138178Fb40b2b2C,hex"08656e7377686974650365746800");
        IPermissionedRegistry(root).grantRootRoles(1,address(names));
        address company=names.createCompany("acme",address(2));
        bytes[] memory brandingCalls=new bytes[](1);
        brandingCalls[0]=abi.encodeWithSignature("setText(bytes,string,string)",hex"00","name","Acme Candles");
        address branding=factory.deployProxy(0x115eb53F0c60696633855F90b138178Fb40b2b2C,789,abi.encodeWithSignature("initialize((address,uint256)[],bytes[])",grants,brandingCalls));
        IPermissionedRegistry(root).setResolver(uint256(keccak256("acme")),branding);
        assertEq(abi.decode(IBrandText(branding).resolve(hex"0461636d6508656e7377686974650365746800",abi.encodeWithSignature("text(bytes32,string)",bytes32(0),"name")),(string)),"Acme Candles");
        bytes32 hash=keccak256("acme");
        address resolver=names.hire(hash,"marketing",address(1),30 days,"3000000","500000","copydesk.vendors.enswhite.eth");
        bytes memory dns=hex"096d61726b6574696e670461636d6508656e7377686974650365746800";
        vm.prank(address(2));IEmployeeResolver(resolver).setText(dns,"enswhite.budget.weekly","4000000");
        vm.prank(address(2));vm.expectRevert();IEmployeeResolver(resolver).setText(dns,"enswhite.vendors","evil.eth");
        vm.prank(address(1));IEmployeeResolver(resolver).setText(dns,"enswhite.status","working");
        vm.prank(address(1));vm.expectRevert();IEmployeeResolver(resolver).setText(dns,"enswhite.budget.weekly","9999999");
        names.setAgentMetadata(hash,"marketing","agent-context","Marketing for Acme. Payments remain subject to employment and spending policies.");
        vm.prank(address(2));vm.expectRevert("Not founder");names.setAgentMetadata(hash,"marketing","agent-context","spoofed");
        vm.expectRevert("Discovery key only");names.setAgentMetadata(hash,"marketing","enswhite.vendors","evil.eth");
        EnsWhiteNames replacement=new EnsWhiteNames(address(factory),root,impl,0x115eb53F0c60696633855F90b138178Fb40b2b2C,hex"08656e7377686974650365746800");
        vm.prank(address(99));vm.expectRevert("Not parent token owner");replacement.adoptCompany("acme",address(2));
        address replacementRegistry=replacement.adoptCompany("acme",address(2));
        assertTrue(replacementRegistry!=company);
        // Preparing discovery does not replace the active directory.
        assertEq(address(IPermissionedRegistry(root).getSubregistry("acme")),company);
        IAgentRegistry agents=IAgentRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
        vm.prank(address(1));uint256 agentId=agents.register();
        assertEq(agents.ownerOf(agentId),address(1));assertEq(agents.getAgentWallet(agentId),address(1));
        vm.prank(address(1));agents.setAgentURI(agentId,"data:application/json;base64,e30=");
        assertEq(agents.tokenURI(agentId),"data:application/json;base64,e30=");
        address newResolver=replacement.hire(hash,"marketing",address(1),30 days,"4000000","500000","copydesk.vendors.enswhite.eth");
        string memory binding=string.concat("agent-registration[0x0001000003aa36a7148004a818bfb912233c491871b3d84c89a494bd9e][",vm.toString(agentId),"]");
        replacement.setAgentMetadata(hash,"marketing",binding,"1");
        IPermissionedRegistry(root).setSubregistry(uint256(hash),IPermissionedRegistry(replacementRegistry));
        assertEq(abi.decode(IBrandText(newResolver).resolve(dns,abi.encodeWithSignature("text(bytes32,string)",bytes32(0),binding)),(string)),"1");
        replacement.fire(hash,"marketing");
        address rehired=replacement.hire(hash,"marketing",address(1),30 days,"4000000","500000","copydesk.vendors.enswhite.eth");
        assertEq(abi.decode(IBrandText(rehired).resolve(dns,abi.encodeWithSignature("text(bytes32,string)",bytes32(0),binding)),(string)),"1");
        uint256 label=uint256(keccak256("marketing"));
        IPermissionedRegistry.State memory state=IPermissionedRegistry(company).getState(label);
        assertEq(state.latestOwner,address(1));
        vm.prank(address(1));vm.expectRevert();
        (bool ok,)=company.call(abi.encodeWithSignature("safeTransferFrom(address,address,uint256,uint256,bytes)",address(1),address(3),state.tokenId,1,bytes("")));
        require(ok);
        names.fire(hash,"marketing");
        assertEq(uint256(IPermissionedRegistry(company).getStatus(label)),0);
        names.hire(hash,"support",address(4),300,"1500000","200000","lingualink.vendors.enswhite.eth");
        vm.warp(block.timestamp+301);
        assertEq(uint256(IPermissionedRegistry(company).getStatus(uint256(keccak256("support")))),0);
    }
    function testForkVendorRegistryEmancipationConsentAndPermanentTransfer() public {
        vm.skip(!vm.envOr("ENS_FORK_TEST",false));
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL",string("https://ethereum-sepolia-rpc.publicnode.com")),vm.envOr("ENS_FORK_BLOCK",uint256(12075000)));
        INameFactory factory=INameFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
        address impl=0x9BD8a88719068D09ecee662f36C0E3856708366a;
        Grant[] memory grants=new Grant[](1);uint256 all=0x1111111111111111111111111111111111111111111111111111111111111111;
        grants[0]=Grant(address(this),all);
        IPermissionedRegistry registry=IPermissionedRegistry(factory.deployProxy(impl,456,abi.encodeWithSignature("initialize((address,uint256)[])",grants)));
        VendorRegistrar registrar=new VendorRegistrar(address(registry));
        registry.grantRootRoles(1,address(registrar));registry.revokeRootRoles(all,address(this));
        assertTrue(registry.isEmancipated());
        uint256 key=uint256(keccak256("EnsWhite vendor consent fork test"));address vendor=vm.addr(key);
        bytes32 digest=MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(address(registrar),block.chainid,"copydesk",vendor,address(factory))));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);
        bytes memory sig=abi.encodePacked(r,s,v);
        vm.expectRevert("Invalid vendor consent");registrar.registerFor("wrong",vendor,address(factory),sig);
        registrar.registerFor("copydesk",vendor,address(factory),sig);
        uint256 label=uint256(keccak256("copydesk"));
        IPermissionedRegistry.State memory state=registry.getState(label);
        assertEq(state.latestOwner,vendor);assertEq(state.expiry,type(uint64).max);
        vm.expectRevert();registry.unregister(label);
        vm.prank(vendor);(bool ok,)=address(registry).call(abi.encodeWithSignature("safeTransferFrom(address,address,uint256,uint256,bytes)",vendor,address(88),state.tokenId,1,bytes("")));assertTrue(ok);
        assertEq(registry.getState(label).latestOwner,address(88));
    }
}
