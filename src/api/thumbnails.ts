import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const thumbnailData = formData.get("thumbnail");
  if (!(thumbnailData instanceof File)) {
    throw new BadRequestError("Thumbnail form data not found on request");
  }
  if (
    thumbnailData.type !== "image/jpeg" &&
    thumbnailData.type !== "image/png"
  ) {
    throw new BadRequestError("Only jpeg or png accepted.");
  }
  if (thumbnailData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file size was over 10 MB");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("No video with that I was found");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Video does not match the authenticated user");
  }

  const arrayBuffer = await thumbnailData.arrayBuffer();
  const id = randomBytes(32).toString("base64url");
  const filePath = path.join(cfg.assetsRoot, id);

  await Bun.write(filePath, arrayBuffer);

  video.thumbnailURL = `http://localhost:${cfg.port}/assets/${id}`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}
