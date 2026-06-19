import { toNextJsHandler } from "@upload-stuff/server/next";

import { uploadStuff } from "@/lib/upload-stuff";
import { fileRouter } from "@/lib/file-router";

export const { GET, POST } = toNextJsHandler({
  uploadStuff,
  fileRouter,
  config: {},
  // No real auth: derive the user id straight from a request header.
  createContext: async ({ headers }) => ({
    userId: headers.get("x-user-id") ?? "anon",
  }),
});
