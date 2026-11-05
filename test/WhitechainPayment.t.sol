// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface VmPayment {
    function envOr(string calldata name, bool defaultValue) external returns (bool);
    function skip(bool condition) external;
    function createSelectFork(string calldata url) external returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function expectRevert() external;
}

interface TestUSDT {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
}

contract WhitechainPaymentTest {
    VmPayment constant vm = VmPayment(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestUSDT constant token = TestUSDT(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);

    function testForkFundAgentAndRelayAuthorizationOnce() public {
        vm.skip(!vm.envOr("WHITECHAIN_FORK_TEST", false));
        vm.createSelectFork("https://rpc.testnet.whitechain.io");
        require(block.chainid == 1874, "Wrong fork chain");
        // Public throwaway test key; transactions execute only on this in-memory fork.
        uint256 agentKey = 123456;
        address agent = vm.addr(agentKey);
        address merchant = address(0xBEEF);
        uint256 beforeBalance = token.balanceOf(merchant);
        vm.prank(0x4F961b8Abd8AF7cCdCcc4F76cd7326d8FbEa0594);
        require(token.transfer(agent, 1_000_000), "Funding failed");
        bytes32 nonce = keccak256("relay-fork-test");
        uint256 validBefore = block.timestamp + 300;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            agent, merchant, 100_000, 0, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        // The caller is a relayer, not the agent. The agent holds zero native WBT.
        vm.prank(address(0xCAFE));
        token.transferWithAuthorization(agent, merchant, 100_000, 0, validBefore, nonce, signature);
        require(agent.balance == 0, "Agent should not need WBT");
        require(token.balanceOf(agent) == 900_000, "Wrong agent balance");
        require(token.balanceOf(merchant) == beforeBalance + 100_000, "Wrong merchant balance");
        require(token.authorizationState(agent, nonce), "Authorization not consumed");
        vm.expectRevert();
        token.transferWithAuthorization(agent, merchant, 100_000, 0, validBefore, nonce, signature);
    }
}
