/* eslint-disable @typescript-eslint/naming-convention */
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { BigNumber, Contract, utils } from "ethers";
import { Configuration, OpenAIApi } from "openai";
import { v4 as uuidv4 } from "uuid";
import { Web3Storage, File, CIDString } from "web3.storage";
import { lensHubAbi } from "../../../helpers/lensHubAbi";
import {
  LensClient,
  PublicationMainFocus,
  PublicationMetadataDisplayTypes,
  production,
} from "@lens-protocol/client";
import { promptAbi } from "../../../helpers/promptAbi";
import { LensGelatoGPT } from "../../../typechain";
import { PromptStructOutput } from "../../../typechain/LensGelatoGPT";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider, secrets, storage } = context;
  const provider = multiChainProvider.default();

  // User Secrets
  const WEB3_STORAGE_API_KEY = await secrets.get("WEB3_STORAGE_API_KEY");
  const OPEN_AI_API_KEY = await secrets.get("OPEN_AI_API_KEY");
  if (!WEB3_STORAGE_API_KEY || !OPEN_AI_API_KEY) {
    console.error("Error: Missing secrets");
    return {
      canExec: false,
      message: "Error: Missing Secrets",
    };
  }

  // User userArgs
  const lensGelatoGPTAddress = userArgs.lensGelatoGPT as string;
  const lensHubAddress = userArgs.lensHubAddress as string;
  const collectModuleAddress = userArgs.collectModule as string;
  if (
    !utils.isAddress(lensGelatoGPTAddress) ||
    !utils.isAddress(lensHubAddress) ||
    !utils.isAddress(collectModuleAddress)
  ) {
    console.error("Error: Invalid address userArgs");
    return {
      canExec: false,
      message: "Error: Invalid address userArgs",
    };
  }

  const NUMBER_OF_POSTS_PER_RUN = 10;
  const INTERVAL_IN_MIN = 480;

  const lastRunStartTime = parseInt(
    (await storage.get("lastRunStartTime")) ?? "0"
  );
  const nextPromptIndex = parseInt(
    (await storage.get("nextPromptIndex")) ?? "0"
  );

  const lensGelatoGpt = new Contract(
    lensGelatoGPTAddress,
    promptAbi,
    provider
  ) as LensGelatoGPT;

  const blockTime = (await provider.getBlock("latest")).timestamp;
  const isNewInterval = blockTime - lastRunStartTime >= INTERVAL_IN_MIN * 60;
  const lastIntervalRunFinished = nextPromptIndex == 0;

  const isNewcomerRun = await lensGelatoGpt.areThereNewProfileIds();
  const isScheduledRun = !isNewcomerRun && isNewInterval;

  if (lastIntervalRunFinished && !isNewcomerRun && !isNewInterval) {
    return {
      canExec: false,
      message:
        "Last run finished, but not newcomers, nor interval wait finished",
    };
  }

  const prompts: PromptStructOutput[] = [];

  const callDatas: Array<{ to: string; data: string }> = [];

  if (isNewcomerRun) {
    const allNewPrompts = await lensGelatoGpt.getNewPrompts();
    const firstSliceOfNewPrompts = allNewPrompts.slice(
      0,
      NUMBER_OF_POSTS_PER_RUN
    );

    // Add call to remove firstSliceOfNewPrompts
    // Assumption: in next run, the firstSliceOfNewPrompts will be the next ones
    const profileIds = firstSliceOfNewPrompts.map((map) => map.profileId);
    callDatas.push({
      to: lensGelatoGPTAddress,
      data: lensGelatoGpt.interface.encodeFunctionData("removeNewProfileIds", [
        profileIds,
      ]),
    });

    prompts.push(...firstSliceOfNewPrompts);
  } else {
    prompts.push(
      ...(await lensGelatoGpt.getPaginatedPrompts(
        nextPromptIndex,
        nextPromptIndex + NUMBER_OF_POSTS_PER_RUN
      ))
    );
  }

  const nonEmptyPrompts = prompts.filter(
    (prompt) => prompt.profileId.toString() !== "0"
  );

  const { chainId } = await provider.getNetwork();
  const isTest = chainId == 31337;

  const profileIdsArray = nonEmptyPrompts.map((prompt) => prompt.profileId);
  let contentURIArray: string[];

  if (!isTest) {
    // Get Sentence OpenAi only if not in test
    const parallelCalls = nonEmptyPrompts.map((prompt) =>
      getLensData(prompt.prompt, OPEN_AI_API_KEY, WEB3_STORAGE_API_KEY)
    );
    const parallelCallsResult = await Promise.all(parallelCalls);
    const errorIndex = parallelCallsResult.findIndex(
      (error) => error.canExec == false
    );
    if (errorIndex !== -1) {
      return parallelCallsResult[errorIndex] as {
        canExec: false;
        message: string;
      };
    }
    contentURIArray = parallelCallsResult.map(
      (parallelCall) =>
        (parallelCall as { canExec: true; contentURI: string }).contentURI
    );
  } else {
    // DON't get Sentence OpenAi when in Test
    contentURIArray = nonEmptyPrompts.map((prompt) => prompt.prompt);
  }

  for (let i = 0; i < profileIdsArray.length; i++) {
    const postCallData = buildPostCallData(
      profileIdsArray[i],
      contentURIArray[i],
      collectModuleAddress,
      lensHubAddress
    );
    callDatas.push(postCallData);
  }

  // Process storage updates only for scheduled runs
  if (isScheduledRun) {
    const totalNumberOfProfiles =
      await lensGelatoGpt.getTotalNumberOfProfiles();

    const isLastRun =
      nextPromptIndex + NUMBER_OF_POSTS_PER_RUN >=
      totalNumberOfProfiles.toNumber();

    if (lastIntervalRunFinished) {
      await storage.set("lastRunStartTime", blockTime.toString());
    } else if (isLastRun) {
      await storage.set("nextPromptIndex", "0");
    } else {
      await storage.set(
        "nextPromptIndex",
        (nextPromptIndex + NUMBER_OF_POSTS_PER_RUN).toString()
      );
    }
  }

  return callDatas.length == 0
    ? { canExec: false, message: "Not Prompts to post" }
    : {
        canExec: true,
        callData: callDatas,
      };
});

const buildPostCallData = (
  _profileId: BigNumber,
  _contentURI: string,
  _collectModuleAddress: string,
  _lensHubAddress: string
) => {
  const postData = {
    profileId: _profileId,
    contentURI: _contentURI,
    collectModule: _collectModuleAddress, //collect Module
    collectModuleInitData: "0x",
    referenceModule: "0x0000000000000000000000000000000000000000", // reference Module
    referenceModuleInitData: "0x",
  };

  const lensIface = new utils.Interface(lensHubAbi);

  return {
    to: _lensHubAddress,
    data: lensIface.encodeFunctionData("post", [postData]),
  };
};

const getLensData = async (
  _text: string,
  openAiKey: string,
  web3StorageKey: string
): Promise<
  { canExec: false; message: string } | { canExec: true; contentURI: string }
> => {
  try {
    const openai = new OpenAIApi(new Configuration({ apiKey: openAiKey }));
    const response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: ` ${_text} in less than 50 words.`,
      temperature: 1,
      max_tokens: 256,
      top_p: 1,
      frequency_penalty: 1.5,
      presence_penalty: 1,
    });
    const openAiText = response.data.choices[0].text as string;
    if (openAiText === undefined) {
      console.error(`Error: OpenAI: NO TEXT`);
      return { canExec: false, message: "Error: OpenAI: NO TEXT" };
    }
    console.log(`Text generated: ${openAiText}`);
  } catch (error) {
    console.error(`Error: OpenAI: ${error}`);
    return { canExec: false, message: "Error: OpenAI" };
  }

  // Get Lens Metadata and validate
  const pub = getLensPublicationMetaData(_text);
  const lensClient = new LensClient({
    environment: production,
  });

  try {
    const validateResult = await lensClient.publication.validateMetadata(pub);
    if (!validateResult.valid) {
      console.error(`Error: Metadata is not valid.`);
      return { canExec: false, message: "LensClient: Metadata invalid" };
    }
  } catch (error) {
    console.error(`Error: lensClient validateMetadata`);
    return {
      canExec: false,
      message: "Error: lensClient validateMetadata",
    };
  }

  // Upload metadata to IPFS
  const storage = new Web3Storage({ token: web3StorageKey });
  const myFile = new File([JSON.stringify(pub)], "publication.json");

  let cid: CIDString;
  try {
    cid = await storage.put([myFile]);
  } catch (error) {
    console.error(`Error: Web3Storage`);
    return {
      canExec: false,
      message: "Error: Web3Storage: validateMetadata",
    };
  }

  return {
    canExec: true,
    contentURI: `https://${cid}.ipfs.w3s.link/publication.json`,
  };
};

const getLensPublicationMetaData = (_text: string) => {
  return {
    version: "2.0.0",
    metadata_id: uuidv4(),
    content: `${_text} \n\n #lensgpt #gelatonetwork`,
    external_url: "https://lenster.xyz/",
    image: null,
    imageMimeType: null,
    name: "Post by GelatoGPT",
    tags: [],
    animation_url: null,
    mainContentFocus: PublicationMainFocus.TextOnly,
    contentWarning: null,
    attributes: [
      {
        traitType: "type",
        displayType: PublicationMetadataDisplayTypes.String,
        value: "text_only",
      },
    ],
    media: [],
    locale: "en-GB",
    appId: "Lenster",
  };
};
