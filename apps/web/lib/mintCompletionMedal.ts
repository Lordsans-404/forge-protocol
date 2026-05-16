import { ethers } from "ethers";
import { getContract } from "./contract";

export async function mintCompletionMedal(
  commitmentId: bigint,
  signer: ethers.Signer
): Promise<string> {
  const contract = getContract(signer);
  const tx = await contract.completeCommitment(commitmentId);
  const receipt = await tx.wait();
  return receipt.hash;
}
