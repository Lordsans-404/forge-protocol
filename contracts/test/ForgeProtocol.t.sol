// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ForgeProtocol} from "../src/ForgeProtocol.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ForgeProtocolTest is Test {
    ForgeProtocol public protocol;
    MockERC20 public token;

    address public authority = address(0xA11CE);
    address public user1 = address(0xB0B);
    address public user2 = address(0xC0C);

    uint256 public constant INITIAL_BALANCE = 1000 * 1e18;
    uint256 public constant STAKE_AMOUNT = 100 * 1e18;

    function setUp() public {
        // 1. Deploy mock token
        token = new MockERC20();

        // 2. Deploy protocol
        protocol = new ForgeProtocol(authority, address(token));

        // 3. Mint tokens to users
        token.mint(user1, INITIAL_BALANCE);
        token.mint(user2, INITIAL_BALANCE);

        // 4. Approve protocol to spend users' tokens
        vm.prank(user1);
        token.approve(address(protocol), type(uint256).max);

        vm.prank(user2);
        token.approve(address(protocol), type(uint256).max);
    }

    function test_CreateCommitment() public {
        vm.startPrank(user1);

        uint16 duration = 7;
        uint16 targetMinutes = 30;

        uint256 commitmentId = protocol.createCommitment(STAKE_AMOUNT, duration, targetMinutes);

        // Verify state
        ForgeProtocol.Commitment memory commit = protocol.getCommitment(commitmentId);
        assertEq(commit.owner, user1);
        assertEq(commit.stakeAmount, STAKE_AMOUNT);
        assertEq(commit.durationDays, duration);
        assertEq(uint(commit.status), uint(ForgeProtocol.CommitmentStatus.Active));

        // Verify token transfer
        assertEq(token.balanceOf(user1), INITIAL_BALANCE - STAKE_AMOUNT);
        assertEq(token.balanceOf(address(protocol)), STAKE_AMOUNT);

        vm.stopPrank();
    }

    function test_RevertCreateCommitmentInvalidStake() public {
        vm.prank(user1);
        vm.expectRevert(ForgeProtocol.InvalidStakeAmount.selector);
        protocol.createCommitment(0, 7, 30);
    }

    function test_SubmitProof() public {
        vm.startPrank(user1);
        uint256 commitmentId = protocol.createCommitment(STAKE_AMOUNT, 7, 30);

        bytes32 proofHash = keccak256("test_proof");
        
        // Submit proof for day 1
        protocol.submitProof(commitmentId, 1, proofHash, 35); // 35 actual minutes

        ForgeProtocol.Commitment memory commit = protocol.getCommitment(commitmentId);
        assertEq(commit.currentDay, 1);
        assertEq(commit.proofCount, 1);
        assertEq(commit.earlyFinishCount, 0); // Not early, because 35 >= 30

        vm.stopPrank();
    }

    function test_CompleteCommitment() public {
        vm.startPrank(user1);
        uint16 duration = 7;
        uint256 commitmentId = protocol.createCommitment(STAKE_AMOUNT, duration, 30);

        // Submit proofs for 7 days
        for (uint16 i = 1; i <= duration; i++) {
            bytes32 proofHash = keccak256(abi.encodePacked("proof", i));
            protocol.submitProof(commitmentId, i, proofHash, 30);
            
            // Fast forward time slightly to simulate time passing
            vm.warp(block.timestamp + 1 days);
        }

        // Before completion, protocol holds the tokens
        assertEq(token.balanceOf(address(protocol)), STAKE_AMOUNT);

        // Complete the commitment
        protocol.completeCommitment(commitmentId);

        // Verify status is completed
        ForgeProtocol.Commitment memory commit = protocol.getCommitment(commitmentId);
        assertEq(uint(commit.status), uint(ForgeProtocol.CommitmentStatus.Completed));

        // Because there's no early finish penalty and user gets base reward,
        // they should receive their initial stake back.
        assertEq(token.balanceOf(user1), INITIAL_BALANCE);

        vm.stopPrank();
    }

    function test_Slash() public {
        // User creates commitment
        vm.prank(user1);
        uint256 commitmentId = protocol.createCommitment(STAKE_AMOUNT, 7, 30);

        // Fast forward time 25 hours to simulate missed day
        vm.warp(block.timestamp + 25 hours);

        // Authority slashes the commitment
        vm.prank(authority);
        protocol.slash(commitmentId, "Missed daily proof");

        ForgeProtocol.Commitment memory commit = protocol.getCommitment(commitmentId);
        
        // Because duration <= 7 days, first failure should terminate and slash all remaining stake
        assertEq(uint(commit.status), uint(ForgeProtocol.CommitmentStatus.Failed));
        assertEq(commit.remainingStake, 0);

        // Check global balances
        (,, uint256 charity, uint256 rewards, uint256 treasury, uint256 backup, , , ) = protocol.globalState();
        assertEq(charity, (STAKE_AMOUNT * 40) / 100);
        assertEq(rewards, (STAKE_AMOUNT * 40) / 100);
        assertEq(treasury, (STAKE_AMOUNT * 10) / 100);
    }

    function test_RevertSlashUnauthorized() public {
        vm.prank(user1);
        uint256 commitmentId = protocol.createCommitment(STAKE_AMOUNT, 7, 30);

        vm.warp(block.timestamp + 25 hours);

        // User2 tries to slash (should fail)
        vm.prank(user2);
        vm.expectRevert(ForgeProtocol.UnauthorizedAuthority.selector);
        protocol.slash(commitmentId, "Fake slash");
    }
}
