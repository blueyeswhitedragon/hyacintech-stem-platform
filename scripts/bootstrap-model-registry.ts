#!/usr/bin/env tsx
import { db } from '../app/lib/db';
import './load-script-env';
import {
  ensureRuntimeModelVersion,
  getRuntimeModelIdentity,
} from '../app/lib/modelRegistry';

async function main() {
  const identity = getRuntimeModelIdentity();
  if (!identity) {
    console.warn('模型注册跳过：当前 LLM 配置无效；服务仍可启动并由健康检查报告问题。');
    return;
  }
  const model = await ensureRuntimeModelVersion();
  console.log(`模型基线已登记：${model.tag} (${model.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => db.$disconnect());
