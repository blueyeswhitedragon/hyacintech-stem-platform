import type { Stage2Data, Stage3FileAssociation } from '@/app/models/stageData';

export interface Stage3RowsValidation {
  ok: boolean;
  error?: string;
  rows?: Record<string, unknown>[];
  fileAssociations?: Stage3FileAssociation[];
}

export function validateStage3Rows(
  rows: unknown,
  fileAssociations: unknown,
  schema: Stage2Data['schema'],
): Stage3RowsValidation {
  if (!Array.isArray(rows)) return { ok: false, error: 'rows 必须为数组' };
  if (rows.length > schema.maxRows) return { ok: false, error: `数据行不能超过 ${schema.maxRows} 行` };
  const columns = new Map(schema.columns.map((column) => [column.key, column]));
  const normalizedRows: Record<string, unknown>[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `第 ${rowIndex + 1} 行格式无效` };
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      const column = columns.get(key);
      if (!column) return { ok: false, error: `第 ${rowIndex + 1} 行包含方案外字段「${key}」` };
      if (value === '' || value === null || value === undefined) {
        normalized[key] = '';
        continue;
      }
      if (column.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return { ok: false, error: `第 ${rowIndex + 1} 行「${column.title}」必须是有限数值` };
        }
      } else if (typeof value !== 'string') {
        return { ok: false, error: `第 ${rowIndex + 1} 行「${column.title}」必须是文本` };
      } else if (value.length > 5000) {
        return { ok: false, error: `第 ${rowIndex + 1} 行「${column.title}」内容过长` };
      } else if (column.type === 'image' && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(value)) {
        return { ok: false, error: `第 ${rowIndex + 1} 行「${column.title}」图片地址无效` };
      }
      normalized[key] = value;
    }
    normalizedRows.push(normalized);
  }

  const associations = fileAssociations === undefined ? [] : fileAssociations;
  if (!Array.isArray(associations)) return { ok: false, error: 'fileAssociations 必须为数组' };
  const normalizedAssociations: Stage3FileAssociation[] = [];
  for (const association of associations) {
    if (!association || typeof association !== 'object') return { ok: false, error: '图片关联格式无效' };
    const value = association as Partial<Stage3FileAssociation>;
    const column = typeof value.colKey === 'string' ? columns.get(value.colKey) : undefined;
    if (
      !Number.isInteger(value.rowIndex) || Number(value.rowIndex) < 0 || Number(value.rowIndex) >= normalizedRows.length
      || !column || column.type !== 'image'
      || typeof value.fileUrl !== 'string' || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(value.fileUrl)
    ) {
      return { ok: false, error: '图片关联与冻结的数据表结构不一致' };
    }
    if (normalizedRows[Number(value.rowIndex)][value.colKey!] !== value.fileUrl) {
      return { ok: false, error: '图片关联地址与对应单元格不一致' };
    }
    normalizedAssociations.push({ rowIndex: Number(value.rowIndex), colKey: value.colKey!, fileUrl: value.fileUrl });
  }

  return { ok: true, rows: normalizedRows, fileAssociations: normalizedAssociations };
}
