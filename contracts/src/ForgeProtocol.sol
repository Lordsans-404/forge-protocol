// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

contract ForgeProtocol is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidStakeAmount();
    error InvalidDuration();
    error InvalidTargetMinutes();
    error CommitmentNotActive();
    error ProofAlreadySubmitted();
    error InvalidDayNumber();
    error UnauthorizedAuthority();
    error CommitmentNotComplete();
    error InvalidProofHash();
    error InsufficientProofMinutes();
    error MaxActiveCommitments();
    error CommitmentAlreadyExists();
    error RedemptionCooldown();
    error SlashWindowNotReached();
    error MaxFailuresReached();
    
    enum CommitmentStatus { Active, Completed, Failed, Redemption }

    struct Commitment {
        address owner;
        uint256 stakeAmount;
        uint256 remainingStake;
        uint16 durationDays;
        uint16 dailyTargetMinutes;
        uint16 currentDay;
        uint8 failedCount;
        uint8 earlyFinishCount;
        uint16 proofCount;
        CommitmentStatus status;
        bool isRedemption;
        uint256 createdAt;
        uint256 lastProofAt;
    }

    struct UserProfile {
        uint16 totalCommitments;
        uint8 activeCommitments;
        uint16 totalCompleted;
        uint16 totalFailed;
        uint8 redemptionCount;
        uint256 lastRedemptionTs;
    }

    struct GlobalState {
        address authority;
        IERC20 token;
        uint256 charityBalance;
        uint256 rewardsBalance;
        uint256 treasuryBalance;
        uint256 backupBalance;
        uint256 totalSlashed;
        uint256 totalRewarded;
        uint256 commitmentNonce;
    }

    GlobalState public globalState;
    
    mapping(uint256 => Commitment) public commitments;
    mapping(uint256 => mapping(uint16 => bytes32)) public proofHashes;
    mapping(address => UserProfile) public userProfiles;
    mapping(address => uint256) public userNonce;

    event CommitmentCreated(address indexed owner, uint256 indexed commitmentId, uint256 stakeAmount, uint16 durationDays, uint16 dailyTargetMinutes);
    event ProofSubmitted(uint256 indexed commitmentId, uint16 dayNumber, bytes32 proofHash, uint16 actualMinutes, bool isEarlyFinish);
    event CommitmentCompleted(uint256 indexed commitmentId, address indexed owner, uint256 rewardAmount, uint8 penaltyPercent, uint8 earlyFinishCount);
    event SlashExecuted(uint256 indexed commitmentId, uint256 slashedAmount, uint8 failCount, uint256 charityAmount, uint256 rewardsAmount, uint256 treasuryAmount, uint256 backupAmount, uint8 newStatus);

    modifier onlyAuthority() {
        if (msg.sender != globalState.authority) revert UnauthorizedAuthority();
        _;
    }

    constructor(address _authority, address _token) {
        globalState.authority = _authority;
        globalState.token = IERC20(_token);
    }

    function createCommitment(
        uint256 stakeAmount,
        uint16 durationDays,
        uint16 dailyTargetMinutes
    ) external nonReentrant returns (uint256 commitmentId) { // <-- tidak perlu input ID lagi
        if (stakeAmount == 0) revert InvalidStakeAmount();
        if (durationDays < 7 || durationDays > 365) revert InvalidDuration(); // min 7 hari, sama seperti Solana
        if (dailyTargetMinutes < 10) revert InvalidTargetMinutes();           // min 10 menit, sama seperti Solana

        UserProfile storage profile = userProfiles[msg.sender];
        if (profile.activeCommitments >= 10) revert MaxActiveCommitments();

        // Generate ID on-chain — tidak bisa collision
        commitmentId = uint256(keccak256(abi.encodePacked(
            msg.sender,
            userNonce[msg.sender],
            block.timestamp
        )));
        userNonce[msg.sender] += 1;

        // Pastikan tidak collision (edge case hash)
        if (commitments[commitmentId].owner != address(0)) revert CommitmentAlreadyExists();

        globalState.token.safeTransferFrom(msg.sender, address(this), stakeAmount);

        commitments[commitmentId] = Commitment({
            owner: msg.sender,
            stakeAmount: stakeAmount,
            remainingStake: stakeAmount,
            durationDays: durationDays,
            dailyTargetMinutes: dailyTargetMinutes,
            currentDay: 0,
            failedCount: 0,
            earlyFinishCount: 0,
            proofCount: 0,
            status: CommitmentStatus.Active,
            isRedemption: false,
            createdAt: block.timestamp,
            lastProofAt: block.timestamp // <-- diisi saat create (untuk deadline hari pertama)
        });

        profile.totalCommitments += 1;
        profile.activeCommitments += 1;

        emit CommitmentCreated(msg.sender, commitmentId, stakeAmount, durationDays, dailyTargetMinutes);
    }

    // Update submitProof() — catat timestamp
    function submitProof(
        uint256 commitmentId,
        uint16 dayNumber,
        bytes32 proofHash,
        uint16 actualMinutes
    ) external {
        Commitment storage commit = commitments[commitmentId];
        if (commit.owner != msg.sender) revert UnauthorizedAuthority();
        if (commit.status != CommitmentStatus.Active) revert CommitmentNotActive();
        if (dayNumber != commit.currentDay + 1) revert InvalidDayNumber();
        if (proofHashes[commitmentId][dayNumber] != bytes32(0)) revert ProofAlreadySubmitted();
        if (proofHash == bytes32(0)) revert InvalidProofHash();

        uint16 halfTarget = commit.dailyTargetMinutes / 2;
        if (actualMinutes < halfTarget) revert InsufficientProofMinutes();

        bool isEarlyFinish = actualMinutes < commit.dailyTargetMinutes;

        proofHashes[commitmentId][dayNumber] = proofHash;
        commit.currentDay = dayNumber;
        commit.proofCount += 1;
        commit.lastProofAt = block.timestamp; // <-- update deadline window
        if (isEarlyFinish) commit.earlyFinishCount += 1;

        emit ProofSubmitted(commitmentId, dayNumber, proofHash, actualMinutes, isEarlyFinish);
    }

    function completeCommitment(uint256 commitmentId) external nonReentrant {
        Commitment storage commit = commitments[commitmentId];
        if (commit.owner != msg.sender) revert UnauthorizedAuthority();
        if (commit.status != CommitmentStatus.Active) revert CommitmentNotActive();
        if (commit.proofCount < commit.durationDays) revert CommitmentNotComplete();

        UserProfile storage profile = userProfiles[msg.sender];

        // ── 1. Hitung penalty: 1% per early finish ──────────────────────────
        uint8 penaltyPercent = commit.earlyFinishCount;
        uint256 penaltyAmount = (commit.remainingStake * penaltyPercent) / 100;
        uint256 baseReward = commit.remainingStake - penaltyAmount;

        // ── 2. Hitung bonus dari rewards pool ───────────────────────────────
        // 3% jika sudah >= 3 completed, selainnya 1%
        // Dicek SEBELUM totalCompleted di-increment (sama seperti Solana)
        uint8 bonusPercent = profile.totalCompleted >= 3 ? 3 : 1;
        uint256 maxBonus = (commit.stakeAmount * bonusPercent) / 100;
        uint256 bonusAmount = maxBonus < globalState.rewardsBalance 
            ? maxBonus 
            : globalState.rewardsBalance; // cap ke saldo yang tersedia

        uint256 totalUserReceives = baseReward + bonusAmount;

        // ── 3. Update state ─────────────────────────────────────────────────
        commit.status = CommitmentStatus.Completed;
        commit.remainingStake = 0;

        profile.activeCommitments -= 1;
        profile.totalCompleted += 1;

        // Penalty masuk ke rewards pool (token sudah ada di kontrak)
        if (penaltyAmount > 0) {
            globalState.rewardsBalance += penaltyAmount;
        }

        // Bonus diambil dari rewards pool
        if (bonusAmount > 0) {
            globalState.rewardsBalance -= bonusAmount;
        }

        globalState.totalRewarded += totalUserReceives;

        // ── 4. Transfer token ke user ────────────────────────────────────────
        if (totalUserReceives > 0) {
            globalState.token.safeTransfer(msg.sender, totalUserReceives);
        }

        emit CommitmentCompleted(
            commitmentId, 
            msg.sender, 
            totalUserReceives, 
            penaltyPercent, 
            commit.earlyFinishCount
        );
    }

    function slash(uint256 commitmentId, string calldata) external onlyAuthority nonReentrant {
        Commitment storage commit = commitments[commitmentId];
        if (commit.status != CommitmentStatus.Active) revert CommitmentNotActive();

        if (block.timestamp < commit.lastProofAt + 24) revert SlashWindowNotReached();
        
        // Sama seperti Solana: max 2x gagal
        if (commit.failedCount >= 2) revert MaxFailuresReached();

        commit.failedCount += 1;

        // ── Logika slash sama seperti Solana ────────────────────────────────
        uint256 slashAmount;
        bool isTerminated;

        if (commit.durationDays <= 7) {
            slashAmount = commit.remainingStake;
            isTerminated = true;
        } else if (commit.failedCount == 1) {
            // First failure: 40% dari stake awal (bukan remainingStake)
            slashAmount = (commit.stakeAmount * 40) / 100;
        } else {
            // Second failure: semua sisa
            slashAmount = commit.remainingStake;
            isTerminated = true;
        }

        require(slashAmount > 0, "slash: zero amount");
        require(commit.remainingStake >= slashAmount, "slash: insufficient stake");

        commit.remainingStake -= slashAmount;
        commit.status = isTerminated ? CommitmentStatus.Failed : CommitmentStatus.Active;
        
        // Reset window jika masih active (beri kesempatan hari berikutnya)
        if (!isTerminated) {
            commit.lastProofAt = block.timestamp;
        }

        if (isTerminated) {
            UserProfile storage profile = userProfiles[commit.owner];
            profile.activeCommitments -= 1;
            profile.totalFailed += 1;
        }

        uint256 charityAmount  = (slashAmount * 40) / 100;
        uint256 rewardsAmount  = (slashAmount * 40) / 100;
        uint256 treasuryAmount = (slashAmount * 10) / 100;
        uint256 backupAmount   = slashAmount - charityAmount - rewardsAmount - treasuryAmount;

        globalState.charityBalance  += charityAmount;
        globalState.rewardsBalance  += rewardsAmount;
        globalState.treasuryBalance += treasuryAmount;
        globalState.backupBalance   += backupAmount;
        globalState.totalSlashed    += slashAmount;

        emit SlashExecuted(
            commitmentId, slashAmount, commit.failedCount,
            charityAmount, rewardsAmount, treasuryAmount, backupAmount,
            uint8(commit.status)
        );
    }

    function redeem(uint256 oldCommitmentId, uint256 newCommitmentId, uint256 stakeAmount, uint16 durationDays, uint16 dailyTargetMinutes) external nonReentrant {
        Commitment storage oldCommit = commitments[oldCommitmentId];
        if (oldCommit.owner != msg.sender) revert UnauthorizedAuthority();
        if (oldCommit.status != CommitmentStatus.Failed) revert CommitmentNotActive();
        
        UserProfile storage profile = userProfiles[msg.sender];
        if (block.timestamp < profile.lastRedemptionTs + 30 days && profile.lastRedemptionTs != 0) revert RedemptionCooldown();
        
        if (stakeAmount == 0) revert InvalidStakeAmount();
        if (durationDays < 1 || durationDays > 365) revert InvalidDuration();
        if (dailyTargetMinutes < 1) revert InvalidTargetMinutes();
        if (commitments[newCommitmentId].owner != address(0)) revert CommitmentAlreadyExists();
        
        globalState.token.safeTransferFrom(msg.sender, address(this), stakeAmount);

        commitments[newCommitmentId] = Commitment({
            owner: msg.sender,
            stakeAmount: stakeAmount,
            remainingStake: stakeAmount,
            durationDays: durationDays,
            dailyTargetMinutes: dailyTargetMinutes,
            currentDay: 0,
            failedCount: 0,
            earlyFinishCount: 0,
            proofCount: 0,
            status: CommitmentStatus.Active,
            isRedemption: true,
            createdAt: block.timestamp,
            lastProofAt: block.timestamp
        });

        profile.activeCommitments += 1;
        profile.redemptionCount += 1;
        profile.lastRedemptionTs = block.timestamp;
    }
    
    function getCommitment(uint256 commitmentId) external view returns (Commitment memory) {
        return commitments[commitmentId];
    }
}
