// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract VendorRegistrar {
    IPermissionedRegistry public immutable registry;
    constructor(address registry_) {registry=IPermissionedRegistry(registry_);}
    function register(string calldata label,address resolver) external returns(uint256) {
        return _register(label,msg.sender,resolver);
    }
    // A sponsor pays Sepolia gas; the vendor still consents to its permanent identity.
    function registerFor(string calldata label,address vendor,address resolver,bytes calldata signature) external returns(uint256) {
        bytes32 digest=MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(address(this),block.chainid,label,vendor,resolver)));
        require(vendor!=address(0)&&ECDSA.recover(digest,signature)==vendor,"Invalid vendor consent");
        return _register(label,vendor,resolver);
    }
    function _register(string calldata label,address vendor,address resolver) private returns(uint256) {
        (bool ok,bytes memory result)=address(registry).staticcall(abi.encodeWithSignature("isEmancipated()"));
        require(ok&&abi.decode(result,(bool)),"Vendor registry must be emancipated");
        require(resolver.code.length>0,"Missing vendor resolver");
        uint256 roles=(1<<20)|(1<<148)|(1<<24)|(1<<152)|(1<<156);
        return registry.register(label,vendor,IRegistry(address(0)),resolver,roles,type(uint64).max);
    }
}
