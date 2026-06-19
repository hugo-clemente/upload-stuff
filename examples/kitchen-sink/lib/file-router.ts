import { z } from "zod";

import { createUploadStuffRouter } from "@upload-stuff/server";

import { uploadStuff } from "./upload-stuff";

type Context = { userId: string };

const f = createUploadStuffRouter<Context, typeof uploadStuff>();

export const fileRouter = {
  image: f({
    isPublic: true,
    type: "image",
    usageContext: "image",
    maxFileSize: "8MB",
    maxFileCount: 1,
  })
    .input(z.object({ caption: z.string() }))
    // Ownership: only the same user can finalize their own in-flight batch.
    .scope(({ ctx }) => ctx.userId)
    // Persist the declared `caption` column from the validated input.
    .fields(({ input }) => ({ caption: input.caption }))
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      owner: middlewareData.userId,
      count: files.length,
    }))
    .build(),
};

export type FileRouter = typeof fileRouter;
