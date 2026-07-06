import { z } from "zod";

import type { Json } from "./utils/types";

export const initUploadFileSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
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
  files: z.array(initUploadFileSchema),
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
