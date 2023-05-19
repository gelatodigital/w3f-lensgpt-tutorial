/* eslint-disable @typescript-eslint/naming-convention */
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, BigNumber, utils } from "ethers";
import { Configuration, OpenAIApi } from "openai";

import { v4 as uuidv4 } from "uuid";
import { Web3Storage, File } from "web3.storage";

import { lens_hub_abi } from "../../../helpers/lens_hub_abi";
import {
  LensClient,
  PublicationMainFocus,
  PublicationMetadataDisplayTypes,
  development,
  production,
} from "@lens-protocol/client";
import { prompt_abi } from "../../../helpers/prompt_abi";

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

  
  const lastPostTime = parseInt((await storage.get("lastPostTime")) ?? "0");
  const firstNext = parseInt((await storage.get("firstNext")) ?? "0");

  const intervalInMin = 30;

  const network = await provider.getNetwork();
  const chainId = network.chainId;


  const iface = new utils.Interface(lens_hub_abi);

  const prompt_address = lensGelatoGPTAddress;
  const prompt = new Contract(prompt_address, prompt_abi, provider);

  const result = await prompt.getPaginatedPrompts(firstNext, firstNext + 10);

  const callDatas: Array<{ to: string; data: string }> = [];
  const blockTime = (await provider.getBlock("latest")).timestamp;

  if (blockTime - lastPostTime < intervalInMin * 60 && firstNext == 0) {
    return { canExec: false, message: "Not time elapsed since last post" };
  }

  for (const prompts of result) {
    let profileId = prompts[0].toString();
    let contentURI = prompts[1].toString();

    if (chainId == 31337) {
    } else {
  
      // Get Sentence OpenAi
      const openai = new OpenAIApi(
        new Configuration({ apiKey: SECRETS_OPEN_AI_API_KEY })
      );
      const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: ` ${contentURI} in 15 words`,
        temperature: 1,
        max_tokens: 30,
      });
      const text = response.data.choices[0].text;
      console.log(`Text generated: ${text}`);

      if (text != undefined) {
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
        const cid = await storage.put([myFile])
        contentURI = `https://${cid}.ipfs.w3s.link/publication.json`

        console.log(`Publication IPFS: ${contentURI}`)
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

  if (callDatas.length == 0) {
    await storage.set("firstNext", "0");
    return { canExec: false, message: "Not Prompts to post" };
  }
 


  if (firstNext == 0) {
    await storage.set("lastPostTime", blockTime.toString());
  }
  if (callDatas.length < 10) {
    await storage.set("firstNext", "0");
  } else {
    await storage.set("firstNext", (firstNext + 10).toString());
  }


  return {
    canExec: true,
    callData: callDatas,
  };
});
