#!/usr/bin/env tsx
import { parseLlmJsonObject } from '../app/lib/llm/jsonRepair';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function isOk(raw: string): boolean {
  return parseLlmJsonObject(raw)?.ok === true;
}

console.log('LLM JSON object parsing:');

check('裸 JSON 对象可以解析', isOk('{"ok":true}'));
check('json 围栏可以解析', isOk('```json\n{"ok":true}\n```'));
check('无语言标签围栏可以解析', isOk('```\n{"ok":true}\n```'));
check('围栏前后说明文字可以解析', isOk('结果如下：\n```json\n{"ok":true}\n```\n请继续。'));
check('尾逗号和弯引号经修复后可以解析', isOk('{“ok”:true,}'));
// 无围栏但前后夹说明文字：这是话题卡一键补全原本自带的第三级策略，收敛到公共解析器后必须仍然覆盖。
check('无围栏但前后夹文字可以解析', isOk('好的，结果是 {"ok":true} 这样。'));

check('拒答文本不被判为成功', !isOk('我拒绝回答'));
check('空串不被判为成功', !isOk(''));
check('JSON 数组不被判为成功', !isOk('[1,2]'));
check('字符串 true 不被判为成功', !isOk('{"ok":"true"}'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
