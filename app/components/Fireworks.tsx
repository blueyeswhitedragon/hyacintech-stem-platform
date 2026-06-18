"use client";

import React, { useEffect, useState, useMemo, useCallback } from 'react';

/** 探究全部完成后的小彩蛋：放烟花效果。点击任意位置或按任意键关闭。 */
export default function Fireworks() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback(() => setDismissed(true), []);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, []);

  // 点击或按键关闭
  useEffect(() => {
    if (!show) return;
    const handleKey = () => dismiss();
    const handleClick = () => dismiss();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('click', handleClick);
    };
  }, [show, dismiss]);

  const particles = useMemo(() => {
    const colors = ['🎉', '🎊', '✨', '🌟', '💫', '🎆', '🎇', '🥳'];
    return Array.from({ length: 24 }, (_, i) => {
      const angle = (i / 24) * 360;
      const pseudoRandom = (seed: number, max: number) => ((seed * 7919 + 104729) % 10000) / 10000 * max;
      const distance = 60 + pseudoRandom(i * 3, 120);
      const delay = pseudoRandom(i * 7, 0.8);
      const emoji = colors[i % colors.length];
      return { angle, distance, emoji, delay };
    });
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
      {/* 暗色遮罩 */}
      <div className="absolute inset-0 bg-black/30 animate-in fade-in duration-500" />

      {/* 中央祝贺文字 */}
      <div className="relative z-10 text-center animate-in zoom-in-95 fade-in duration-700">
        <div className="text-4xl mb-3">🎓</div>
        <h2 className="text-3xl font-bold text-white drop-shadow-lg mb-2">
          恭喜完成探究！
        </h2>
        <p className="text-white/90 text-lg drop-shadow">
          你已完成了全部六个阶段的科学探究，太棒了！
        </p>
        <p className="text-white/60 text-sm mt-3">点击任意位置或按任意键关闭</p>
      </div>

      {/* 烟花粒子 */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute text-2xl"
          style={{
            left: '50%',
            top: '50%',
            animation: `firework-burst 1.8s ease-out ${p.delay}s forwards`,
            '--angle': `${p.angle}deg`,
            '--distance': `${p.distance}px`,
          } as React.CSSProperties}
        >
          {p.emoji}
        </div>
      ))}

      <style jsx>{`
        @keyframes firework-burst {
          0% {
            transform: translate(-50%, -50%) rotate(var(--angle)) translateY(0);
            opacity: 1;
            scale: 0.3;
          }
          30% {
            opacity: 1;
            scale: 1.2;
          }
          100% {
            transform: translate(-50%, -50%) rotate(var(--angle)) translateY(calc(var(--distance) * -1));
            opacity: 0;
            scale: 0.6;
          }
        }
      `}</style>
    </div>
  );
}
