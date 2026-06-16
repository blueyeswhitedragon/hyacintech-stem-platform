import type { PrismaClient } from '@prisma/client';

// 不含易混字符（0/O、1/I）的字符集
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成一个 6 位班级邀请码（不保证唯一）。 */
export function randomInviteCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * 生成一个在数据库中唯一的邀请码（碰撞则重试）。
 * 接受 PrismaClient（或带 class.findUnique 的等价对象），供 seed 与 API 共用。
 */
export async function generateUniqueInviteCode(
  db: Pick<PrismaClient, 'class'>,
  maxAttempts = 10
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomInviteCode();
    const existing = await db.class.findUnique({ where: { inviteCode: code } });
    if (!existing) return code;
  }
  throw new Error('无法生成唯一邀请码，请重试');
}
