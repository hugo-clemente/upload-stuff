import type { AnyFileRoute } from "@upload-stuff/client";
import { createUploadStuffClient } from "@upload-stuff/client";

import { createUploadStuffReactHelpers } from "./index";

// A minimal fake router shaped like UploadStuffRouter, built from
// `AnyFileRoute` — the only route-shape type this package's `@upload-stuff/client`
// dependency re-exports — with the `$types.input` overridden per route. Same
// $types-override convention as core's router-types.test-d.ts and server's
// handler.test.ts fake routes, kept honest against the real `AnyFileRoute` shape
// (see packages/core/src/router-types.ts) instead of `any`-casting the router.
type FakeRoute<TInput> = Omit<AnyFileRoute, "$types"> & {
  $types: Omit<AnyFileRoute["$types"], "input"> & { input: TInput };
};

type FakeRouter = {
  image: FakeRoute<{ caption: string }>;
  document: FakeRoute<undefined>;
};

const client = createUploadStuffClient<FakeRouter>({ baseURL: "https://x.example" });
// NO generic here — this is the design promise under test: `TFileRouter` must
// be inferred from the `client` instance alone.
const { useUploadStuff } = createUploadStuffReactHelpers(client);

// inference gives the concrete router, so a misspelled route is a type error:
// @ts-expect-error unknown route name
useUploadStuff((r) => r.imge);

// and a correct route is accepted:
useUploadStuff((r) => r.image);

// startUpload input arity follows the route: required input must be passed…
// @ts-expect-error image requires an input
void useUploadStuff((r) => r.image).startUpload([new File([], "a.png")]);
// …and an input-free route takes none.
void useUploadStuff((r) => r.document).startUpload([new File([], "a.pdf")]);
