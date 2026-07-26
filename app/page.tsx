import Link from 'next/link';
import BrandMark from './components/icons/BrandMark';
import PhaseGlyph, { type PhaseGlyphName } from './components/icons/PhaseGlyph';
import Badge from './components/ui/Badge';
import { ButtonLink } from './components/ui/Button';
import Card from './components/ui/Card';
import { getCurrentUser } from './lib/session';
import { dashboardForRole, roleLabel } from './lib/roles';

const phases = ['选题定向', '方案设计', '过程执行', '数据分析', '报告成型', '结果反思'];

export default async function Home() {
  const user = await getCurrentUser();
  const dashboard = user ? dashboardForRole(user.role) : '/student/dashboard';

  return (
    // 首页跟着学生端走 density-roomy：这里是给初中生和家长读的，不是给管理员扫的。
    <main className="density-roomy flex min-h-screen flex-col bg-canvas text-body">
      <header className="border-b border-hairline bg-canvas px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="size-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="display-sm">Hyacintech</h1>
              <p className="truncate text-xs text-muted">AI 驱动的 STEM 教育平台</p>
            </div>
          </div>
          {user ? (
            <ButtonLink href={dashboard} variant="secondary" size="sm">
              {user.displayName}（{roleLabel(user.role)}）→ 进入
            </ButtonLink>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Link href="/auth/login" className="text-muted transition-colors duration-[120ms] hover:text-coral">登录</Link>
              <ButtonLink href="/auth/register" variant="primary" size="sm">注册</ButtonLink>
            </div>
          )}
        </div>
      </header>

      <section className="border-b border-hairline bg-surface-soft">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:py-24">
          <div>
            <Badge tone="coral">面向初中科学探究的六阶段 AI 导师</Badge>
            <h2 className="display-lg mt-5 sm:text-[42px]">让每一次好奇，走成一条完整的科学探究路径</h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-body">
              基于上海市初中科学课程标准，AI 导师陪伴学生完成选题、方案、执行、分析、报告与反思，并在关键环节提供安全提示和结构化支持。
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {/* 珊瑚只给一个动作：无需注册就能试，这是首页唯一想让人点的按钮。 */}
              <ButtonLink href="/experience" variant="primary">直接体验（无需注册）</ButtonLink>
              {user ? (
                <ButtonLink href={dashboard} variant="secondary">
                  进入我的{user.role === 'student' ? '主页' : '工作台'}
                </ButtonLink>
              ) : (
                <ButtonLink href="/auth/login" variant="secondary">登录 / 注册</ButtonLink>
              )}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">
              体验模式仅在本页保存进度（刷新清空）；正式账号支持教师布置作业、进度持久化与审核。
            </p>
          </div>

          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="caption-upper">探究路径</p>
                <h3 className="display-sm mt-1.5">六个阶段，步步有据</h3>
              </div>
              <Badge tone="success">安全监护</Badge>
            </div>
            <ol className="mt-5 space-y-2">
              {phases.map((phase, index) => (
                <li key={phase} className="flex items-center gap-3 rounded-lg border border-hairline bg-surface-soft px-4 py-2.5">
                  <PhaseGlyph phase={(index + 1) as PhaseGlyphName} className="size-6 shrink-0" />
                  <span className="font-lineage text-sm text-muted">{index + 1}</span>
                  <span className="text-sm font-medium text-ink">{phase}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-6 py-10 md:grid-cols-3">
        <Card>
          <p className="caption-upper">学生</p>
          <h3 className="display-sm mt-2">从问题到成果</h3>
          <p className="mt-2 text-sm leading-6 text-body">AI 不代替思考，而是帮助学生明确变量、记录证据并形成自己的结论。</p>
        </Card>
        <Card>
          <p className="caption-upper">教师</p>
          <h3 className="display-sm mt-2">过程可见、关键可审</h3>
          <p className="mt-2 text-sm leading-6 text-body">查看阶段进度与关键产出，在方案和报告节点进行专业把关。</p>
        </Card>
        <Card>
          <p className="caption-upper">数据闭环</p>
          <h3 className="display-sm mt-2">可追溯的教学模型改进</h3>
          <p className="mt-2 text-sm leading-6 text-body">通过结构化标注、匿名仲裁和版本发布持续提升课堂对话质量。</p>
        </Card>
      </section>

      <footer className="mt-auto border-t border-hairline bg-canvas py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted">
          <p>Copyright © 2026 Hyacintech 团队. 保留所有权利。</p>
          <p className="mt-1">基于上海市课程标准，让STEM教育资源普惠全国各地学生</p>
          {/* 备案号按工信部要求放在首页底部，并链接到官方查询站点。 */}
          <p className="mt-2 text-xs">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="transition-colors duration-[120ms] hover:text-coral"
            >
              沪ICP备2026033322号-1
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
