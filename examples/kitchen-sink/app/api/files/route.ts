import { prisma } from "@/lib/prisma";

// List the current user's stored files. Scope = the x-user-id header, mirroring
// the upload route's createContext, so the gallery is owner-scoped end to end.
export async function GET(req: Request) {
  const userId = req.headers.get("x-user-id") ?? "anon";

  const files = await prisma.file.findMany({
    where: { scope: userId, stored: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      caption: true,
      scope: true,
      contentType: true,
      publicUrl: true,
      createdAt: true,
    },
  });

  return Response.json({ files });
}
