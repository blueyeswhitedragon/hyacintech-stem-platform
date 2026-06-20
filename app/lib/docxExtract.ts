/**
 * 纯函数：从 .docx（ZIP 容器）的 word/document.xml 提取纯文本。
 * 零依赖（用内置 zip 工具），替代 mammoth——本环境无法访问 npm registry。
 * 仅做「轻量提取」：段落→换行、<w:br/>/<w:tab/> 处理、去标签、解 XML 实体。
 */
import { unzip } from './zip';

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // 必须最后，避免二次解码
}

/** 从 docx buffer 提取纯文本；非法 docx 抛错由调用方处理。 */
export function extractDocxText(buf: Buffer): string {
  const files = unzip(buf);
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('不是有效的 Word 文档（缺少 document.xml）');

  let s = xml.toString('utf8');
  // 段落与换行先转成占位换行
  s = s
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<\/w:tr>/g, '\n');
  // 去掉所有 XML 标签
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  // 规整：去掉行尾空白，压缩 3+ 连续空行为 1 个空行
  s = s
    .split('\n')
    .map((ln) => ln.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}
