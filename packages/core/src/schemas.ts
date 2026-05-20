import { z } from "zod";

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
  size: z.number(),
});
export type UploadedFileData = z.infer<typeof uploadedFileSchema>;

export const toUploadFileSchema = uploadedFileSchema.extend({
  uploadUrl: z.string(),
});
export type ToUploadFileData = z.infer<typeof toUploadFileSchema>;
