import Link from 'next/link';
import { redirect } from 'next/navigation';
import CopyCommandButton from '@/app/components/dataLab/CopyCommandButton';
import { getDataLabSetupStatus } from '@/app/lib/dataLab/setup';
import { getCurrentUser } from '@/app/lib/session';

interface CheckItem {
  key: keyof Awaited<ReturnType<typeof getDataLabSetupStatus>>['checks'];
  label: string;
  mode: '网页可完成' | '需命令行';
  detail: string;
  command?: string;
  href?: string;
}

const items: CheckItem[] = [
  { key: 'database', label: '数据库已迁移', mode: '需命令行', detail: '当前页面能够查询 Data Lab 数据表。', command: 'npm run db:deploy' },
  { key: 'sessionSecret', label: '会话密钥已配置', mode: '需命令行', detail: 'SESSION_SECRET 至少 32 字符，且不能使用示例占位值。', command: 'openssl rand -base64 32' },
  { key: 'provider', label: '环境基线 provider', mode: '需命令行', detail: 'Guest、Extractor 与未切换 RuntimeBundle 的基线调用需要 .env 中存在明确且有效的 provider/model/key。', command: 'LLM_PROVIDER=openai\nLLM_MODEL=<远程 model ID>\nOPENAI_API_KEY=<真实密钥>' },
  { key: 'timeout', label: 'LLM 有效超时', mode: '需命令行', detail: '有效超时至少 180 秒；未填写时服务器使用 180 秒默认值。', command: 'LLM_TIMEOUT_MS=180000' },
  { key: 'credentialMaster', label: '数据库凭据主密钥', mode: '需命令行', detail: '仅当已选择 ENCRYPTED_DB 保存网页凭据时必需；只使用环境变量引用时不阻断。', command: 'DATA_LAB_CREDENTIAL_MASTER_KEY=<独立的32字符以上随机值>' },
  { key: 'administrator', label: '管理员账号', mode: '需命令行', detail: '至少存在一个启用的 admin 账号。', command: 'ADMIN_USERNAME=<用户名> ADMIN_PASSWORD=<强密码> ADMIN_DISPLAY_NAME=<显示名> npm run data-lab:init' },
  { key: 'runtimeModel', label: '当前环境模型已登记', mode: '需命令行', detail: '必须登记当前 .env 精确指向的 provider/model/prompt 合同，而不是数据库中任意历史模型。', command: 'npm run model:bootstrap' },
  { key: 'productionDeployment', label: '存在 ACTIVE 生产部署', mode: '需命令行', detail: '正式 Tutor 的新会话会在第一次模型调用时按这条部署稳定分桶并固定。', command: 'npm run model:bootstrap' },
  { key: 'aiService', label: 'AI 服务连接可用', mode: '网页可完成', detail: '至少一个连接与 Endpoint 已通过实际调用测试。', href: '/data-lab/ai-services' },
];

export default async function DataLabSetupPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const status = await getDataLabSetupStatus();
  const readyCount = items.filter((item) => status.checks[item.key]).length;

  return <div className="space-y-6">
    <header>
      <h1 className="display-lg">环境检查</h1>
      <p className="mt-2.5 max-w-3xl text-[15px] leading-7 text-muted">冷启动依赖同时来自服务器环境和 Data Lab 登记表；此页只显示就绪状态，不读取或展示密钥内容。</p>
      <p className="mt-3 text-sm text-muted"><span className="font-lineage text-lg text-ink">{readyCount}/{items.length}</span> 项已就绪</p>
    </header>

    <div className="grid gap-3 md:grid-cols-2">
      <div className={`border px-4 py-3.5 text-sm leading-6 ${status.teachingReady ? 'border-success/50 bg-success/8 text-body' : 'border-warning/50 bg-warning/8 text-body-strong'}`}><b className="font-medium text-ink">教学端：</b>{status.teachingReady ? '正式 Tutor、Guest 与 Extractor 的基础条件已满足。' : '尚有基础运行条件未满足。'}</div>
      <div className={`border px-4 py-3.5 text-sm leading-6 ${status.dataLabReady ? 'border-success/50 bg-success/8 text-body' : 'border-warning/50 bg-warning/8 text-body-strong'}`}><b className="font-medium text-ink">完整 Data Lab：</b>{status.dataLabReady ? '服务连接、管理员与运行基线均已就绪。' : '仍需完成网页服务连接或管理配置。'}</div>
    </div>
    {!status.checks.provider && status.providerIssues.length > 0 && <div className="border border-error/50 bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body"><b className="font-medium text-ink">Provider 配置：</b>{status.providerIssues.join('；')}</div>}
    {status.activeDeployment && <div className="border border-info/40 bg-info/8 px-4 py-3.5 text-sm leading-6 text-body-strong"><b>当前生产路由：</b>{status.activeDeployment.runtimeBundle ? `${status.activeDeployment.runtimeBundle.name} v${status.activeDeployment.runtimeBundle.version}` : status.activeDeployment.modelVersion.tag} · {status.activeDeployment.rolloutPercent}% 。新正式会话第一次调用模型时固定，已有会话保持原路由。</div>}

    <section className="divide-y divide-hairline-soft border border-hairline bg-canvas">{items.map((item) => {
      const ready = status.checks[item.key];
      return <div key={item.key} className="grid gap-3 px-5 py-4 md:grid-cols-[220px_1fr_auto] md:items-center">
        <div>
          <span className={`mr-2 inline-flex size-6 items-center justify-center rounded-full text-xs font-medium ${ready ? 'bg-success/15 text-success' : 'bg-error/12 text-error'}`}>{ready ? '✓' : '!'}</span>
          <span className="font-medium text-ink">{item.label}</span>
          <span className="caption-upper mt-1.5 block pl-8">{item.mode}</span>
        </div>
        <div>
          <p className="text-sm leading-6 text-muted">{item.detail}</p>
          {!ready && item.command && <pre className="mt-2.5 overflow-x-auto rounded-md bg-surface-dark p-3 font-mono text-xs leading-5 text-on-dark">{item.command}</pre>}
        </div>
        {!ready && item.command ? <CopyCommandButton command={item.command} />
          : !ready && item.href ? <Link href={item.href} className="shrink-0 rounded-md bg-coral px-3.5 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-coral-active">去配置</Link>
          : <span className="shrink-0 text-xs text-success">已就绪</span>}
      </div>;
    })}</section>

    <div className="border border-hairline bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body">Data Lab 批次使用明确选择的 RuntimeBundle。正式 Tutor 在候选组合通过门禁并形成 ACTIVE 部署后切换；Guest、Extractor、话题卡编译、报告评分和环境基线仍读取 <code className="font-mono text-[13px] text-ink">.env</code>。角色默认绑定只做后续表单预选，不直接获得生产流量。</div>
  </div>;
}
