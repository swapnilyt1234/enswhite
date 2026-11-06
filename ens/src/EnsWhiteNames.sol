// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {Grant} from "@ensdomains/contracts-v2/access-control/interfaces/IEACGrantInitializable.sol";

interface INameFactory {
    function deployProxy(address implementation,uint256 salt,bytes calldata data) external returns(address);
    function verifyContract(address proxy) external view returns(address);
}
interface IEmployeeResolver {
    function setAddress(bytes calldata name,uint256 coinType,bytes calldata value) external;
    function setText(bytes calldata name,string calldata key,string calldata value) external;
    function grantSetterRoles(bytes calldata setter,address account) external returns(bool);
}

contract EnsWhiteNames {
    uint256 constant ALL = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 constant EMPLOYEE = (1 << 20) | (1 << 148);
    uint256 constant COIN = 2147485522;
    INameFactory public immutable factory;
    IPermissionedRegistry public immutable platform;
    address public immutable registryImplementation;
    address public immutable resolverImplementation;
    bytes public parentDNS;
    struct Company { address owner; address finance; IPermissionedRegistry registry; bytes dns; }
    mapping(bytes32 => Company) public companies;
    mapping(bytes32 => string[]) private discoveryKeys;
    mapping(bytes32 => mapping(bytes32 => string)) private discoveryValues;
    mapping(bytes32 => uint256) private hireNonces;
    event CompanyCreated(bytes32 indexed labelHash,string label,address registry,address owner);
    event EmployeeHired(bytes32 indexed companyHash,string label,address wallet,address resolver,uint64 expiry);

    constructor(address factory_,address platform_,address registryImpl,address resolverImpl,bytes memory parent_) {
        require(factory_.code.length>0 && platform_.code.length>0 && registryImpl.code.length>0 && resolverImpl.code.length>0,"Missing ENS deployment");
        factory=INameFactory(factory_);platform=IPermissionedRegistry(platform_);
        registryImplementation=registryImpl;resolverImplementation=resolverImpl;parentDNS=parent_;
    }
    function labelDNS(string memory label) private pure returns(bytes memory) {
        bytes memory b=bytes(label);require(b.length>0 && b.length<=63,"Invalid label");
        for(uint256 i;i<b.length;i++)require((b[i]>=0x61&&b[i]<=0x7a)||(b[i]>=0x30&&b[i]<=0x39)||b[i]==0x2d,"Use lowercase ASCII labels");
        return abi.encodePacked(bytes1(uint8(b.length)),b);
    }
    function createCompany(string calldata label,address finance) external returns(address registry) {
        return _createCompany(label,finance,false);
    }
    // Adoption prepares a replacement directory; only the parent owner can attach its pointer.
    function adoptCompany(string calldata label,address finance) external returns(address registry) {
        require(platform.getState(uint256(keccak256(bytes(label)))).latestOwner==msg.sender,"Not parent token owner");
        return _createCompany(label,finance,true);
    }
    function _createCompany(string calldata label,address finance,bool adopt) private returns(address registry) {
        bytes32 id=keccak256(bytes(label));require(companies[id].owner==address(0)&&finance!=address(0),"Company exists or finance missing");
        bytes memory dns=bytes.concat(labelDNS(label),parentDNS);
        Grant[] memory grants=new Grant[](1);grants[0]=Grant(address(this),ALL);
        registry=factory.deployProxy(registryImplementation,uint256(id),abi.encodeWithSignature("initialize((address,uint256)[])",grants));
        require(factory.verifyContract(registry)==registryImplementation,"Wrong registry implementation");
        (bool ok,)=registry.call(abi.encodeWithSignature("setParent(address,string)",address(platform),label));require(ok,"Parent setup failed");
        if(!adopt)platform.register(label,msg.sender,IRegistry(registry),address(0),0,type(uint64).max);
        companies[id]=Company(msg.sender,finance,IPermissionedRegistry(registry),dns);
        emit CompanyCreated(id,label,registry,msg.sender);
    }
    function hire(bytes32 companyHash,string calldata label,address wallet,uint64 term,string calldata weekly,string calldata perCall,string calldata vendors) external returns(address resolver) {
        Company storage c=companies[companyHash];require(msg.sender==c.owner && wallet!=address(0)&&term>0,"Not founder or invalid hire");
        bytes32 employeeId=keccak256(abi.encode(companyHash,label));
        bytes memory dns=bytes.concat(labelDNS(label),c.dns);
        Grant[] memory grants=new Grant[](1);grants[0]=Grant(address(this),ALL);
        bytes[] memory calls=new bytes[](0);
        resolver=factory.deployProxy(resolverImplementation,uint256(keccak256(abi.encode(companyHash,label,wallet,++hireNonces[employeeId]))),abi.encodeWithSignature("initialize((address,uint256)[],bytes[])",grants,calls));
        require(factory.verifyContract(resolver)==resolverImplementation,"Wrong resolver implementation");
        IEmployeeResolver r=IEmployeeResolver(resolver);
        r.setAddress(dns,COIN,abi.encodePacked(wallet));
        r.setText(dns,"enswhite.budget.weekly",weekly);r.setText(dns,"enswhite.limit.perCall",perCall);
        r.setText(dns,"enswhite.vendors",vendors);r.setText(dns,"enswhite.manager",string(abi.encodePacked("finance")));
        r.grantSetterRoles(abi.encodeCall(r.setText,(dns,"enswhite.budget.weekly","")),c.finance);
        r.grantSetterRoles(abi.encodeCall(r.setText,(dns,"enswhite.status","")),wallet);
        for(uint256 i;i<discoveryKeys[employeeId].length;i++){
            string memory key=discoveryKeys[employeeId][i];
            r.setText(dns,key,discoveryValues[employeeId][keccak256(bytes(key))]);
        }
        uint64 expiry=uint64(block.timestamp)+term;
        c.registry.register(label,wallet,IRegistry(address(0)),resolver,EMPLOYEE,expiry);
        emit EmployeeHired(companyHash,label,wallet,resolver,expiry);
    }
    function renew(bytes32 companyHash,string calldata label,uint64 expiry) external {
        Company storage c=companies[companyHash];require(msg.sender==c.owner||msg.sender==c.finance,"Not founder or Finance");
        c.registry.renew(uint256(keccak256(bytes(label))),expiry);
    }
    function setAgentMetadata(bytes32 companyHash,string calldata label,string calldata key,string calldata value) external {
        Company storage c=companies[companyHash];require(msg.sender==c.owner,"Not founder");
        bytes memory k=bytes(key);bytes memory prefix=bytes("agent-registration[");
        bool registration=k.length>prefix.length&&k.length<=256;
        for(uint256 i;registration&&i<prefix.length;i++)if(k[i]!=prefix[i])registration=false;
        require(keccak256(k)==keccak256("agent-context")||keccak256(k)==keccak256("agent-endpoint[web]")||registration,"Discovery key only");
        require(bytes(value).length<=4096,"Invalid discovery value");
        address resolver=c.registry.getResolver(label);require(resolver!=address(0),"Employee resolver missing");
        bytes32 employeeId=keccak256(abi.encode(companyHash,label));bool known;
        for(uint256 i;i<discoveryKeys[employeeId].length;i++)if(keccak256(bytes(discoveryKeys[employeeId][i]))==keccak256(k))known=true;
        if(!known){require(discoveryKeys[employeeId].length<8,"Discovery key limit");discoveryKeys[employeeId].push(key);}
        discoveryValues[employeeId][keccak256(k)]=value;
        IEmployeeResolver(resolver).setText(bytes.concat(labelDNS(label),c.dns),key,value);
    }
    function fire(bytes32 companyHash,string calldata label) external {
        Company storage c=companies[companyHash];require(msg.sender==c.owner,"Not founder");
        c.registry.unregister(uint256(keccak256(bytes(label))));
    }
}
