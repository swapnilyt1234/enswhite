// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IReceiveAuthorization {
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}

contract RelayCompany is Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable attester;
    uint256 public immutable feeBps;
    address public finance;
    uint256 public companyBalance;
    uint256 public feePool;
    uint256 public allocationNonce;
    bytes32 public constant TOP_UP_TYPEHASH = keccak256("TopUp(bytes32 paymentId,uint256 amount,uint256 deadline)");
    bytes32 public constant ALLOCATE_TYPEHASH = keccak256("Allocate(address dept,uint256 amount,uint256 nonce,uint256 deadline)");
    struct Limits { uint256 perCall; uint256 perDay; }
    struct DailySpend { uint256 day; uint256 amount; }
    mapping(address => Limits) public limits;
    mapping(address => DailySpend) public dailySpend;
    mapping(address => uint256) public vendorMaxPrice;
    mapping(bytes32 => bool) public usedPayments;
    mapping(bytes32 => bool) public usedRequests;
    event ToppedUp(bytes32 indexed paymentId, uint256 amount);
    event Allocated(address indexed dept, uint256 amount);
    event Paid(bytes32 indexed requestId, address indexed dept, address indexed vendor, uint256 amount, uint256 fee);
    event VendorRegistered(address indexed vendor, uint256 maxPrice);
    event LimitsSet(address indexed dept, uint256 perCallMax, uint256 perDayMax);
    event FinanceSet(address indexed finance);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address token_, address attester_, uint256 feeBps_) Ownable(msg.sender) EIP712("RelayCompany", "1") {
        require(token_.code.length > 0 && attester_ != address(0), "Invalid configuration");
        require(feeBps_ <= 100, "Fee exceeds 1 percent");
        token = IERC20(token_); attester = attester_; feeBps = feeBps_;
    }

    function topUp(bytes32 paymentId, uint256 amount, uint256 deadline, bytes calldata attesterSig) external nonReentrant {
        require(amount > 0 && block.timestamp <= deadline, "Invalid top-up");
        require(!usedPayments[paymentId], "Payment already credited");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(TOP_UP_TYPEHASH, paymentId, amount, deadline)));
        require(ECDSA.recover(digest, attesterSig) == attester, "Invalid attestation");
        require(token.balanceOf(address(this)) >= companyBalance + feePool + amount, "Pool not prefunded");
        usedPayments[paymentId] = true;
        companyBalance += amount;
        emit ToppedUp(paymentId, amount);
    }

    function setFinance(address finance_) external onlyOwner { require(finance_ != address(0), "Zero finance"); finance = finance_; emit FinanceSet(finance_); }
    function registerVendor(address vendor, uint256 maxPrice) external onlyOwner {
        require(vendor != address(0) && vendor != address(this), "Invalid vendor");
        vendorMaxPrice[vendor] = maxPrice;
        emit VendorRegistered(vendor, maxPrice);
    }
    function setLimits(address dept, uint256 perCallMax, uint256 perDayMax) external onlyOwner {
        require(dept != address(0) && dept != address(this) && perCallMax <= perDayMax, "Invalid limits");
        limits[dept] = Limits(perCallMax, perDayMax);
        emit LimitsSet(dept, perCallMax, perDayMax);
    }
    function allocate(address dept, uint256 amount) external nonReentrant {
        require(msg.sender == owner() || msg.sender == finance, "Not finance or owner");
        _allocate(dept, amount);
    }
    // Finance holds no WBT: it signs the allocation and the relayer pays its transaction gas.
    function allocateBySig(address dept, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature) external nonReentrant {
        require(block.timestamp <= deadline && nonce == allocationNonce, "Invalid allocation nonce/deadline");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ALLOCATE_TYPEHASH, dept, amount, nonce, deadline)));
        require(finance != address(0) && ECDSA.recover(digest, signature) == finance, "Invalid finance signature");
        allocationNonce++;
        _allocate(dept, amount);
    }
    function _allocate(address dept, uint256 amount) private {
        require(limits[dept].perCall > 0 && amount > 0 && amount <= companyBalance, "Invalid allocation");
        companyBalance -= amount;
        token.safeTransfer(dept, amount);
        emit Allocated(dept, amount);
    }

    function paymentNonce(address vendor, bytes32 requestId, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(vendor, requestId, salt));
    }
    function pay(address dept, address vendor, uint256 amount, bytes32 requestId, bytes32 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        require(!usedRequests[requestId], "Request already paid");
        require(vendorMaxPrice[vendor] > 0 && amount > 0 && amount <= vendorMaxPrice[vendor], "Vendor not allowed or price exceeded");
        Limits memory policy = limits[dept];
        require(amount <= policy.perCall && policy.perCall > 0, "Per-call limit exceeded");
        uint256 today = block.timestamp / 1 days;
        DailySpend storage spend = dailySpend[dept];
        if (spend.day != today) { spend.day = today; spend.amount = 0; }
        require(spend.amount + amount <= policy.perDay, "Daily limit exceeded");
        usedRequests[requestId] = true; spend.amount += amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        IReceiveAuthorization(address(token)).receiveWithAuthorization(dept, address(this), amount, validAfter, validBefore, paymentNonce(vendor, requestId, salt), v, r, s);
        require(token.balanceOf(address(this)) == beforeBalance + amount, "Token receipt mismatch");
        uint256 fee = amount * feeBps / 10_000;
        feePool += fee;
        token.safeTransfer(vendor, amount - fee);
        emit Paid(requestId, dept, vendor, amount, fee);
    }
    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero recipient");
        uint256 amount = feePool; feePool = 0;
        token.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }
}
