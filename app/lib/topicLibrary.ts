import topicLibraryJson from '../../data/topic-library.json';

export interface TopicExample {
  id: string;
  paradigm: 'inquiry' | 'engineering';
  title: string;
  sourceTitle: string;
  subjectTags: string[];
  gradeBand: string;
  questionStem: string;
  independentVariable: string;
  dependentVariable?: string;
  engineeringTranslation?: string;
  safetyNote?: string;
}

interface TopicLibraryJson {
  examples: TopicExample[];
}

interface PickTopicOptions {
  topicDirection?: string;
  count?: number;
  includeEngineering?: boolean;
}

const topicLibrary = topicLibraryJson as TopicLibraryJson;
const GENERIC_TOPIC = /实验教学|科学探究学习|实验探究|科学探究$|科学探究中怎样|怎样设计实验|走进实验室|控制变量法.*应用|课题\d|PPT|pptx|_\d|实验课|课堂实录|教学设计|说课|练习|应该采取的操作|选择题|试题|^[\s\-—]*实验[\s\-—]*$/;

function isConcrete(example: TopicExample): boolean {
  if (GENERIC_TOPIC.test(example.title) || GENERIC_TOPIC.test(example.sourceTitle)) return false;
  return /影响|因素|蒸发|电磁铁|光合作用|植物|种子|纸飞机|净水|过滤|结构|太阳能|机器人|自动|装置|系统|模型|发酵|保存|变质|承重/.test(
    `${example.title} ${example.questionStem} ${example.sourceTitle}`
  );
}

function scoreTopic(example: TopicExample, direction: string): number {
  if (!direction.trim()) return 0;
  const text = [
    example.title,
    example.sourceTitle,
    example.questionStem,
    example.independentVariable,
    example.dependentVariable ?? '',
    example.subjectTags.join(' '),
  ].join(' ');
  const keywords = direction
    .split(/[\s,，、。；;：:（）()]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (/自动|智能|浇花|机器人|传感/.test(direction)) keywords.push('自动', '智能', '机器人', '传感器', '系统', '阈值');
  if (/净水|过滤|水质/.test(direction)) keywords.push('净水', '过滤', '水质');
  if (/飞行|纸飞机/.test(direction)) keywords.push('纸飞机', '飞行', '距离');
  if (/结构|承重|桥/.test(direction)) keywords.push('结构', '承重', '模型');
  return keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 2 : 0), text.includes(direction) ? 4 : 0);
}

function byQuality(a: TopicExample, b: TopicExample): number {
  const aConcrete = isConcrete(a) ? 0 : 1;
  const bConcrete = isConcrete(b) ? 0 : 1;
  if (aConcrete !== bConcrete) return aConcrete - bConcrete;
  return a.id.localeCompare(b.id);
}

function inferRetainedFeature(example: TopicExample): string {
  const text = [
    example.title,
    example.sourceTitle,
    example.questionStem,
    example.independentVariable,
    example.engineeringTranslation ?? '',
  ].join(' ');
  if (/自动|智能|阈值|传感|机器人|系统/.test(text)) return '自动判断、阈值触发或系统响应机制';
  if (/净水|过滤|水质|污染|生态/.test(text)) return '资源处理、净化效果或环境变化';
  if (/太阳能|光照|遮光|灯|能量/.test(text)) return '光照管理、能量转换或遮挡条件';
  if (/材料|结构|承重|保护|桥|装置/.test(text)) return '材料结构、保护性能或受力表现';
  if (/植物|种子|发芽|光合作用|生长/.test(text)) return '生长条件需要被人为调节';
  return '原主题中的关键限制、机制或可改变条件';
}

export function pickTopicExamples(options: PickTopicOptions = {}): TopicExample[] {
  const count = options.count ?? 8;
  const direction = options.topicDirection?.trim() ?? '';
  const pool = topicLibrary.examples
    .filter((e) => options.includeEngineering !== false || e.paradigm === 'inquiry')
    .filter((e) => !/高中素材/.test(e.gradeBand))
    .filter(isConcrete);

  const sorted = [...pool].sort((a, b) => {
    const scoreDiff = scoreTopic(b, direction) - scoreTopic(a, direction);
    if (scoreDiff !== 0) return scoreDiff;
    return byQuality(a, b);
  });

  const picked: TopicExample[] = [];
  const engineeringTarget = Math.max(2, Math.floor(count / 3));
  const inquiryTarget = count - engineeringTarget;

  picked.push(...sorted.filter((e) => e.paradigm === 'inquiry').slice(0, inquiryTarget));
  picked.push(...sorted.filter((e) => e.paradigm === 'engineering').slice(0, engineeringTarget));

  return picked.slice(0, count);
}

export function renderTopicExamples(examples: TopicExample[]): string {
  return examples
    .map((e, i) => {
      const paradigm = e.paradigm === 'engineering' ? '工程/跨学科' : '科学探究';
      const observable = e.dependentVariable ?? '作品表现或现象变化';
      const translation = e.engineeringTranslation ? `；工程转探究参考：${e.engineeringTranslation}` : '';
      return `${i + 1}. 【${paradigm}转化模式】来源主题「${e.sourceTitle}」可提取特征：${inferRetainedFeature(e)}；课堂代理可从「${e.independentVariable}」入手；观察方向：${observable}${translation}`;
    })
    .join('\n');
}
