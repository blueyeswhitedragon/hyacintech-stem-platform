export const STAGE_CONTRACT_VERSION = 'stage-contract-v4';
export const STUDENT_FACT_EXTRACTOR_VERSION = 'student-fact-extractor-v4';
export const STUDENT_FACT_EXTRACTOR_PROMPT_VERSION = 'student-fact-extractor-prompt-v4';

/**
 * 第四阶段的分析主张抽取器，版本号与学生事实抽取器**并列而非替代**。
 *
 * 两者输出模式与消费方都不同：事实抽取器写 stageData.extractedFacts 事实账本，
 * 这个只产出「学生这句话引用了哪些单元格、有没有在比较」的主张，供服务器核验后写 stage4。
 * 因此它不进 TUTOR_TRAINING_COHORT（该队列门禁只认 STUDENT_FACT_EXTRACTOR_VERSION），
 * 升它的版本也不会让既有轨迹失去训练资格。
 */
export const ANALYSIS_CLAIM_EXTRACTOR_VERSION = 'analysis-claim-extractor-v1';
export const ANALYSIS_CLAIM_EXTRACTOR_PROMPT_VERSION = 'analysis-claim-extractor-prompt-v1';
