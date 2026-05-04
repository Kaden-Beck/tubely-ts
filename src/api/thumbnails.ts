import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

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

  const thumbnail: Thumbnail = {
    data: await thumbnailData.arrayBuffer(),
    mediaType: thumbnailData.type,
  };
  videoThumbnails.set(videoId, thumbnail);

  video.thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
