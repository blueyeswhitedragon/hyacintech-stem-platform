#!/usr/bin/env tsx
import { effectiveTutorTimeoutMs, evaluateSetupReadiness } from '../app/lib/dataLab/setupStatus';

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

const validLlm = { valid: true, provider: 'deepseek', model: 'deepseek-v4-pro', issues: [] };
const base = {
  llm: validLlm,
  sessionSecret: 'setup-readiness-secret-at-least-32-characters',
  timeoutValue: undefined,
  credentialMaster: undefined,
  encryptedCredentialCount: 0,
  administratorCount: 1,
  runtimeModelRegistered: true,
  activeProductionDeployment: true,
  testedAiServiceCount: 1,
};

console.log('Data Lab setup readiness:');
check('未显式配置超时时使用 180 秒有效默认值', effectiveTutorTimeoutMs(undefined) === 180_000);
check('有效默认超时不会造成就绪假阴性', evaluateSetupReadiness(base).checks.timeout);
check('只使用 ENV 引用凭据时不强制主密钥', evaluateSetupReadiness(base).checks.credentialMaster);

const encrypted = evaluateSetupReadiness({ ...base, encryptedCredentialCount: 1 });
check('存在数据库加密凭据但缺主密钥时阻断完整 Data Lab', !encrypted.checks.credentialMaster && !encrypted.dataLabReady);
check(
  '配置主密钥后数据库加密凭据就绪',
  evaluateSetupReadiness({
    ...base,
    encryptedCredentialCount: 1,
    credentialMaster: 'credential-master-secret-at-least-32-characters',
  }).dataLabReady,
);
check(
  '缺少当前运行模型登记时教学端未就绪',
  !evaluateSetupReadiness({ ...base, runtimeModelRegistered: false }).teachingReady,
);
check(
  '缺少 ACTIVE 生产部署时教学端未就绪',
  !evaluateSetupReadiness({ ...base, activeProductionDeployment: false }).teachingReady,
);
const noService = evaluateSetupReadiness({ ...base, testedAiServiceCount: 0 });
check('无 Data Lab AI 服务时教学端仍可就绪', noService.teachingReady);
check('无 Data Lab AI 服务时完整 Data Lab 未就绪', !noService.dataLabReady);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
