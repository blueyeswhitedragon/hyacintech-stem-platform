"use client";

import React from 'react';
import PhaseGlyph, { PHASE_GLYPH_LABELS, type PhaseGlyphName } from './icons/PhaseGlyph';

const STAGES = [1, 2, 3, 4, 5, 6] as const;

interface Props {
  currentStage: number;
  /** 全部完成时整条轨道变绿 */
  completed?: boolean;
}

export default function StageProgress({ currentStage, completed }: Props) {
  // 进度轨道按"已完成的段数"填充，而不是按当前阶段的圆心，
  // 否则停在第 1 阶段就已经有一截彩色，读起来像白送了一段进度。
  const doneCount = completed ? STAGES.length - 1 : Math.max(currentStage - 1, 0);
  const fillPercent = (doneCount / (STAGES.length - 1)) * 100;

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="relative flex min-w-[36rem] items-start justify-between px-1">
        {/* 轨道：底色 + 已完成填充，两层都收在圆心高度 */}
        <div aria-hidden="true" className="absolute left-5 right-5 top-5 h-px -translate-y-1/2 bg-hairline" />
        <div
          aria-hidden="true"
          className={`absolute left-5 top-5 h-px -translate-y-1/2 transition-[width] duration-500 ${completed ? 'bg-success' : 'bg-coral'}`}
          style={{ width: `calc((100% - 2.5rem) * ${fillPercent / 100})` }}
        />

        {STAGES.map((stage) => {
          const isActive = !completed && currentStage === stage;
          const isDone = completed || currentStage > stage;
          const ring = isActive
            ? 'border-coral bg-canvas'
            : isDone
              ? 'border-success bg-canvas'
              : 'border-hairline bg-canvas';

          return (
            <div key={stage} className="relative z-10 flex w-16 flex-col items-center">
              <div className={`flex size-10 items-center justify-center rounded-full border transition-colors duration-300 ${ring}`}>
                {isDone ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 text-success">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  // 只有当前阶段播描边动画：六个字形同时生长会变成噪音
                  <PhaseGlyph
                    phase={stage as PhaseGlyphName}
                    animate={isActive}
                    className={`size-5 ${isActive ? '' : 'opacity-45'}`}
                  />
                )}
              </div>
              <span className={`mt-1.5 text-xs leading-5 ${isActive ? 'font-medium text-ink' : isDone ? 'text-muted' : 'text-muted-soft'}`}>
                {PHASE_GLYPH_LABELS[stage as PhaseGlyphName]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
