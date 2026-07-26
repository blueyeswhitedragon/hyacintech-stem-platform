/**
 * 确定性单测：教师待审核列表的分页参数归一化 + 第 3 阶段 SQL 谓词等价性。
 * 运行: npx tsx scripts/test-review-pagination.ts
 *
 * 谓词部分把 stageData 字符串当字面量喂给 SQLite 求值（不读任何表、纯只读），
 * 用真正的 json_extract 逐形态比对改造前的内存过滤
 * `sd.stage3?.submitted === true && sd.stage3?.approved !== true`，
 * 确保「下推到 SQL」没有顺手改变语义。
 */
import { PrismaClient } from '@prisma/client';
import {
  normalizePageParams,
  clampToPage,
  toPage,
  REVIEW_PAGE_SIZE,
  PAGE_SIZE_MAX,
  STAGE3_PENDING_JSON_PREDICATE,
  STUCK_JSON_PREDICATE,
} from '../app/lib/pagination';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function main() {
console.log('normalizePageParams:');
check('无参数 → 第 1 页、默认页大小', (() => {
  const r = normalizePageParams();
  return r.page === 1 && r.pageSize === REVIEW_PAGE_SIZE && r.skip === 0;
})());
check('第 3 页 skip 正确', normalizePageParams({ page: 3 }).skip === 2 * REVIEW_PAGE_SIZE);
check('NaN 页码落回第 1 页', normalizePageParams({ page: Number('abc') }).page === 1);
check('0 页码落回第 1 页', normalizePageParams({ page: 0 }).page === 1);
check('负页码落回第 1 页', normalizePageParams({ page: -5 }).page === 1);
check('小数页码取整', normalizePageParams({ page: 2.9 }).page === 2);
check('自定义页大小生效', normalizePageParams({ pageSize: 5 }).pageSize === 5);
check('超大页大小被夹到上限', normalizePageParams({ pageSize: 100000 }).pageSize === PAGE_SIZE_MAX);
check('0 页大小落回默认', normalizePageParams({ pageSize: 0 }).pageSize === REVIEW_PAGE_SIZE);
check('负页大小落回默认', normalizePageParams({ pageSize: -1 }).pageSize === REVIEW_PAGE_SIZE);
check('NaN 页大小落回默认', normalizePageParams({ pageSize: Number('x') }).pageSize === REVIEW_PAGE_SIZE);

console.log('toPage:');
check('整除时页数正确', toPage([], 40, 1, 20).pageCount === 2);
check('有余数时向上取整', toPage([], 41, 1, 20).pageCount === 3);
check('空列表也算 1 页', toPage([], 0, 1, 20).pageCount === 1);
check('原样带回 page/pageSize/total', (() => {
  const p = toPage([1, 2], 41, 2, 20);
  return p.page === 2 && p.pageSize === 20 && p.total === 41 && p.items.length === 2;
})());

console.log('clampToPage:');
check('页码在范围内不动', (() => {
  const r = clampToPage(2, 20, 41);
  return r.page === 2 && r.pageCount === 3 && r.skip === 20;
})());
check('越界页码夹到最后一页', (() => {
  const r = clampToPage(999, 20, 41);
  return r.page === 3 && r.skip === 40;
})());
check('刚好等于最后一页不动', clampToPage(3, 20, 41).page === 3);
check('总数为 0 时夹到第 1 页、skip=0', (() => {
  const r = clampToPage(999, 20, 0);
  return r.page === 1 && r.pageCount === 1 && r.skip === 0;
})());
check('总数不足一页时任何页码都夹到第 1 页', clampToPage(7, 20, 3).page === 1);

console.log('stage3 谓词与旧内存过滤等价:');
const db = new PrismaClient();

/** 只做标量求值，不 SELECT 任何表；参数绑定，无写入。 */
async function evalPredicate(stageDataJson: string) {
  const rows = await db.$queryRawUnsafe<{ keep: number | bigint }[]>(
    `SELECT (${STAGE3_PENDING_JSON_PREDICATE}) AS keep`,
    stageDataJson,
    stageDataJson,
  );
  return Number(rows[0]?.keep ?? 0) === 1;
}

/** 改造前 getOptionalStage3Reviews 里的过滤条件，逐字保留作为基准。 */
function legacyFilter(stageDataJson: string) {
  const sd = JSON.parse(stageDataJson) as { stage3?: { submitted?: boolean; approved?: boolean | null } };
  return sd.stage3?.submitted === true && sd.stage3?.approved !== true;
}

const shapes: Array<[string, string]> = [
  ['无 stage3', '{}'],
  ['stage3 为空对象', '{"stage3":{}}'],
  ['已提交、无 approved', '{"stage3":{"submitted":true}}'],
  ['已提交、approved=null', '{"stage3":{"submitted":true,"approved":null}}'],
  ['已提交、approved=false', '{"stage3":{"submitted":true,"approved":false}}'],
  ['已提交、approved=true', '{"stage3":{"submitted":true,"approved":true}}'],
  ['未提交', '{"stage3":{"submitted":false}}'],
  ['未提交但已 approved', '{"stage3":{"submitted":false,"approved":true}}'],
  ['带其它阶段数据', '{"stage1":{"question":"x"},"stage3":{"submitted":true,"rows":[{"a":1}]}}'],
];

for (const [name, json] of shapes) {
  const sql = await evalPredicate(json);
  const js = legacyFilter(json);
  check(`${name}：SQL=${sql} JS=${js}`, sql === js);
}

// 反向哨兵：确认这个测试真的能发现差异（否则「全 OK」可能只是断言恒真）
check('哨兵：已 approved 的确被排除', (await evalPredicate('{"stage3":{"submitted":true,"approved":true}}')) === false);
check('哨兵：待过目的确被保留', (await evalPredicate('{"stage3":{"submitted":true}}')) === true);

console.log('stuck 谓词与内存过滤等价:');
async function evalStuck(stageDataJson: string, currentStage: number, threshold: number) {
  const rows = await db.$queryRawUnsafe<{ keep: number | bigint }[]>(
    `SELECT (${STUCK_JSON_PREDICATE}) AS keep`,
    stageDataJson,
    currentStage,
    threshold,
  );
  return Number(rows[0]?.keep ?? 0) === 1;
}
function memoryStuck(stageDataJson: string, currentStage: number, threshold: number) {
  const stageData = JSON.parse(stageDataJson) as { roundCounts?: Record<number, number> };
  return (stageData.roundCounts?.[currentStage] ?? 0) >= threshold;
}
const stuckShapes: Array<[string, string, number, number]> = [
  ['无 roundCounts', '{}', 2, 8],
  ['当前阶段不足阈值', '{"roundCounts":{"2":7}}', 2, 8],
  ['当前阶段等于阈值', '{"roundCounts":{"2":8}}', 2, 8],
  ['当前阶段超过阈值', '{"roundCounts":{"2":12}}', 2, 8],
  ['其他阶段轮数不计入', '{"roundCounts":{"1":18,"2":4}}', 2, 8],
  ['第一阶段达到阈值', '{"roundCounts":{"1":18,"2":4}}', 1, 8],
];
for (const [name, json, currentStage, threshold] of stuckShapes) {
  const sql = await evalStuck(json, currentStage, threshold);
  const js = memoryStuck(json, currentStage, threshold);
  check(`${name}：SQL=${sql} JS=${js}`, sql === js);
}
check('哨兵：达到阈值的当前阶段会入列', await evalStuck('{"roundCounts":{"2":8}}', 2, 8));
check('哨兵：同一数据换到其他阶段会被排除', !(await evalStuck('{"roundCounts":{"2":8}}', 1, 8)));

await db.$disconnect();

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
