import type { SVGProps } from 'react';

/**
 * 六阶段线描字形。
 *
 * 这不是装饰：六个阶段是本产品的主干概念，学生端进度条、各阶段面板空态、
 * DataLab 迭代时间轴讲的是同一件事。用同一套字形，认知只需建立一次。
 *
 * 画法约束（来自 docs/DESIGN-claude (1).md 的线描插画一节）：
 * - 只有珊瑚与墨两色，奶油底，无阴影、无填充色块
 * - 统一 1.5 笔触、圆头圆角，24×24 网格，视觉重量对齐
 * - 珊瑚只描"这一阶段在做什么"的那一笔，其余留墨色，避免整图涂满珊瑚
 */

export type PhaseGlyphName = 1 | 2 | 3 | 4 | 5 | 6;

interface PhaseGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  phase: PhaseGlyphName;
  /** 描边生长动画：进入当前阶段时播放一次 */
  animate?: boolean;
  title?: string;
}

/** 墨色部分：结构轮廓 */
const INK_PATHS: Record<PhaseGlyphName, string[]> = {
  // 选题定向 —— 放大镜
  1: ['M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M15.6 15.6 21 21'],
  // 方案设计 —— 图纸
  2: ['M4 4.5h16v15H4z', 'M4 8.5h16'],
  // 过程执行 —— 烧杯
  3: ['M9 3v6.2L4.7 17a2 2 0 0 0 1.8 3h11a2 2 0 0 0 1.8-3L15 9.2V3', 'M7.5 3h9'],
  // 数据分析 —— 坐标轴
  4: ['M4 4v16h16'],
  // 报告成型 —— 文稿
  5: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  // 结果反思 —— 回环
  6: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4.5h-4.5'],
};

/** 珊瑚部分：这一阶段"正在发生"的动作 */
const CORAL_PATHS: Record<PhaseGlyphName, string[]> = {
  1: ['M10.5 7.5v6', 'M7.5 10.5h6'],
  2: ['M7.5 12h5', 'M7.5 15.5h9'],
  3: ['M7.4 13.5h9.2'],
  4: ['M7 16.5l3.5-4 3 2.5L18 8'],
  5: ['M9 11.5h6', 'M9 15h6', 'M9 18h3'],
  6: ['M12 8.5V12l2.5 2'],
};

const LABELS: Record<PhaseGlyphName, string> = {
  1: '选题定向', 2: '方案设计', 3: '过程执行',
  4: '数据分析', 5: '报告成型', 6: '结果反思',
};

export default function PhaseGlyph({ phase, animate = false, title, className = '', ...rest }: PhaseGlyphProps) {
  const label = title ?? LABELS[phase];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className={`${animate ? 'phase-glyph-draw' : ''} ${className}`}
      {...rest}
    >
      <title>{label}</title>
      {INK_PATHS[phase].map((d, index) => (
        <path key={`ink-${index}`} d={d} className="text-ink" stroke="currentColor" opacity={0.85} />
      ))}
      {CORAL_PATHS[phase].map((d, index) => (
        <path key={`coral-${index}`} d={d} className="text-coral" stroke="currentColor" />
      ))}
    </svg>
  );
}

export { LABELS as PHASE_GLYPH_LABELS };
