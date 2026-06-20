/**
 * 纯函数：把 LLM 产出的数据表 schema 规整为可控、整洁的结构。
 * 即使模型给的列略乱，落库前也被规整，避免第三阶段表格排版混乱。
 *
 * 规则：
 *  - key 统一 snake_case、去重（重复追加 _2/_3…）
 *  - 标题为空的列剔除
 *  - type 仅允许 text/number/image，非法降级为 text
 *  - 必须存在 notes 文本列（缺则补）
 *  - minRows 至少 3；maxRows 固定 200
 */
import type { Stage2Column } from '@/app/models/stageData';

interface RawColumn {
  key?: unknown;
  title?: unknown;
  type?: unknown;
  required?: unknown;
}
interface RawSchema {
  columns?: RawColumn[];
  minRows?: unknown;
  maxRows?: unknown;
}

function toSnakeKey(raw: string, idx: number): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || `col_${idx + 1}`;
}

export interface NormalizedSchema {
  columns: Stage2Column[];
  minRows: number;
  maxRows: number;
}

export function normalizeSchema(input: RawSchema | undefined | null): NormalizedSchema {
  const rawCols = Array.isArray(input?.columns) ? (input!.columns as RawColumn[]) : [];
  const seen = new Set<string>();
  const columns: Stage2Column[] = [];

  rawCols.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!title) return; // 标题空 → 剔除

    const base = toSnakeKey(typeof c.key === 'string' ? c.key : '', i);
    let key = base;
    let n = 2;
    while (seen.has(key)) key = `${base}_${n++}`;
    seen.add(key);

    const type: Stage2Column['type'] =
      c.type === 'number' || c.type === 'image' ? c.type : 'text';
    const required = typeof c.required === 'boolean' ? c.required : type !== 'image';

    columns.push({ key, title, type, required });
  });

  // 必须有 notes 文本列
  if (!columns.some((c) => c.key === 'notes')) {
    columns.push({ key: 'notes', title: '备注', type: 'text', required: false });
  }

  const rawMin = typeof input?.minRows === 'number' && Number.isFinite(input.minRows) ? Math.floor(input.minRows) : 3;
  const minRows = Math.max(3, rawMin);
  const maxRows = 200;

  return { columns, minRows, maxRows };
}
