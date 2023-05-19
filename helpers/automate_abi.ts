export const automate_abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_taskCreator",
        type: "address",
      },
      {
        internalType: "address",
        name: "_execAddress",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "_execData",
        type: "bytes",
      },
      {
        components: [
          {
            internalType: "enum LibDataTypes.Module[]",
            name: "modules",
            type: "uint8[]",
          },
          {
            internalType: "bytes[]",
            name: "args",
            type: "bytes[]",
          },
        ],
        internalType: "struct LibDataTypes.ModuleData",
        name: "_moduleData",
        type: "tuple",
      },
      {
        components: [
          {
            internalType: "address",
            name: "sponsor",
            type: "address",
          },
          {
            internalType: "address",
            name: "feeToken",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "oneBalanceChainId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "nativeToFeeTokenXRateNumerator",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "nativeToFeeTokenXRateDenominator",
            type: "uint256",
          },
          {
            internalType: "bytes32",
            name: "correlationId",
            type: "bytes32",
          },
        ],
        internalType: "struct IGelato1Balance.Gelato1BalanceParam",
        name: "_oneBalanceParam",
        type: "tuple",
      },
      {
        internalType: "bool",
        name: "_revertOnFailure",
        type: "bool",
      },
    ],
    name: "exec1Balance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
