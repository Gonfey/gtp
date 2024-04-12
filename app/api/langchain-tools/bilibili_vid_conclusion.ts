import { StructuredTool } from "@langchain/core/tools";
import { getRandomUserAgent } from "./ua_tools";
import { encWbi, getWbiKeys } from "./bili_wbi_tools";
import { z } from "zod";

export interface Headers {
  [key: string]: string;
}

export interface RequestTool {
  headers: Headers;
  maxOutputLength?: number;
  timeout: number;
}

export class BilibiliVideoConclusionTool
  extends StructuredTool
  implements RequestTool
{
  name = "bilibili_video_conclusion";

  maxOutputLength = Infinity;

  timeout = 90000;

  constructor(
    public headers: Headers = {},
    { maxOutputLength }: { maxOutputLength?: number } = {},
    { timeout }: { timeout?: number } = {},
  ) {
    super(...arguments);

    this.maxOutputLength = maxOutputLength ?? this.maxOutputLength;
    this.timeout = timeout ?? this.timeout;
  }

  schema = z.object({
    videoAid: z.string().describe("The AID of the video to be recognized"),
    pid: z.number().describe("The page ID of the video, starting from 1"),
  });

  /** @ignore */
  async _call({ videoAid, pid }: z.infer<typeof this.schema>) {
    try {
      var newVideoAid = videoAid.toString();
      // check if arguments are valid
      if (!(/^\d+$/.test(newVideoAid) || /^av\d+$/.test(newVideoAid))) {
        throw new Error(
          "Invalid videoAid: It should be a string of numbers. If a BVid or a short link is given, please convert it to Aid number using BiliVideoInfo tool.",
        );
      }

      if (newVideoAid.startsWith("av")) newVideoAid = newVideoAid.slice(2);

      let result = await this.fetchVideoInfo(+newVideoAid, +pid);
      // console.log(result)
      return result;
    } catch (error) {
      console.error(error);
      return (error as Error).toString();
    }
  }

  async fetchVideoInfo(aid: number, pid: number): Promise<string> {
    const headers = new Headers();
    headers.append("User-Agent", getRandomUserAgent());
    headers.append("Referer", "https://www.bilibili.com/video/av" + aid);
    headers.append("Origin", "https://www.bilibili.com");
    headers.append("Cookie", process.env.BILIBILI_COOKIES || "");

    const vidinfo_resp = await this.fetchWithTimeout(
      `https://api.bilibili.com/x/web-interface/view?aid=${aid}`,
      {
        headers: headers,
      },
    );

    const vidinfo = await vidinfo_resp.json();
    console.log("[BilibiliVideoConclusionTool]", vidinfo);
    const mid = vidinfo.data.owner.mid;
    const cid = vidinfo.data.pages[pid - 1].cid;

    // get https://api.bilibili.com/x/web-interface/view/conclusion/get?aid={aid}&cid={cid}&up_mid={mid}
    const { img_key, sub_key } = await getWbiKeys();
    var queryStr = encWbi(
      {
        aid: aid,
        cid: cid,
        up_mid: mid,
      },
      img_key,
      sub_key,
    );

    const resp = await this.fetchWithTimeout(
      `https://api.bilibili.com/x/web-interface/view/conclusion/get?${queryStr}`,
      {
        headers: headers,
      },
    );

    const data = await resp.json();
    console.log("[BilibiliVideoConclusionTool]", data);
    const model_result = data.data.model_result;
    switch (model_result.result_type) {
      case 0:
        return "BiliAPI returned result: Unable to provide a conclusion for this video, or the conclusion cannot be generated for this video due to the content (news, ad, ). Remember, this is a restriction by the Bilibili Services, not from the tool.";
      case 1:
        return model_result.summary;
      case 2:
        var resText =
          model_result.summary + "\n\nOutline (generated by BiliAPI): \n";

        for (var i = 0; i < model_result.outline.length; i++) {
          let ol = model_result.outline[i];
          resText += `## [position: ${ol.timestamp}s] ${ol.title}\n`;
          ol.part_outline.forEach((olpart: any) => {
            resText += `- [position: ${olpart.timestamp}s] ${olpart.content}`;
          });
        }
        return resText;
      default:
        return "BiliAPI returned unknown result type. Please report this issue to the developer.";
    }
  }

  async fetchWithTimeout(
    resource: RequestInfo | URL,
    options = {},
    timeout: number = 30000,
  ) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  }

  description = `A tool to fetch the conclusion of a Bilibili video. It uses the BiliAPI to fetch the conclusion of the video. As for input parameters, videoAid is the Aid of the video and pid is the page number of the video, starting from 1.`;
}
