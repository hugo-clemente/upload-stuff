import type { FieldsDeclaration, ValidContextObject } from "@upload-stuff/core";
import { toFetchHandler, type CreateUploadStuffHandlerOptions } from "../fetch-handler";

/**
 * Next.js App Router adapter. Returns `{ GET, POST }` route handlers to
 * re-export from `app/api/upload-stuff/[[...slug]]/route.ts`.
 *
 * @example
 * export const { GET, POST } = toNextJsHandler({ fileRouter, uploadStuff, createContext });
 */
export const toNextJsHandler = <
  TContext extends ValidContextObject,
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  options: CreateUploadStuffHandlerOptions<TContext, TFields>,
) => {
  const handler = toFetchHandler(options);

  return {
    GET: handler,
    POST: handler,
  };
};
