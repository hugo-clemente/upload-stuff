import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const userId = req.headers.get("x-user-id") ?? "anon";

  const files = await prisma.file.findMany({
    where: { userId, stored: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      caption: true,
      userId: true,
      contentType: true,
      publicUrl: true,
      createdAt: true,
    },
  });

  return Response.json({ files });
}
