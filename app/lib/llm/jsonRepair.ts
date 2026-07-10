/**
 * 零依赖、确定性的 JSON 修复器。
 *
 * 沙箱无法访问 npm registry（装不了 jsonrepair），且 .docx 已用同样思路自带实现；
 * 这里针对 LLM 最常见的「轻微掉格式」做修复，作为 parser 严格解析失败后的兜底，
 * 在退化成文本抢救之前再抢一次结构化结果。覆盖：
 *   - 字符串内未转义的换行/制表符等控制字符
 *   - 字符串内未转义的内部双引号（启发式：后面不是 , : } ] 或结尾就视为内部引号）
 *   - 对象/数组结尾的多余逗号（trailing comma）
 *   - 中文弯引号（smart quotes）归一为 ASCII 引号
 *
 * 不处理单引号串、无引号键——在 json_object 模式下这两类极少出现，且强行处理会误伤中文撇号。
 */

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export function repairJson(src: string): string {
  // 弯引号归一
  const s = src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  let out = '';
  let i = 0;
  const n = s.length;
  let inStr = false;

  while (i < n) {
    const ch = s[i];

    if (!inStr) {
      if (ch === '"') {
        inStr = true;
        out += ch;
        i++;
        continue;
      }
      // 去尾逗号：逗号后（跳过空白）紧接 } 或 ] → 丢弃该逗号
      if (ch === ',') {
        let j = i + 1;
        while (j < n && isWs(s[j])) j++;
        if (s[j] === '}' || s[j] === ']') {
          i++;
          continue;
        }
      }
      out += ch;
      i++;
      continue;
    }

    // 字符串内
    if (ch === '\\') {
      // 保留转义对（含被转义的引号）
      out += ch + (s[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '"') {
      // 是否为闭合引号：向后跳空白，下一个有效字符须是 , : } ] 或结尾
      let j = i + 1;
      while (j < n && isWs(s[j])) j++;
      const next = s[j];
      if (next === undefined || next === ',' || next === ':' || next === '}' || next === ']') {
        inStr = false;
        out += ch;
        i++;
        continue;
      }
      // 否则视为字符串内部未转义的引号 → 转义之
      out += '\\"';
      i++;
      continue;
    }
    // 字符串内的裸控制字符 → 转义
    if (ch === '\n') { out += '\\n'; i++; continue; }
    if (ch === '\r') { out += '\\r'; i++; continue; }
    if (ch === '\t') { out += '\\t'; i++; continue; }

    out += ch;
    i++;
  }

  return out;
}
