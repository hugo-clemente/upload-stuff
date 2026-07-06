import { z } from "zod";

import type { Json } from "./utils/types";

export const initUploadFileSchema = z.object({
  // Bounded so a crafted request can't force unbounded allocation before the per-route
  // count/size checks run; the size gate also relies on this being a real byte count.
  filename: z.string().max(1024),
  contentType: z.string().max(255),
  size: z.number().int().nonnegative(),
});
export type InitUploadFileData = z.infer<typeof initUploadFileSchema>;

export const uploadedFileSchema = initUploadFileSchema.extend({
  id: z.string(),
  key: z.string(),
  publicUrl: z.string().optional(),
});
export type UploadedFileData = z.infer<typeof uploadedFileSchema>;

export const toUploadFileSchema = uploadedFileSchema.extend({
  uploadUrl: z.string(),
  /**
   * Headers the client must replay on the PUT for the signature to match (e.g.
   * signed `x-amz-meta-*` when the route resolves object metadata). Omitted when
   * the presigned upload requires no extra headers beyond `Content-Type`.
   */
  uploadHeaders: z.record(z.string(), z.string()).optional(),
});
export type ToUploadFileData = z.infer<typeof toUploadFileSchema>;

/** Request body for `POST /:endpoint/init-upload`. */
export const initUploadRequestSchema = z.object({
  // Hard ceiling well above any realistic per-route `maxFileCount`; the route's own cap
  // still enforces the real limit in validateFiles. This rejects an abusive array at the
  // boundary before it's fully materialized and normalized.
  files: z.array(initUploadFileSchema).max(1000),
  input: z.json(),
});
export type InitUploadRequest = {
  files: InitUploadFileData[];
  input: Json;
};

/** Request body for `POST /:endpoint/complete-upload`. */
export const completeUploadRequestSchema = z.object({
  batchToken: z.string(),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

/** Error envelope returned for every handled (4xx) error. */
export const uploadStuffErrorResponseSchema = z.object({
  error: z.string(),
});
export type UploadStuffErrorResponse = z.infer<typeof uploadStuffErrorResponseSchema>;
