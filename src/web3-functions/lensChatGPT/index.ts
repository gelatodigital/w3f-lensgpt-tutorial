/* eslint-disable @typescript-eslint/naming-convention */
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, utils } from "ethers";
import { Configuration, OpenAIApi } from "openai";
import { v4 as uuidv4 } from "uuid";
import { Web3Storage, File } from "web3.storage";
import { lensHubAbi } from "../../../helpers/lensHubAbi";
import {
  LensClient,
  PublicationMainFocus,
  PublicationMetadataDisplayTypes,
  production,
} from "@lens-protocol/client";
import { promptAbi } from "../../../helpers/promptAbi";
import { LensGelatoGPT } from "../../../typechain";
import { PromptStruct } from "../../../typechain/LensGelatoGPT";

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

  const lensGelatoGpt = new Contract(
    lensGelatoGPTAddress,
    promptAbi,
    provider
  ) as LensGelatoGPT;

  const iface = new utils.Interface(lensHubAbi);

  const areThereNewProfileIds =
    (await lensGelatoGpt.areThereNewProfileIds()) as boolean;

  const callDatas: Array<{ to: string; data: string }> = [];

  const blockTime = (await provider.getBlock("latest")).timestamp;

  const timeElapsed = blockTime - lastPostTime >= INTERVAL_IN_MIN * 60;

  if (!timeElapsed && nextPromptIndex == 0 && !areThereNewProfileIds) {
    return {
      canExec: false,
      message: "Not time elapsed since last post and not newcomers",
    };
  }

  let prompts: PromptStruct[] = [];

  /// First Post Available newcomers
  if (areThereNewProfileIds) {
    prompts = await lensGelatoGpt.getNewPrompts();

    prompts = prompts.slice(0, NUMBER_OF_POSTS_PER_RUN);

    const profileIds = prompts.map((map) => map.profileId);

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

  const promptsCleaned = prompts.filter(
    (fil: PromptStruct) => fil.profileId.toString() != "0"
  ) as Array<PromptStruct>;

  for (const prompt of promptsCleaned) {
    const profileId = prompt.profileId;
    let contentURI = prompt.prompt;

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
      const text = response.data.choices[0].text as string;

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
      const getTotalNumberOfProfiles = +(
        await lensGelatoGpt.getTotalNumberOfProfiles()
      ).toString();

      if (
        nextPromptIndex + NUMBER_OF_POSTS_PER_RUN <
        getTotalNumberOfProfiles
      ) {
        await storage.set(
          "nextPromptIndex",
          (nextPromptIndex + NUMBER_OF_POSTS_PER_RUN).toString()
        );
        return { canExec: false, message: "Skipping empty Profiles" };
      }

      await storage.set("nextPromptIndex", "0");
      return { canExec: false, message: "Not Prompts to post" };
    }

    if (isFirstRun) {
      await storage.set("lastPostTime", blockTime.toString());
    }
    if (isLastRun) {
      await storage.set("nextPromptIndex", "0");
    } else {
      await storage.set(
        "nextPromptIndex",
        (nextPromptIndex + NUMBER_OF_POSTS_PER_RUN).toString()
      );
    }
  }
  return {
    canExec: true,
    callData: callDatas,
  };
});
