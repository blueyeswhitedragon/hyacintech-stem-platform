import { ButtonLink } from './Button';

/**
 * 分页条。给 Server Component 列表用：翻页是导航（改 URL 查询串），不是客户端状态，
 * 所以这里是两个链接而不是两个 onClick——刷新、后退、把某一页发给同事都还成立。
 *
 * 同一个页面可能有多个互不相干的列表（如待审核页的「必审」与「数据表待过目」），
 * 所以 `param` 由调用方指定，且翻页时用 `baseQuery` 原样带上其它列表的页码，
 * 不然翻这个列表会把那个列表打回第一页。
 */
export default function Pager({
  page, pageCount, total, param, baseQuery, pathname, unit = '条',
}: {
  page: number;
  pageCount: number;
  total: number;
  /** 本列表在查询串里的页码参数名，如 'p' / 's3' */
  param: string;
  /** 页面上其它需要保留的查询参数 */
  baseQuery?: Record<string, string | undefined>;
  pathname: string;
  unit?: string;
}) {
  const href = (target: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(baseQuery ?? {})) {
      if (v) sp.set(k, v);
    }
    // 第一页不写进 URL，保持链接干净、也让「回到列表」有唯一形式
    if (target > 1) sp.set(param, String(target));
    else sp.delete(param);
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // 只有一页时不渲染翻页按钮，但仍然报总数——「一共就这些」本身是有用的信息
  const single = pageCount <= 1;

  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-xs text-muted-soft">
        共 {total} {unit}
        {!single && ` · 第 ${page} / ${pageCount} 页`}
      </p>
      {!single && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <ButtonLink href={href(page - 1)} size="sm" scroll={false}>上一页</ButtonLink>
          ) : (
            <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-hairline px-3 text-[13px] text-muted-soft">上一页</span>
          )}
          {page < pageCount ? (
            <ButtonLink href={href(page + 1)} size="sm" scroll={false}>下一页</ButtonLink>
          ) : (
            <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-hairline px-3 text-[13px] text-muted-soft">下一页</span>
          )}
        </div>
      )}
    </div>
  );
}
