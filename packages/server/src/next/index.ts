import type { FieldsDeclaration, ValidContextObject } from "@upload-stuff/core";
import { toFetchHandler, type CreateUploadStuffHandlerOptions } from "../fetch-handler";

export const toNextJsHandler = <
  TContext extends ValidContextObject,
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  options: CreateUploadStuffHandlerOptions<TContext, TFileUsageContext, TFields>,
) => {
  const handler = toFetchHandler(options);

  return {
    GET: handler,
    POST: handler,
  };
};
