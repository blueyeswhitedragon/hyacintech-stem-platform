/**
 * 纯函数：把第五阶段报告（六节 + 数据表 + 结论/反思 + 可选上传正文）组装成 .docx Buffer。
 *
 * 不依赖外部库——手写 WordprocessingML，再用内置 zlib 的 zip 工具打包（见 app/lib/zip.ts）。
 * 「框架含表格」的落点：数据表直接由 schemaColumns(表头) + dataRows(行) 生成为 Word 表格。
 */
import type { Stage5Sections, Stage2Column } from '@/app/models/stageData';
import { zipDeflate } from './zip';

export interface ReportDocxInput {
  title?: string;
  sections: Stage5Sections;
  schemaColumns?: Stage2Column[];
  dataRows?: Record<string, unknown>[];
  uploadedText?: string;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 一个段落，text 内的 \n 转成软换行。bold/size 可选（size 为半磅值，如 32=16pt）。 */
function para(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const lines = String(text ?? '').split('\n');
  const rpr = opts.bold || opts.size
    ? `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ''}</w:rPr>`
    : '';
  const runs = lines
    .map((ln, i) => `<w:r>${rpr}${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(ln)}</w:t></w:r>`)
    .join('');
  return `<w:p>${runs}</w:p>`;
}

function heading(text: string): string {
  return para(text, { bold: true, size: 28 });
}

function tableCell(text: string, bold = false): string {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(text, bold ? { bold: true } : {})}</w:tc>`;
}

function buildTable(columns: Stage2Column[], rows: Record<string, unknown>[]): string {
  const headerRow = `<w:tr>${['#', ...columns.map((c) => c.title)].map((t) => tableCell(t, true)).join('')}</w:tr>`;
  const bodyRows = rows
    .map((row, i) => {
      const cells = [String(i + 1), ...columns.map((c) => {
        const v = row[c.key];
        if (c.type === 'image' && v) return '（见原图）';
        return v === undefined || v === null ? '' : String(v);
      })];
      return `<w:tr>${cells.map((t) => tableCell(t)).join('')}</w:tr>`;
    })
    .join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
    .join('');
  // tblGrid 必须存在且 gridCol 数量等于每行单元格数（含序号列），否则严格解析器（如 python-docx）会报错
  const colCount = columns.length + 1;
  const grid = `<w:tblGrid>${Array.from({ length: colCount }, () => '<w:gridCol w:w="1200"/>').join('')}</w:tblGrid>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${grid}${headerRow}${bodyRows}</w:tbl>`;
}

export function buildReportDocx(input: ReportDocxInput): Buffer {
  const { sections, schemaColumns, dataRows, uploadedText } = input;
  const body: string[] = [];

  body.push(para(input.title || '科学探究报告', { bold: true, size: 36 }));

  const fields: [keyof Stage5Sections, string][] = [
    ['purpose', '研究目的'],
    ['hypothesis', '假设'],
    ['materials', '实验材料'],
    ['procedure', '实验步骤'],
    ['dataSummary', '数据概述'],
    ['analysis', '数据分析'],
  ];
  for (const [key, label] of fields) {
    body.push(heading(label));
    body.push(para(sections[key] || '（未填写）'));
  }

  if (schemaColumns && schemaColumns.length > 0 && dataRows && dataRows.length > 0) {
    body.push(heading('实验数据记录'));
    body.push(buildTable(schemaColumns, dataRows));
    body.push(para('')); // 表后空行
  }

  body.push(heading('结论'));
  body.push(para(sections.conclusion || '（未填写）'));
  body.push(heading('反思'));
  body.push(para(sections.reflection || '（未填写）'));

  if (uploadedText && uploadedText.trim()) {
    body.push(heading('学生上传的报告（原文摘录）'));
    body.push(para(uploadedText));
  }

  const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body.join('')}${sectPr}</w:body></w:document>`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  return zipDeflate([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ]);
}
