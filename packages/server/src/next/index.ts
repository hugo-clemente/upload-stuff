import type {
  FieldsDeclaration,
  UploadStuffRouterWithContext,
  ValidContextObject,
} from "@upload-stuff/core";
import type { UploadStuff } from "../upload-stuff";
import { type UploadStuffHTTPServerConfig, createHttpServer } from "./http-server";

export type { UploadStuffHTTPServerType } from "./http-server";

export const toNextJsHandler = <
  TContext extends ValidContextObject,
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
>({
  fileRouter,
  uploadStuff,
  config,
  createContext,
}: {
  fileRouter: UploadStuffRouterWithContext<TContext, TFileUsageContext>;
  uploadStuff: UploadStuff<TFileUsageContext, TFields>;
  config: Partial<UploadStuffHTTPServerConfig>;
  createContext: (opts: { headers: Headers }) => Promise<TContext>;
}) => {
  const app = createHttpServer({
    fileRouter,
    uploadStuff,
    config,
    createContext,
  });

  const handler = (req: Request) => app.fetch(req);

  return {
    GET: handler,
    POST: handler,
  };
};
