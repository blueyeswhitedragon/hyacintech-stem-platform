import Image from 'next/image';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

/**
 * Hyacintech 主标：六朵盛开的风信子组成 H。
 *
 * 六朵花对应平台的六个科学探究阶段；叶片横向连接形成 H 的横杠。
 * 源图经过透明化、紧裁和 512px 网页优化，避免导航栏加载完整生成稿。
 */
export default function BrandMark({
  className = '',
  title = 'Hyacintech 六阶段风信子标志',
}: BrandMarkProps) {
  return (
    <Image
      src="/brand/hyacintech-logo-six-stage-h.png"
      width={512}
      height={512}
      sizes="40px"
      loading="eager"
      alt={title}
      className={`object-contain ${className}`}
    />
  );
}
