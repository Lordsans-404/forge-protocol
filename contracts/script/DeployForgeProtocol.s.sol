// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ForgeProtocol} from "../src/ForgeProtocol.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// Kita deploy MockUSDT agar ada token yang bisa dipakai untuk testing di testnet
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {
        // Mint 10 juta USDT ke wallet yang mendeploy
        _mint(msg.sender, 10_000_000 * 10 ** 18);
    }
}

contract DeployForgeProtocol is Script {
    function run() external {
        // Mulai mencatat transaksi yang akan dibroadcast ke blockchain
        vm.startBroadcast();

        // 1. Deploy Mock USDT (Hanya untuk testnet agar ada tokennya)
        MockUSDT usdt = new MockUSDT();
        console.log("Mock USDT deployed at:", address(usdt));

        // 2. Tentukan Authority Address 
        // msg.sender otomatis adalah address dari wallet private key yang Anda gunakan
        address authority = msg.sender;
        
        // 3. Deploy Forge Protocol
        ForgeProtocol protocol = new ForgeProtocol(authority, address(usdt));
        
        console.log("ForgeProtocol deployed at:", address(protocol));
        console.log("Authority address set to:", authority);

        // Selesai mencatat transaksi
        vm.stopBroadcast();
    }
}
