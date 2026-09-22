import prisma from "../prisma.ts";

export async function createNotification(opts: {
  userId: string;
  title: string;
  body: string;
  link?: string;
}) {
  return prisma.notification.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      body: opts.body,
      link: opts.link ?? null,
    },
  });
}

export async function createNotifications(
  items: {
    userId: string;
    title: string;
    body: string;
    link?: string;
  }[]
) {
  if (items.length === 0) return;
  await prisma.notification.createMany({ data: items });
}