import { randomBytes } from "node:crypto";
import { type BunRequest, type S3File } from "bun";
import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";

const MAX_VIDEO_SIZE = 1 << 30; // 1 GB

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const ffProbeArgs: string[] = [
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ];

  const proc = Bun.spawn(ffProbeArgs, { stderr: "pipe", stdout: "pipe" });

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  if ((await proc.exited) !== 0) {
    throw new BadRequestError(`Error getting video info: ${stderrText}`);
  }

  const { streams } = JSON.parse(stdoutText) as {
    streams: { width: number; height: number }[];
  };
  const { width, height } = streams[0];

  if (Math.floor((width * 9) / height) === 16) return "landscape";
  // if (Math.round((height * 9) / width) === 16)
  return "portrait";
}

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { s3Client } = cfg;
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video metadata not found with provided ID");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Video is now owned by current user");
  }

  console.log("uploading video", videoId, "by user", userID);

  const formData = await req.formData();
  const videoData = formData.get("video");
  if (!(videoData instanceof File)) {
    throw new BadRequestError("Video form data not found on request");
  }
  if (videoData.type !== "video/mp4") {
    throw new BadRequestError("Only mp4 files are accepted.");
  }
  if (videoData.size > MAX_VIDEO_SIZE) {
    throw new BadRequestError("Video exceed file size of 1 GB");
  }

  await Bun.write("temp_videoData.txt", videoData);

  const ratio = await getVideoAspectRatio("temp_videoData.txt");
  const bucketKey = `${ratio}/${randomBytes(32).toString("base64url")}.mp4`;

  const s3File = s3Client.file(bucketKey);
  await s3File.write(Bun.file("temp_videoData.txt"), {
    type: "video/mp4",
  });

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${bucketKey}`;
  updateVideo(cfg.db, video);
  console.log(`Finished uploading ${videoId} at ${video.videoURL}`);
  await Bun.file("temp_videoData.txt").delete();
  return respondWithJSON(200, null);
}
