/* eslint-disable @typescript-eslint/naming-convention */
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, BigNumber, utils } from "ethers";
import { Configuration, OpenAIApi } from "openai";

import { v4 as uuidv4 } from "uuid";
import { Web3Storage, File } from "web3.storage";

import { lensHubAbi } from "../../../helpers/lensHubAbi";
import {
  LensClient,
  PublicationMainFocus,
  PublicationMetadataDisplayTypes,
  development,
  production,
} from "@lens-protocol/client";
import { promptAbi } from "../../../helpers/promptAbi";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider, secrets, storage } = context;
  const provider = multiChainProvider.default();

  // User Secrets
  const WEB3_STORAGE_API_KEY = await secrets.get("WEB3_STORAGE_API_KEY");
  if (!WEB3_STORAGE_API_KEY)
    throw new Error("Missing secrets.WEB3_STORAGE_API_KEY");

  const SECRETS_OPEN_AI_API_KEY = await secrets.get("OPEN_AI_API_KEY");
  if (!SECRETS_OPEN_AI_API_KEY)
    throw new Error("Missing secrets.OPEN_AI_API_KEY");

  const lensGelatoGPTAddress = (userArgs.lensGelatoGPT as string) ?? "";
  const lensHubAddress = (userArgs.lensHubAddress as string) ?? "";
  const collectModuleAddress = (userArgs.collectModule as string) ?? "";

  const NUMBER_OF_POSTS_PER_RUN = 5;
  const INTERVAL_IN_MIN = 240;

  const lastPostTime = parseInt((await storage.get("lastPostTime")) ?? "0");

  const nextPromptIndex = parseInt(
    (await storage.get("nextPromptIndex")) ?? "0"
  );

  const network = await provider.getNetwork();
  const chainId = network.chainId;

  const iface = new utils.Interface(lensHubAbi);

  const lensGelatoGptAddress = lensGelatoGPTAddress;
  const lensGelatoGpt = new Contract(
    lensGelatoGptAddress,
    promptAbi,
    provider
  );

  const areThereNewProfileIds =
    (await lensGelatoGpt.areThereNewProfileIds()) as boolean;

  const callDatas: Array<{ to: string; data: string }> = [];
  const blockTime = (await provider.getBlock("latest")).timestamp;

  let prompts;

  const timeElapsed = blockTime - lastPostTime >= INTERVAL_IN_MIN * 60;
 

  if (!timeElapsed && nextPromptIndex == 0 && !areThereNewProfileIds) {
    return {
      canExec: false,
      message: "Not time elapsed since last post and not newcomers",
    };
  }


  /// First Post Available newcomers
  if (areThereNewProfileIds) {
    prompts = await lensGelatoGpt.getNewPrompts();

    let profileIds = [];

    let i = 0;
    for (const prompt of prompts) {
      i++
      profileIds.push(+prompt[0].toString());
      if (i==5) continue;
    }

    if (profileIds.length > 0) {
      callDatas.push({
        to: lensGelatoGPTAddress,
        data: lensGelatoGpt.interface.encodeFunctionData(
          "removeNewProfileIds",
          [profileIds]
        ),
      });
    }
  } else {
    prompts = await lensGelatoGpt.getPaginatedPrompts(
      nextPromptIndex,
      nextPromptIndex + NUMBER_OF_POSTS_PER_RUN
    );
  }

  for (const prompt of prompts) {
    
    let profileId = prompt[0].toString();
    let contentURI = prompt[1].toString();

   

    if (chainId == 31337) {
      // In hardhat test, skip ChatGPT call & IPFS publication
    } else {
      // Get Sentence OpenAi
      const openai = new OpenAIApi(
        new Configuration({ apiKey: SECRETS_OPEN_AI_API_KEY })
      );
      const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: ` ${contentURI} in less than 15 words.`,
        temperature: 1,
        max_tokens: 256,
        top_p: 1,
        frequency_penalty: 1.5,
        presence_penalty: 1,
      });
      let text = response.data.choices[0].text as string;

      if (text != undefined) {

        console.log(`Text generated: ${text}`);
        /// Build and validate Publication Metadata
        const uuid = uuidv4();
        const pub = {
          version: "2.0.0",
          metadata_id: uuid,
          content: text,
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

        // Checking Metadata is Correct
        const lensClient = new LensClient({
          environment: production,
        });
        const validateResult = await lensClient.publication.validateMetadata(
          pub
        );

        if (!validateResult.valid) {
          throw new Error(`Metadata is not valid.`);
        }

        // Upload metadata to IPFS
        const storage = new Web3Storage({ token: WEB3_STORAGE_API_KEY! });
        const myFile = new File([JSON.stringify(pub)], "publication.json");
        const cid = await storage.put([myFile]);
        contentURI = `https://${cid}.ipfs.w3s.link/publication.json`;

        console.log(`Publication IPFS: ${contentURI}`);
      } else {
        return { canExec: false, message: "No OpenAi text" };
      }
    }

    const postData = {
      profileId: profileId,
      contentURI: contentURI,
      collectModule: collectModuleAddress, //collect Module
      collectModuleInitData: "0x",
      referenceModule: "0x0000000000000000000000000000000000000000", // reference Module
      referenceModuleInitData: "0x",
    };

    callDatas.push({
      to: lensHubAddress,
      data: iface.encodeFunctionData("post", [postData]),
    });
  }



  const isFirstRun = nextPromptIndex == 0;
  const isLastRun = callDatas.length < NUMBER_OF_POSTS_PER_RUN;

  //only update pagination when not newcomers
  if (!areThereNewProfileIds) {
    if (callDatas.length == 0) {
      await storage.set("nextPromptIndex", "0");
      return { canExec: false, message: "Not Prompts to post" };
    }

    if (isFirstRun) {
      await storage.set("lastPostTime", blockTime.toString());
    }
    if (isLastRun) {
      await storage.set("nextPromptIndex", "0");
    } else {
      await storage.set("nextPromptIndex", (nextPromptIndex + NUMBER_OF_POSTS_PER_RUN).toString());
    }
  }
  return {
    canExec: true,
    callData: callDatas,
  };
});