// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICompanyGas {
    function owner() external view returns (address);
    function companyBalance() external view returns (uint256);
    function feePool() external view returns (uint256);
    function withdrawFees(address) external;
}
interface IYetiGasRouter {
    struct Params { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }
    function exactInputSingle(Params calldata) external payable returns (uint256);
    function unwrapWETH9(uint256 minimum, address recipient) external payable;
    function multicall(uint256 deadline, bytes[] calldata calls) external payable returns (bytes[] memory);
}
interface IYetiGasQuoter {
    struct Params { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
    function quoteExactInputSingle(Params calldata) external returns (uint256, uint160, uint32, uint256);
}

contract GasReplenisherForkTest is Test {
    function testForkWithdrawFeesSwapOnYetiAndFundNativeRelayerGas() public {
        vm.skip(!vm.envOr("WHITECHAIN_FORK_TEST", false));
        vm.createSelectFork("https://rpc.testnet.whitechain.io", 12330293);
        ICompanyGas company = ICompanyGas(0xD36605397FaFefaAe2c3eBfA95af1c732A322B31);
        IERC20 token = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
        address wwbt = 0x4200000000000000000000000000000000000006;
        address router = 0xe208cC685cD95D56E8ec6DEC9816476567fc6962;
        address relayer = 0x68C67De1969D1ea00bB80E751ce70D33978ff373;
        uint256 fees = company.feePool();
        uint256 creditBefore = company.companyBalance();
        uint256 gasBefore = relayer.balance;
        assertGt(fees, 0);
        uint256 beforeTokens = token.balanceOf(address(this));
        vm.prank(company.owner()); company.withdrawFees(address(this));
        assertEq(token.balanceOf(address(this)), beforeTokens + fees);
        assertEq(company.feePool(), 0);
        (uint256 quoted,,,) = IYetiGasQuoter(0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191).quoteExactInputSingle(
            IYetiGasQuoter.Params(address(token), wwbt, fees, 3000, 0)
        );
        uint256 minimum = quoted * 9950 / 10_000;
        assertGt(minimum, 0);
        assertTrue(token.approve(router, fees));
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IYetiGasRouter.exactInputSingle, (IYetiGasRouter.Params(address(token), wwbt, 3000, router, fees, minimum, 0)));
        calls[1] = abi.encodeCall(IYetiGasRouter.unwrapWETH9, (minimum, relayer));
        IYetiGasRouter(router).multicall(block.timestamp + 120, calls);
        assertGe(relayer.balance - gasBefore, minimum);
        assertEq(token.balanceOf(relayer), 0);
        assertEq(token.balanceOf(address(this)), beforeTokens);
        assertEq(token.allowance(address(this), router), 0);
        assertEq(company.companyBalance(), creditBefore);
    }
}
