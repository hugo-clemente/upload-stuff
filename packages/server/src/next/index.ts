import type {
  FieldsDeclaration,
  UploadStuffRouterWithContext,
  ValidContextObject,
} from "@upload-stuff/core";
import type { AnyUploadStuff, UploadStuff } from "../upload-stuff";
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
    // The internal server layer operates on the erased `AnyUploadStuff`. A
    // concrete instance is assignable to it, but TS can't prove that for the
    // abstract `TFields` inside this generic boundary — erase it explicitly here.
    uploadStuff: uploadStuff as AnyUploadStuff,
    config,
    createContext,
  });

  const handler = (req: Request) => app.fetch(req);

  return {
    GET: handler,
    POST: handler,
  };
};
