---
"@upload-stuff/server": minor
---

Make the S3 adapter's AWS SDK an optional peer dependency.

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` moved from `dependencies` to optional `peerDependencies` (`>=3.700.0`), mirroring the existing Prisma setup. Projects that don't use the S3 adapter no longer install the AWS SDK. Also adds `"sideEffects": false` for better tree-shaking in webpack-based consumers.

**Breaking:** consumers using `@upload-stuff/server/adapters/s3` must now add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to their own dependencies.
