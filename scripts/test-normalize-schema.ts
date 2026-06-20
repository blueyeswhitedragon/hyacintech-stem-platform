/**
 * 确定性单测：normalizeSchema 表格规整（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-normalize-schema.ts
 */
import { normalizeSchema } from '../app/lib/schemaNormalize';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('normalizeSchema:');

// 1. key 规整为 snake_case
{
  const r = normalizeSchema({ columns: [{ key: 'Day Count', title: '天数', type: 'number', required: true }], minRows: 5, maxRows: 999 });
  check('key→snake_case', r.columns[0].key === 'day_count');
  check('minRows 保留(>=3)', r.minRows === 5);
  check('maxRows 固定200', r.maxRows === 200);
}

// 2. 重复 key 去重
{
  const r = normalizeSchema({ columns: [
    { key: 'g', title: 'A', type: 'number', required: true },
    { key: 'g', title: 'B', type: 'number', required: true },
  ] });
  const keys = r.columns.map((c) => c.key);
  check('重复 key 去重', keys[0] === 'g' && keys[1] === 'g_2');
}

// 3. 标题为空的列被剔除
{
  const r = normalizeSchema({ columns: [
    { key: 'a', title: '有效', type: 'number', required: true },
    { key: 'b', title: '   ', type: 'number', required: true },
  ] });
  check('空标题列剔除', !r.columns.some((c) => c.key === 'b'));
}

// 4. 非法 type 降级为 text
{
  const r = normalizeSchema({ columns: [{ key: 'x', title: 'X', type: 'weird' as never, required: true }] });
  check('非法 type 降级 text', r.columns.find((c) => c.key === 'x')?.type === 'text');
}

// 5. 自动补 notes 列
{
  const r = normalizeSchema({ columns: [{ key: 'a', title: 'A', type: 'number', required: true }] });
  const notes = r.columns.find((c) => c.key === 'notes');
  check('自动补 notes 列', !!notes && notes.type === 'text' && notes.required === false);
}

// 6. 已有 notes 列不重复补
{
  const r = normalizeSchema({ columns: [{ key: 'notes', title: '备注', type: 'text', required: false }] });
  check('已有 notes 不重复', r.columns.filter((c) => c.key === 'notes').length === 1);
}

// 7. minRows 下限 3
{
  const r = normalizeSchema({ columns: [{ key: 'a', title: 'A', type: 'number', required: true }], minRows: 1, maxRows: 200 });
  check('minRows 下限3', r.minRows === 3);
}

// 8. 中文 key → 兜底 col_N（无法 snake_case）
{
  const r = normalizeSchema({ columns: [{ key: '天数', title: '天数', type: 'number', required: true }] });
  check('中文 key 兜底 col_1', r.columns[0].key === 'col_1');
}

// 9. 缺省 required：image 列默认 false，其它默认 true
{
  const r = normalizeSchema({ columns: [
    { key: 'img', title: '照片', type: 'image' },
    { key: 'num', title: '数值', type: 'number' },
  ] });
  check('image 默认非必填', r.columns.find((c) => c.key === 'img')?.required === false);
  check('number 默认必填', r.columns.find((c) => c.key === 'num')?.required === true);
}

// 10. 脏输入（undefined）也不崩
{
  const r = normalizeSchema(undefined);
  check('undefined 输入兜底', Array.isArray(r.columns) && r.columns.some((c) => c.key === 'notes') && r.minRows === 3);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
