'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavigationItem {
  href: string;
  label: string;
  count?: number;
}

export interface NavigationGroupData {
  label: string;
  items: NavigationItem[];
}

/**
 * 侧栏需要客户端态是因为「当前所在页」必须高亮：Data Lab 有 15 个入口，
 * 没有选中态时导航看起来永远是同一张静止的列表。
 */
function isActive(pathname: string, href: string) {
  // /data-lab 是概览，只在完全相等时才算选中，否则每个子页都会把它点亮。
  return href === '/data-lab' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function Group({ group, pathname }: { group: NavigationGroupData; pathname: string }) {
  return (
    <div>
      <div className="caption-upper px-3 pb-1.5 pt-4">{group.label}</div>
      <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-4 lg:grid-cols-1">
        {group.items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-9 items-center justify-between gap-2 rounded-md py-2 pl-3 pr-2.5 text-sm transition-colors ${
                active
                  ? 'bg-surface-card font-medium text-ink'
                  : 'text-body hover:bg-surface-soft hover:text-ink'
              }`}
            >
              {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-coral" />}
              <span className="truncate">{item.label}</span>
              {Boolean(item.count) && (
                <span className="min-w-[22px] shrink-0 rounded-full bg-coral px-1.5 py-0.5 text-center text-xs font-medium tabular-nums text-on-primary">
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function DataLabNav({ groups }: { groups: NavigationGroupData[] }) {
  const pathname = usePathname();
  return <>{groups.map((group) => <Group key={group.label} group={group} pathname={pathname} />)}</>;
}
