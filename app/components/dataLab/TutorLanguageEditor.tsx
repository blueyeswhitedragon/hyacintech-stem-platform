'use client';

import { TUTOR_FOCUS_LABELS, TUTOR_INTERACTION_META } from '@/app/lib/dataLab/labels';

type InteractionType = keyof typeof TUTOR_INTERACTION_META;
const INTERACTION_TYPES = Object.keys(TUTOR_INTERACTION_META) as InteractionType[];

interface TutorFormValue {
  dialogue: string;
  interactionType: InteractionType;
  focus: string;
  hints: string[];
}

function parseTutorValue(raw: string, allowedFocusIds: string[]): { value: TutorFormValue | null; error: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: null, error: '输出不是 JSON 对象' };
    const dialogue = typeof parsed.dialogue === 'string' ? parsed.dialogue : '';
    const interactionType = typeof parsed.interactionType === 'string' ? parsed.interactionType : '';
    const focus = typeof parsed.focus === 'string' ? parsed.focus : '';
    const hints = Array.isArray(parsed.hints) ? parsed.hints.filter((item): item is string => typeof item === 'string') : [];
    if (!dialogue) return { value: null, error: '缺少 dialogue' };
    if (!INTERACTION_TYPES.includes(interactionType as InteractionType)) return { value: null, error: `无法识别 interactionType：${interactionType || '空'}` };
    if (!focus) return { value: null, error: '缺少 focus' };
    if (allowedFocusIds.length && !allowedFocusIds.includes(focus)) return { value: null, error: `focus 不在当前案例允许集合：${focus}` };
    if (hints.length > 1) return { value: null, error: 'hints 超过一条' };
    return { value: { dialogue, interactionType: interactionType as InteractionType, focus, hints }, error: '' };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'JSON 解析失败' };
  }
}

function serialize(value: TutorFormValue) {
  return JSON.stringify(value, null, 2);
}

export default function TutorLanguageEditor({
  raw,
  onChange,
  allowedFocusIds,
  focusDescriptions,
  editable = true,
  title = '导师回复',
  compact = false,
}: {
  raw: string;
  onChange?: (raw: string) => void;
  allowedFocusIds: string[];
  focusDescriptions?: Record<string, string>;
  editable?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const parsed = parseTutorValue(raw, allowedFocusIds);
  const value = parsed.value;

  function patch(next: Partial<TutorFormValue>) {
    if (!value || !onChange) return;
    onChange(serialize({ ...value, ...next }));
  }

  if (!value) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <div className="font-medium text-amber-950">{title} · 原始 JSON 模式</div>
        <p className="mt-1 text-xs text-amber-900">无法提取结构化字段：{parsed.error}。已回退到原始内容，不会静默修复。</p>
        <textarea
          value={raw}
          onChange={(event) => onChange?.(event.target.value)}
          readOnly={!editable}
          className={`${compact ? 'min-h-28' : 'min-h-52'} mt-3 w-full border bg-white p-3 font-mono text-xs read-only:bg-gray-50`}
        />
      </div>
    );
  }

  const interaction = TUTOR_INTERACTION_META[value.interactionType];
  const focusHelp = focusDescriptions?.[value.focus] ?? '处理当前案例允许的一个教学缺口。';
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-gray-950">{title}</div>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer select-none">查看原始 JSON</summary>
          <pre className="mt-2 max-w-2xl overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-3 text-gray-100">{serialize(value)}</pre>
        </details>
      </div>

      <label className="mt-3 block text-sm font-medium text-gray-800">
        对学生说的话
        <textarea
          value={value.dialogue}
          onChange={(event) => patch({ dialogue: event.target.value })}
          readOnly={!editable}
          className={`${compact ? 'min-h-24' : 'min-h-36'} mt-1 w-full border p-3 font-normal leading-6 read-only:bg-gray-50`}
        />
        <span className="mt-1 block text-right text-[11px] font-normal text-gray-400">{value.dialogue.length} 字 · {(value.dialogue.match(/[？?]/g) ?? []).length} 个问号</span>
      </label>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-800">
          互动方式
          <select
            value={value.interactionType}
            onChange={(event) => patch({ interactionType: event.target.value as InteractionType })}
            disabled={!editable}
            className="mt-1 block w-full border bg-white px-3 py-2 font-normal disabled:bg-gray-100"
          >
            {INTERACTION_TYPES.map((item) => <option key={item} value={item}>{TUTOR_INTERACTION_META[item].label}</option>)}
          </select>
          <details className="mt-1 text-xs font-normal text-gray-500">
            <summary className="cursor-pointer">ⓘ {interaction.label}是什么意思？</summary>
            <p className="mt-1 rounded bg-blue-50 p-2 text-blue-900">{interaction.help}</p>
          </details>
        </label>

        <label className="text-sm font-medium text-gray-800">
          教学焦点
          <select
            value={value.focus}
            onChange={(event) => patch({ focus: event.target.value })}
            disabled={!editable}
            className="mt-1 block w-full border bg-white px-3 py-2 font-normal disabled:bg-gray-100"
          >
            {(allowedFocusIds.length ? allowedFocusIds : [value.focus]).map((focus) => <option key={focus} value={focus}>{TUTOR_FOCUS_LABELS[focus] ?? '其他教学焦点'}</option>)}
          </select>
          <details className="mt-1 text-xs font-normal text-gray-500">
            <summary className="cursor-pointer">ⓘ {TUTOR_FOCUS_LABELS[value.focus] ?? '其他教学焦点'}是什么意思？</summary>
            <p className="mt-1 rounded bg-blue-50 p-2 text-blue-900">{focusHelp}</p>
          </details>
        </label>
      </div>

      <label className="mt-3 block text-sm font-medium text-gray-800">
        补充提示（可选，最多一条）
        <input
          value={value.hints[0] ?? ''}
          onChange={(event) => patch({ hints: event.target.value.trim() ? [event.target.value] : [] })}
          readOnly={!editable}
          placeholder="没有必要时留空"
          className="mt-1 block w-full border px-3 py-2 font-normal read-only:bg-gray-50"
        />
      </label>
    </div>
  );
}
