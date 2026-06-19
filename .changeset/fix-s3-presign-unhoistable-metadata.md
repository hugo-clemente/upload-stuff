---
"@upload-stuff/server": patch
---

s3Adapter: keep object metadata (`x-amz-meta-*`) as signed request headers on presigned uploads instead of letting the AWS presigner hoist them into the query string. Hoisted metadata combined with the client's required-header replay caused S3/MinIO to reject the PUT ("headers present which were not signed").
