import { task } from "hardhat/config";

export const verify = task("etherscan-verify", "verify").setAction(
  async ({}, hre) => {
    await hre.run("verify:verify", {
      address: "0x6456388ef4a78748d097f99e6d6d249066614a4f",
      constructorArguments: [
        "0xDb46d1Dc155634FbC732f92E853b10B288AD5a1d",
        "0xbb97656cd5fece3a643335d03c8919d5e7dcd225",
      ],
    });
  }
);
