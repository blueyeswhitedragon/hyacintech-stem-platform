/**
 * 从国家智慧教育平台公开 API 采集 STEM 选题素材，生成 data/topic-library.json。
 *
 * 用法：npx tsx scripts/harvest-smartedu.ts
 *
 * 数据来源：
 * 1. x-search.ykt.eduyun.cn 搜索 API：偏科学探究/控制变量实验
 * 2. basic.smartedu.cn 科技教育频道 CDN：偏工程实践/跨学科项目
 */

import { writeFile } from 'fs/promises';
import path from 'path';

const APP_ID = 'e5649925-441d-4a53-b525-51a2f1c4e0a8';
const SEARCH_URL = 'https://x-search.ykt.eduyun.cn/v1/resources/combine/search';
const CHANNEL_ID = '3303d351-a43f-4580-9a43-58a929595fda';
const SECTION_HASH = '229c170fd24d459901894ffdd2a5c350f1246827be6f541ba6caf641133168cc';
const CHANNEL_BASE = `https://s-file-1.ykt.cbern.com.cn/zxx/api/zh-CN/${APP_ID}/auxo_channel_api/v2/channels/${CHANNEL_ID}/sections/${SECTION_HASH}`;

const SEARCH_KEYWORDS = [
  '初中科学实验探究',
  '控制变量实验',
  '探究影响因素',
  '初中物理实验',
  '初中化学实验',
  '初中生物实验',
  '植物生长实验',
  '蒸发快慢影响因素',
  '电磁铁磁性强弱',
  '结构稳定性探究',
  '纸飞机飞行距离',
  '自制净水器',
  '生活中的科学实验',
  '实验教学 科学探究',
  '自变量 因变量',
];

const TECHNOLOGY_FILE_PAGES = [4, 5, 6, 7];

const SUBJECTS = ['物理', '化学', '生物', '科学', '地理', '劳动', '信息科技', '人工智能', '综合实践'];
const UNSAFE = ['浓硫酸', '硫酸', '盐酸', '强酸', '强碱', '高压', '220V', '解剖', '活体', '细菌培养', '病毒', '爆炸', '放射性'];
const BAD_TITLE = /实验教学|科学探究学习|课题\d|PPT|pptx|_\d|实验课|课堂实录|教学设计|说课|练习|应该采取的操作|选择题|试题|^[\s\-—]*实验[\s\-—]*$/;
const ENGINEERING_HINTS = ['制作', '设计', '装置', '工程', '机器人', '太阳能', '净水器', '模型', '系统', '结构', '创客', '人工智能'];
const INQUIRY_HINTS = ['影响', '探究', '实验', '比较', '观察', '测量', '因素', '变化', '效果'];

interface RawSource {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  source: 'search' | 'technologyEdu';
  url?: string;
  resourceType?: string;
}

interface TopicExample {
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
  source: {
    platform: 'basic.smartedu.cn';
    api: 'search' | 'technologyEdu';
    resourceId: string;
    url?: string;
  };
}

interface TopicLibrary {
  generatedAt: string;
  source: string;
  stats: {
    rawCount: number;
    topicCount: number;
    inquiryCount: number;
    engineeringCount: number;
  };
  examples: TopicExample[];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagsOf(item: unknown): string[] {
  const obj = item as { tags?: unknown };
  if (!Array.isArray(obj.tags)) return [];
  return obj.tags
    .map((t) => (typeof t === 'object' && t && 'title' in t ? String((t as { title?: unknown }).title ?? '') : ''))
    .filter(Boolean);
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function subjectTags(tags: string[], text: string): string[] {
  const found = new Set<string>();
  for (const s of SUBJECTS) {
    if (tags.some((t) => t.includes(s)) || text.includes(s)) found.add(s);
  }
  if (tags.some((t) => t.includes('初中'))) found.add('初中');
  return [...found].slice(0, 5);
}

function guessGradeBand(tags: string[], description?: string): string {
  const text = `${tags.join(' ')} ${description ?? ''}`;
  if (/初中|七年级|八年级|九年级/.test(text)) return '初中';
  if (/小学|1-2年级|3-4年级|5-6年级/.test(text)) return '小学高年级/初中可改造';
  if (/高中/.test(text)) return '高中素材（需降阶改造）';
  return '初中可改造';
}

function classify(raw: RawSource): 'inquiry' | 'engineering' {
  const text = `${raw.title} ${raw.description ?? ''} ${raw.tags.join(' ')}`;
  const engineeringScore = ENGINEERING_HINTS.filter((w) => text.includes(w)).length;
  const inquiryScore = INQUIRY_HINTS.filter((w) => text.includes(w)).length;
  if (raw.tags.some((t) => /工程实践|人文科技|人工智能|创客|触摸科技/.test(t))) return 'engineering';
  return engineeringScore > inquiryScore ? 'engineering' : 'inquiry';
}

function normalizeTopicTitle(title: string, paradigm: 'inquiry' | 'engineering'): string {
  const clean = stripHtml(title)
    .replace(/^(课件|视频|教学设计|课堂实录)[-—：:\s]*/, '')
    .replace(/^[-—\s]*/, '')
    .replace(/^\d+(\.\d+)?\s*/, '')
    .replace(/第\d+课[:：]?/g, '')
    .replace(/视频|课件|教学设计|课堂实录/g, '')
    .trim();
  if (paradigm === 'engineering') return clean;
  if (/影响|探究|比较|效果|变化/.test(clean)) return clean;
  return `探究「${clean}」中的影响因素`;
}

function inferVariables(raw: RawSource, paradigm: 'inquiry' | 'engineering'): Pick<TopicExample, 'questionStem' | 'independentVariable' | 'dependentVariable' | 'engineeringTranslation'> {
  const title = normalizeTopicTitle(raw.title, paradigm);

  const special: Array<[RegExp, Pick<TopicExample, 'questionStem' | 'independentVariable' | 'dependentVariable' | 'engineeringTranslation'>]> = [
    [/植物|绿豆|种子|发芽/, {
      questionStem: '不同光照/水量/温度条件是否会影响植物生长或种子发芽情况？',
      independentVariable: '光照时长、水量或环境温度（三选一）',
      dependentVariable: '发芽数、株高或叶片数量',
    }],
    [/净水|过滤/, {
      questionStem: '不同过滤材料或过滤层数会怎样影响自制净水器的过滤效果？',
      independentVariable: '过滤材料种类或过滤层数',
      dependentVariable: '过滤后水的浑浊程度/颜色变化',
      engineeringTranslation: '把“做一个净水器”转化为“改变过滤材料/层数，比较过滤效果”的探究问题。',
    }],
    [/纸飞机|飞行/, {
      questionStem: '不同机翼形状或折叠方式会怎样影响纸飞机飞行距离？',
      independentVariable: '机翼形状或折叠方式',
      dependentVariable: '飞行距离',
      engineeringTranslation: '把“做飞得远的纸飞机”转化为“改变一个设计参数，测试飞行距离”。',
    }],
    [/太阳能/, {
      questionStem: '不同受光面积或材料颜色会怎样影响太阳能装置的工作效果？',
      independentVariable: '受光面积、材料颜色或摆放角度（三选一）',
      dependentVariable: '加热速度、净水量或输出效果',
      engineeringTranslation: '把“制作太阳能装置”转化为“改变受光面积/角度，比较装置表现”。',
    }],
    [/机器人|自动|人工智能|系统/, {
      questionStem: '不同传感器阈值或结构参数会怎样影响自动装置的稳定性和准确性？',
      independentVariable: '传感器阈值、结构参数或程序规则（三选一）',
      dependentVariable: '成功率、响应时间或误判次数',
      engineeringTranslation: '把“做一个自动装置”转化为“改变一个可调参数，测试装置表现”。',
    }],
    [/桥|结构|承重|模型/, {
      questionStem: '不同结构形状会怎样影响模型的承重能力？',
      independentVariable: '结构形状或支撑方式',
      dependentVariable: '最大承重质量',
      engineeringTranslation: '把“搭一个更结实的结构”转化为“改变结构形状，测量承重能力”。',
    }],
    [/发酵|酵母/, {
      questionStem: '不同温度或糖量会怎样影响酵母发酵速度？',
      independentVariable: '温度或糖量',
      dependentVariable: '气泡量、膨胀高度或发酵时间',
    }],
    [/食物|保存|变质/, {
      questionStem: '不同保存温度会怎样影响食物变质速度？',
      independentVariable: '保存温度',
      dependentVariable: '气味、颜色或变质时间',
    }],
  ];

  const text = `${raw.title} ${raw.description ?? ''} ${raw.tags.join(' ')}`;
  for (const [re, vars] of special) {
    if (re.test(text)) return vars;
  }

  if (paradigm === 'engineering') {
    return {
      questionStem: `围绕「${title}」，改变一个设计参数会怎样影响作品表现？`,
      independentVariable: '一个可调的设计参数（材料、尺寸、角度、程序阈值等）',
      dependentVariable: '作品表现指标（成功率、距离、速度、稳定性等）',
      engineeringTranslation: '工程制作类主题需要先拆成一个可改变的设计参数，再用测试数据比较效果。',
    };
  }

  return {
    questionStem: `围绕「${title}」，改变一个条件会怎样影响观察结果？`,
    independentVariable: '一个可人为改变的条件',
    dependentVariable: '可观察或可测量的结果',
  };
}

function toTopic(raw: RawSource, index: number): TopicExample | null {
  const text = `${raw.title} ${raw.description ?? ''} ${raw.tags.join(' ')}`;
  if (includesAny(text, UNSAFE)) return null;
  if (!raw.title || raw.title.length < 4 || BAD_TITLE.test(raw.title) || raw.resourceType === 'questions') return null;

  const paradigm = classify(raw);
  const vars = inferVariables(raw, paradigm);
  const tags = subjectTags(raw.tags, text);
  const title = normalizeTopicTitle(raw.title, paradigm);

  return {
    id: `smartedu-${String(index + 1).padStart(4, '0')}`,
    paradigm,
    title,
    sourceTitle: stripHtml(raw.title),
    subjectTags: tags.length ? tags : ['STEM'],
    gradeBand: guessGradeBand(raw.tags, raw.description),
    ...vars,
    safetyNote: '优先选择低风险、材料易得、可在教师指导下完成的方案。',
    source: {
      platform: 'basic.smartedu.cn',
      api: raw.source,
      resourceId: raw.id,
      url: raw.url,
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'sdp-app-id': APP_ID,
      'Origin': 'https://basic.smartedu.cn',
      'Referer': 'https://basic.smartedu.cn/',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function harvestSearch(): Promise<RawSource[]> {
  const out: RawSource[] = [];
  for (const keyword of SEARCH_KEYWORDS) {
    const body = {
      keyword,
      tab_codes: ['sedu', 'prepareLesson', 'qualityCourse', 'technologyEdu'],
      cross_tenant: true,
      duplicate_filter: true,
      search_order: { field: '_score', direction: 'desc' },
      offset: 0,
      limit: 20,
      combine_intentions: [],
      combine_resources: [],
    };
    const data = await fetchJson(SEARCH_URL, { method: 'POST', body: JSON.stringify(body) }) as { items?: unknown[] };
    for (const item of data.items ?? []) {
      const obj = item as Record<string, unknown>;
      out.push({
        id: String(obj.resource_id ?? obj.src_content_id ?? obj.id ?? `${keyword}-${out.length}`),
        title: stripHtml(String(obj.title ?? '')),
        description: obj.description ? stripHtml(String(obj.description)) : undefined,
        tags: tagsOf(obj),
        source: 'search',
        resourceType: String(obj.resource_type ?? obj.search_resource_type ?? ''),
      });
    }
    console.log(`search ${keyword}: +${data.items?.length ?? 0}`);
  }
  return out;
}

async function harvestTechnologyEdu(): Promise<RawSource[]> {
  const out: RawSource[] = [];
  for (const page of TECHNOLOGY_FILE_PAGES) {
    const url = `${CHANNEL_BASE}/files/${page}.json`;
    const data = await fetchJson(url, { method: 'GET' }) as { items?: unknown[] };
    for (const item of data.items ?? []) {
      const obj = item as Record<string, unknown>;
      out.push({
        id: String(obj.unit_id ?? obj.id ?? `technology-${page}-${out.length}`),
        title: stripHtml(String(obj.title ?? '')),
        description: obj.description ? stripHtml(String(obj.description)) : undefined,
        tags: tagsOf(obj),
        source: 'technologyEdu',
        url,
        resourceType: String(obj.resource_type ?? obj.type ?? ''),
      });
    }
    console.log(`technologyEdu files/${page}.json: +${data.items?.length ?? 0}`);
  }
  return out;
}

function dedupe(raw: RawSource[]): RawSource[] {
  const seen = new Set<string>();
  const out: RawSource[] = [];
  for (const item of raw) {
    const key = stripHtml(item.title).replace(/\s/g, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function main() {
  const raw = dedupe([...(await harvestSearch()), ...(await harvestTechnologyEdu())]);
  const examples = raw
    .map((item, i) => toTopic(item, i))
    .filter((x): x is TopicExample => !!x)
    .slice(0, 120);

  const library: TopicLibrary = {
    generatedAt: new Date().toISOString(),
    source: 'basic.smartedu.cn public APIs (x-search + technologyEdu channel CDN)',
    stats: {
      rawCount: raw.length,
      topicCount: examples.length,
      inquiryCount: examples.filter((e) => e.paradigm === 'inquiry').length,
      engineeringCount: examples.filter((e) => e.paradigm === 'engineering').length,
    },
    examples,
  };

  const outPath = path.join(process.cwd(), 'data/topic-library.json');
  await writeFile(outPath, JSON.stringify(library, null, 2), 'utf8');
  console.log(`\nWrote ${outPath}`);
  console.log(library.stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
