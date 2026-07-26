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
  { key: 'provider', label: '至少一个 provider key', mode: '需命令行', detail: '学生端 Tutor 与 Extractor 只读取 .env 中的 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。', command: 'OPENAI_API_BASE=https://<网关>/v1/v1\nOPENAI_API_KEY=<真实密钥>' },
  { key: 'timeout', label: 'LLM 超时适配长推理', mode: '需命令行', detail: 'Qwen3.5-35B 网关建议至少 180 秒。', command: 'LLM_TIMEOUT_MS=180000' },
  { key: 'credentialMaster', label: '凭据主密钥', mode: '需命令行', detail: 'DATA_LAB_CREDENTIAL_MASTER_KEY 用于加密网页登记的数据库凭据。', command: 'openssl rand -base64 32' },
  { key: 'administrator', label: '管理员账号', mode: '需命令行', detail: '至少存在一个启用的 admin 账号。', command: 'ADMIN_USERNAME=<用户名> ADMIN_PASSWORD=<强密码> ADMIN_DISPLAY_NAME=<显示名> npm run data-lab:init' },
  { key: 'runtimeModel', label: '运行时模型已登记', mode: '需命令行', detail: '环境变量指向的生产模型已登记为不可变模型版本。', command: 'npm run model:bootstrap' },
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

    {status.allReady && <div className="border border-success/50 bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body"><b className="font-medium text-ink">环境就绪。</b>学生端运行时与 Data Lab 生产链路的基础配置均已满足。</div>}
    {!status.checks.provider && status.providerIssues.length > 0 && <div className="border border-error/50 bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body"><b className="font-medium text-ink">Provider 配置：</b>{status.providerIssues.join('；')}</div>}

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

    <div className="border border-hairline bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body">Data Lab 登记的连接用于案例生成、批评与评测。学生端 Tutor、Extractor、话题卡编译和报告评分仍读取 <code className="font-mono text-[13px] text-ink">.env</code>；候选运行组合通过部署门禁并灰度上线后，新的学生会话才会切换到登记组合。</div>
  </div>;
}
