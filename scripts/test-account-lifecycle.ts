#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';
import {
  createDataLabUser,
  deleteUnusedDataLabUser,
  listDataLabUsers,
  resetDataLabUserPassword,
  setDataLabUserActive,
  updateDataLabUser,
} from '../app/lib/dataLab/service';
import type { SessionUser } from '../app/lib/session';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function sessionUser(user: { id: string; username: string; displayName: string; role: string }): SessionUser {
  return { ...user, role: user.role as SessionUser['role'] };
}

async function main() {
  const [adminRow, sample] = await Promise.all([
    db.user.findFirstOrThrow({ where: { role: 'admin', isActive: true } }),
    db.datasetSample.findFirstOrThrow(),
  ]);
  const admin = sessionUser(adminRow);
  const suffix = randomUUID().slice(0, 8);
  const created = await createDataLabUser({
    username: `account-test-${suffix}`,
    displayName: '临时账户',
    role: 'annotator',
    passwordHash: await bcrypt.hash('temporary123', 4),
    actor: admin,
  });
  const auditIds = [created.id];
  let campaignId: string | null = null;
  try {
    const updated = await updateDataLabUser({ targetUserId: created.id, username: `account-edited-${suffix}`, displayName: '已编辑账户', role: 'annotator', actor: admin });
    check('管理员可以修改用户名和显示名称', updated.username.startsWith('account-edited-') && updated.displayName === '已编辑账户');

    const campaign = await db.annotationCampaign.create({ data: { name: `account-campaign-${suffix}`, status: 'ACTIVE', selectionJson: '{}', styleQuotaJson: '{}', createdById: admin.id } });
    campaignId = campaign.id;
    await db.annotationTask.create({ data: { campaignId: campaign.id, sampleId: sample.id, slot: 1, status: 'IN_PROGRESS', assignedToId: created.id, leaseExpiresAt: new Date(Date.now() + 60_000) } });
    let roleBlocked = false;
    try { await updateDataLabUser({ targetUserId: created.id, username: updated.username, displayName: updated.displayName, role: 'reviewer', actor: admin }); } catch { roleBlocked = true; }
    check('有进行中任务时禁止修改身份', roleBlocked);
    let disableBlocked = false;
    try { await setDataLabUserActive({ targetUserId: created.id, isActive: false, actor: admin }); } catch { disableBlocked = true; }
    check('有进行中任务时禁止停用', disableBlocked);
    let deleteBlocked = false;
    try { await deleteUnusedDataLabUser(created.id, admin); } catch { deleteBlocked = true; }
    check('有业务关联时禁止永久删除', deleteBlocked);

    await db.annotationCampaign.delete({ where: { id: campaign.id } });
    campaignId = null;
    const reviewer = await updateDataLabUser({ targetUserId: created.id, username: updated.username, displayName: updated.displayName, role: 'reviewer', actor: admin });
    check('任务清理后可以修改身份', reviewer.role === 'reviewer');

    const beforeReset = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    await resetDataLabUserPassword({ targetUserId: created.id, passwordHash: await bcrypt.hash('new-password-123', 4), actor: admin });
    const afterReset = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    check('重置密码会让旧登录版本失效', afterReset.sessionVersion === beforeReset.sessionVersion + 1);

    await setDataLabUserActive({ targetUserId: created.id, isActive: false, reason: '自动测试', actor: admin });
    const disabled = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    check('停用状态和原因被保留', !disabled.isActive && disabled.disabledReason === '自动测试');
    await setDataLabUserActive({ targetUserId: created.id, isActive: true, actor: admin });
    const enabled = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    check('账户可以重新启用且旧会话仍失效', enabled.isActive && enabled.sessionVersion > afterReset.sessionVersion);

    const listed = (await listDataLabUsers()).find((item) => item.id === created.id);
    check('零历史账户允许永久删除', listed?.canDelete === true);
    await deleteUnusedDataLabUser(created.id, admin);
    check('永久删除后账户不存在', await db.user.findUnique({ where: { id: created.id } }) === null);

    let selfDisableBlocked = false;
    try { await setDataLabUserActive({ targetUserId: admin.id, isActive: false, actor: admin }); } catch { selfDisableBlocked = true; }
    check('管理员不能停用自己', selfDisableBlocked);
  } finally {
    if (campaignId) await db.annotationCampaign.deleteMany({ where: { id: campaignId } });
    await db.user.deleteMany({ where: { id: created.id } });
    await db.dataLabAuditLog.deleteMany({ where: { entityType: 'User', entityId: { in: auditIds } } });
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => db.$disconnect());
