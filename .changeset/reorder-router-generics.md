---
"@upload-stuff/server": minor
---

BREAKING: `createUploadStuffRouter` swaps its type parameter order to
`<TUploadStuff, TContext>` and defaults `TContext` to an empty object.

`TUploadStuff` can't be inferred (the factory takes no runtime args), so it must
be written explicitly. Moving it first lets `TContext` be optional when a route
doesn't read from `ctx`.

Migration: `createUploadStuffRouter<Context, typeof uploadStuff>()` becomes
`createUploadStuffRouter<typeof uploadStuff, Context>()`. Routes with no context
can drop the second argument: `createUploadStuffRouter<typeof uploadStuff>()`.
