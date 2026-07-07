import { z } from "zod";

import { createUploadStuffRouter } from "@upload-stuff/server";

import { uploadStuff } from "./upload-stuff";

type Context = { userId: string };

const f = createUploadStuffRouter<Context, typeof uploadStuff>();

export const fileRouter = {
  image: f({
    isPublic: true,
    files: ["image/*"],
    maxFileSize: "8MB",
    maxFileCount: 1,
  })
    .input(z.object({ caption: z.string() }))
    // Persist the declared columns from the validated input and the ctx-derived
    // user id. userId is plain metadata (the gallery filters by it); it carries no
    // auth weight — completion is guarded by the batch token.
    .fields(({ input, ctx }) => ({ caption: input.caption, userId: ctx.userId }))
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      owner: middlewareData.userId,
      count: files.length,
    }))
    .build(),
  document: f({
    isPublic: false,
    files: {
      "image/*": { maxFileSize: "8MB", maxFileCount: 4 },
      "application/pdf": { maxFileSize: "16MB" },
    },
  })
    .fields(({ ctx }) => ({ userId: ctx.userId }))
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      owner: middlewareData.userId,
      count: files.length,
    }))
    .build(),
};

export type FileRouter = typeof fileRouter;
