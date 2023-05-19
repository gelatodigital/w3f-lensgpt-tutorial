export const prompt_abi = [
  {
    inputs: [
      {
        internalType: "contract ILensHub",
        name: "_lensHub",
        type: "address",
      },
      {
        internalType: "address",
        name: "_dedicatedMsgSender",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "from",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "to",
        type: "uint256",
      },
    ],
    name: "getPaginatedPrompts",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "profileId",
            type: "uint256",
          },
          {
            internalType: "string",
            name: "prompt",
            type: "string",
          },
        ],
        internalType: "struct LensGelatoGPT.prompt[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "profileId",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "profile_prompt",
        type: "string",
      },
    ],
    name: "setPrompt",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "profileId",
        type: "uint256",
      },
    ],
    name: "stopPrompt",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
