import type { ChatResponse } from '@/app/models/types';

export type ChatContractIssueCode =
  | 'P2_CONFIRMATION_WITHOUT_SCHEMA'
  | 'P2_ARTIFACT_CLAIM_WITHOUT_SCHEMA'
  | 'P2_PHASE_COMPLETE_WITHOUT_SCHEMA'
  | 'P2_SCHEMA_ACTION_MISMATCH'
  | 'P2_SCHEMA_INVALID';

export interface ChatContractIssue {
  code: ChatContractIssueCode;
  message: string;
}

export interface ChatContractContext {
  stage: number;
  /** 当前对话在本轮响应前是否已经保存过有效的阶段二数据表。 */
  hasStage2Schema?: boolean;
  /** 运行时可安全修正 schema 已存在但动作类型错误的响应；Data Lab 应保留为显式问题。 */
  canonicalize?: boolean;
}

export interface ChatContractResult {
  response: ChatResponse;
  issues: ChatContractIssue[];
  repairs: ChatContractIssue[];
  ok: boolean;
}

function hasValidStage2Schema(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some(
    (column) => column.key.trim() && column.title.trim()
  );
}

/**
 * 只识别明确的“已经生成”陈述，避免把“接下来要生成”“尚未生成”误判成完成声明。
 */
export function claimsStage2ArtifactReady(dialogue: string): boolean {
  const compact = dialogue.replace(/\s+/g, '');
  if (/(?:尚未|还没|没有|未能|无法|不能)(?:生成|创建|设计)/.test(compact)) return false;
  return (
    /(?:已经|已|现已|刚刚|成功)(?:为你)?(?:生成|创建|设计)(?:好|完成|出来)?(?:了)?(?:一份|这个)?(?:实验)?数据(?:记录)?表/.test(compact)
    || /(?:生成|创建|设计)(?:好|完成|出来)?了(?:一份|这个)?(?:实验)?数据(?:记录)?表/.test(compact)
    || /右侧(?:面板)?(?:已经|已|可以|可)(?:预览|查看|修改)(?:和修改)?(?:列定义|数据表|表格)/.test(compact)
  );
}

/**
 * 阶段感知的语义契约。parser 只负责“能否解析”，本函数负责跨字段与累计状态的一致性。
 */
export function validateChatContract(
  response: ChatResponse,
  context: ChatContractContext
): ChatContractResult {
  const canonicalize = context.canonicalize === true;
  const next: ChatResponse = canonicalize ? { ...response } : response;
  const issues: ChatContractIssue[] = [];
  const repairs: ChatContractIssue[] = [];

  if (context.stage !== 2) return { response: next, issues, repairs, ok: true };

  const currentHasSchema = hasValidStage2Schema(response);
  const schemaAvailable = currentHasSchema || context.hasStage2Schema === true;
  const claimsArtifactReady = claimsStage2ArtifactReady(response.dialogue);

  if (currentHasSchema && response.next_action_type !== 'confirmation') {
    const mismatch: ChatContractIssue = {
      code: 'P2_SCHEMA_ACTION_MISMATCH',
      message: '已生成有效数据表时，next_action_type 必须为 confirmation',
    };
    if (canonicalize) {
      next.next_action_type = 'confirmation';
      repairs.push(mismatch);
    } else {
      issues.push(mismatch);
    }
  }

  if (response.next_action_type === 'confirmation' && !schemaAvailable) {
    const mismatch: ChatContractIssue = {
      code: 'P2_CONFIRMATION_WITHOUT_SCHEMA',
      message: '请求确认方案前，必须先生成有效的 data_table_schema',
    };
    // 模型有时会把“请确认这一项方案信息”误写成 confirmation。只要它没有
    // 声称数据表已生成，也没有结束阶段，运行时可安全降级为普通文本输入；
    // Data Lab（canonicalize=false）仍保留原始契约错误用于数据审查。
    if (canonicalize && !claimsArtifactReady && !response.phase_complete) {
      next.next_action_type = 'text_input';
      repairs.push(mismatch);
    } else {
      issues.push(mismatch);
    }
  }

  if (claimsArtifactReady && !schemaAvailable) {
    issues.push({
      code: 'P2_ARTIFACT_CLAIM_WITHOUT_SCHEMA',
      message: '回复声称数据表已经生成，但当前及此前都没有有效的 data_table_schema',
    });
  }

  if (response.phase_complete && !schemaAvailable) {
    issues.push({
      code: 'P2_PHASE_COMPLETE_WITHOUT_SCHEMA',
      message: '阶段二标记完成前，当前或此前回复中必须存在有效的数据表结构',
    });
  }

  return { response: next, issues, repairs, ok: issues.length === 0 };
}

export function hasResponseStage2Schema(response: ChatResponse): boolean {
  return hasValidStage2Schema(response);
}
