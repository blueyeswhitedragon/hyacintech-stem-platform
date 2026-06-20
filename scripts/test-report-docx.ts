/**
 * 确定性单测：buildReportDocx 生成合法 .docx，且含各节文字与数据表。
 * 运行: npx tsx scripts/test-report-docx.ts
 * 产物写到 /tmp 供 python-docx 二次校验（见 test 运行脚本）。
 */
import { writeFileSync } from 'fs';
import { buildReportDocx } from '../app/lib/reportDocx';
import { unzip } from '../app/lib/zip';
import type { Stage5Sections, Stage2Column } from '../app/models/stageData';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const sections: Stage5Sections = {
  purpose: '研究不同光照时长对绿豆发芽的影响',
  hypothesis: '光照适中发芽率最高',
  materials: '绿豆、培养皿、台灯',
  procedure: '分组培养\n每日记录',
  dataSummary: '8h 组发芽最多',
  analysis: '随光照增加先升后降',
  conclusion: '适度光照最有利发芽',
  reflection: '样本量偏小，可增加重复组',
};
const columns: Stage2Column[] = [
  { key: 'day', title: '天数', type: 'number', required: true },
  { key: 'g8', title: '8h组发芽数', type: 'number', required: true },
  { key: 'notes', title: '备注', type: 'text', required: false },
];
const rows = [
  { day: 1, g8: 0, notes: '浸种' },
  { day: 2, g8: 3, notes: '' },
  { day: 3, g8: 7, notes: '长势好' },
];

console.log('buildReportDocx:');

const buf = buildReportDocx({ title: '绿豆发芽探究报告', sections, schemaColumns: columns, dataRows: rows });
check('返回非空 Buffer', Buffer.isBuffer(buf) && buf.length > 0);
check('以 ZIP 魔数 PK 开头', buf[0] === 0x50 && buf[1] === 0x4b);

// 自解压校验内部结构
const files = unzip(buf);
check('含 [Content_Types].xml', files.has('[Content_Types].xml'));
check('含 _rels/.rels', files.has('_rels/.rels'));
check('含 word/document.xml', files.has('word/document.xml'));

const docXml = files.get('word/document.xml')!.toString('utf8');
check('含研究目的标题', docXml.includes('研究目的'));
check('含结论正文', docXml.includes('适度光照最有利发芽'));
check('含数据表表头', docXml.includes('8h组发芽数'));
check('含数据表单元格(7)', docXml.includes('>7<') || docXml.includes('7</w:t>'));
check('含 w:tbl 表格元素', docXml.includes('<w:tbl>'));
check('含 w:tblGrid（严格解析器要求）', docXml.includes('<w:tblGrid>'));
check('gridCol 数=列数+1', (docXml.match(/<w:gridCol /g) || []).length === columns.length + 1);
check('换行转为 w:br', docXml.includes('<w:br/>'));

// XML 转义正确性
const sec2: Stage5Sections = { ...sections, purpose: 'a < b & c > d "e"' };
const buf2 = buildReportDocx({ sections: sec2, schemaColumns: columns, dataRows: rows });
const xml2 = unzip(buf2).get('word/document.xml')!.toString('utf8');
check('特殊字符已转义', xml2.includes('a &lt; b &amp; c &gt; d &quot;e&quot;'));

// 空表也应正常（不渲染表格）
const buf3 = buildReportDocx({ sections, schemaColumns: columns, dataRows: [] });
const xml3 = unzip(buf3).get('word/document.xml')!.toString('utf8');
check('无数据行时不渲染表格', !xml3.includes('<w:tbl>'));

// 写到 /tmp 供 python-docx 二次校验
try {
  writeFileSync('/tmp/test-report.docx', buf);
  console.log('  · 已写出 /tmp/test-report.docx');
} catch { /* 非关键 */ }

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
