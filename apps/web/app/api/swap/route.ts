import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const RPC_URL = process.env.NEXT_PUBLIC_EVM_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const USDT_ADDRESS = process.env.NEXT_PUBLIC_EVM_MOCK_USDT_ADDRESS || '';
const AUTHORITY_ADDRESS = process.env.NEXT_PUBLIC_EVM_AUTHORITY_ADDRESS || '';
const AUTHORITY_PRIVATE_KEY = process.env.EVM_AUTHORITY_PRIVATE_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const { walletAddress, transactionHash, usdtAmount } = await req.json();

    if (!walletAddress || !transactionHash || !usdtAmount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!AUTHORITY_PRIVATE_KEY || !USDT_ADDRESS || !AUTHORITY_ADDRESS) {
      return NextResponse.json(
        { error: 'Server misconfiguration: missing environment variables' },
        { status: 500 }
      );
    }

    // 1. Initialize Provider & Wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(AUTHORITY_PRIVATE_KEY, provider);

    // 2. Verify the 0G transfer
    const tx = await provider.getTransaction(transactionHash);
    if (!tx) {
      return NextResponse.json(
        { error: 'Transaction not found on-chain' },
        { status: 404 }
      );
    }

    // Ensure it was sent to the authority address
    if (tx.to?.toLowerCase() !== AUTHORITY_ADDRESS.toLowerCase()) {
      return NextResponse.json(
        { error: 'Transaction was not sent to the correct authority address' },
        { status: 400 }
      );
    }

    // Ensure it was sent by the requesting wallet
    if (tx.from.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Transaction was not sent by the provided wallet address' },
        { status: 400 }
      );
    }

    // Wait for the transaction to be confirmed with retry logic for load balancer sync issues
    let receipt = null;
    let retries = 0;
    while (retries < 5 && !receipt) {
      try {
        receipt = await provider.getTransactionReceipt(transactionHash);
        if (!receipt) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries++;
        }
      } catch (err: any) {
        // Handle "no matching receipts found" (-32000) thrown by ethers if node is out of sync
        if (err?.error?.code === -32000 || err?.code === 'UNKNOWN_ERROR') {
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries++;
        } else {
          throw err;
        }
      }
    }

    if (!receipt || receipt.status !== 1) {
      return NextResponse.json(
        { error: 'Transaction failed on-chain or could not be verified by RPC' },
        { status: 400 }
      );
    }

    // 3. Transfer USDT from Authority to User
    const erc20Abi = [
      'function transfer(address to, uint256 amount) returns (bool)'
    ];
    const usdtContract = new ethers.Contract(USDT_ADDRESS, erc20Abi, wallet);

    // Convert the usdtAmount to 18 decimals (assuming MockUSDT uses 18)
    const amountInWei = ethers.parseEther(usdtAmount.toString());

    // Execute transfer
    const transferTx = await usdtContract.transfer(walletAddress, amountInWei);
    await transferTx.wait();

    return NextResponse.json({
      success: true,
      txSignature: transferTx.hash,
    });
  } catch (error: any) {
    console.error('Swap API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
