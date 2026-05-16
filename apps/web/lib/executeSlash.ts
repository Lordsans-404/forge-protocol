import { ethers } from "ethers";
import { getContract } from "./contract";

export async function executeSlash(
  commitmentId: bigint,
  signer: ethers.Signer
): Promise<string> {
  const contract = getContract(signer);
  const tx = await contract.slash(commitmentId, "Failed daily target");
  const receipt = await tx.wait();
  return receipt.hash;
}
