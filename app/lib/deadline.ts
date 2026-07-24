import type { StageData } from '@/app/models/stageData';

type LateEvent = NonNullable<StageData['timeline']>['lateEvents'][number]['event'];

export function isPastDue(dueDate: Date | string | null | undefined, now = new Date()): boolean {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  return Number.isFinite(due.getTime()) && now.getTime() > due.getTime();
}

export function recordLateEvent(
  stageData: StageData,
  dueDate: Date | string | null | undefined,
  event: LateEvent,
  stage: number,
  now = new Date(),
): StageData {
  if (!isPastDue(dueDate, now) || !dueDate) return stageData;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const previous = stageData.timeline?.lateEvents ?? [];
  if (previous.some((item) => item.event === event)) return stageData;
  return {
    ...stageData,
    timeline: {
      dueAt: due.toISOString(),
      lateEvents: [...previous, {
        event,
        stage,
        occurredAt: now.toISOString(),
        dueAt: due.toISOString(),
      }],
    },
  };
}
