import { ethers } from "ethers";
import abi from "./abi.json";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_EVM_FORGE_PROTOCOL_ADDRESS!;

export function getContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, abi, signerOrProvider);
}
