/**
 * 列表分页的纯逻辑与 SQL 片段。
 *
 * 单独成文件（而不是放在 queries.ts）是为了可测：queries.ts 带 `server-only`，
 * 用 tsx 跑的单测无法 import。这里不碰 db，只做参数归一化和拼片段。
 */

/** 页码从 1 开始。 */
export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** 至少为 1：空列表也算「第 1 / 1 页」，免得 UI 显示「第 1 / 0 页」。 */
  pageCount: number;
}

export const REVIEW_PAGE_SIZE = 20;
/** 硬上限，避免调用方传 pageSize=100000 把「加了分页」重新变回「一次全量」。 */
export const PAGE_SIZE_MAX = 100;

/**
 * 把不可信的 page/pageSize（URL 查询串、API 查询参数）夹到合法区间。
 * NaN / 0 / 负数 / 小数 / undefined 一律落回默认值，调用方不必自己校验。
 */
export function normalizePageParams({ page, pageSize }: PageParams = {}) {
  const rawSize = Math.trunc(Number(pageSize));
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(PAGE_SIZE_MAX, rawSize) : REVIEW_PAGE_SIZE;
  const rawPage = Math.trunc(Number(page));
  const p = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { page: p, pageSize: size, skip: (p - 1) * size };
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * 已知总数后把页码夹回真实范围，并给出对应的 skip。
 *
 * 必要性：URL 里的 `?p=999` 若原样执行，返回的是空列表——而列表为空时页面通常渲染空态、
 * 不渲染翻页条，教师就卡在一个「看起来没有待审」且回不去的页面上。夹到最后一页既避免这个
 * 死角，也免掉一次毫无意义的大 OFFSET 扫描。
 */
export function clampToPage(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pageCount);
  return { page: clamped, pageCount, skip: (clamped - 1) * pageSize };
}

/**
 * 「第 3 阶段数据表待过目」的谓词。参数顺序：teacherId。
 *
 * stage3.submitted / stage3.approved 只存在于 Conversation.stageData 这个 JSON 字符串里，
 * Prisma 的 where 表达不了。原实现是「取回全部候选再在内存 filter」，那样分页没有意义——
 * 无论要第几页都得先把所有候选连同 stageData 读进进程。这里用 SQLite 的 json_extract 下推。
 *
 * json_extract 对 JSON 布尔返回 0/1，字段缺失返回 NULL：
 *   - `IS 1` 顺带挡掉 NULL，等价于 `submitted === true`；
 *   - approved 只有严格为 true 才算已过目，null / false / 缺失都要留下，故先 coalesce 成 0 再比。
 * 与旧的内存过滤逐形态等价，由 scripts/test-review-pagination.ts 固定。
 */
export const STAGE3_PENDING_FROM_WHERE = `
  FROM StudentAssignment sa
  JOIN Assignment a ON a.id = sa.assignmentId
  JOIN Class c ON c.id = a.classId
  JOIN Conversation cv ON cv.id = sa.conversationId
  WHERE sa.status = 'IN_PROGRESS'
    AND sa.currentStage IN (3, 4)
    AND c.teacherId = ?
    AND json_extract(cv.stageData, '$.stage3.submitted') IS 1
    AND coalesce(json_extract(cv.stageData, '$.stage3.approved'), 0) IS NOT 1`;

/** 上面 JSON 谓词的独立形式，供单测直接喂 stageData 字符串比对。 */
export const STAGE3_PENDING_JSON_PREDICATE = `
  json_extract(?, '$.stage3.submitted') IS 1
  AND coalesce(json_extract(?, '$.stage3.approved'), 0) IS NOT 1`;

/**
 * 「可能卡住」列表的 FROM/WHERE。参数顺序：teacherId、最少对话轮数。
 * roundCounts 的键是当前阶段号，SQLite JSON path 在这里按行动态拼接。
 */
export const STUCK_FROM_WHERE = `
  FROM StudentAssignment sa
  JOIN Assignment a ON a.id = sa.assignmentId
  JOIN Class c ON c.id = a.classId
  JOIN Conversation cv ON cv.id = sa.conversationId
  WHERE sa.status = 'IN_PROGRESS'
    AND c.teacherId = ?
    AND coalesce(json_extract(cv.stageData, '$.roundCounts.' || sa.currentStage), 0) >= ?`;

/** 独立 JSON 谓词，供单测逐形态对照内存过滤。参数：stageData、currentStage、threshold。 */
export const STUCK_JSON_PREDICATE = `
  coalesce(json_extract(?, '$.roundCounts.' || ?), 0) >= ?`;
