import { task } from "hardhat/config";

export const verify = task("etherscan-verify", "verify").setAction(
  async ({}, hre) => {
    await hre.run("verify:verify", {
      address: "0x166c1657D6927EeF51D1FC8aC7b2CF001Cbf8dFE",
      constructorArguments: [
        "0x60Ae865ee4C725cd04353b5AAb364553f56ceF82",
        "0xcc53666e25bf52c7c5bc1e8f6e1f6bf58e871659",
      ],
    });
  }
);
