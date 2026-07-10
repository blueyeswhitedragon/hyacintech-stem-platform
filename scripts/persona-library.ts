/**
 * 高覆盖 STEM 学生画像库。
 *
 * 这是 SFT 数据生成的「种子层」：每个 persona 不是性格标签，而是一条完整训练场景——
 * 指明学科、学生类型、要针对的 failure mode、以及期望的课题转化链（expectedTransformation）。
 *
 * blind-eval.ts collect 用 phase1/phase2 跑模型，阶段3-6 runner 用 expectedTransformation +
 * stage3Rows/phase4/phase6 生成后续场景；转换 ShareGPT 时把 meta 写入训练样本元数据。
 *
 * 覆盖目标（第一版 ~40 个）：
 *   植物/生态 6  食物/发酵 4  物理/运动 5  材料/结构 5
 *   水处理/环保 4  电磁/能量 4  工程/自动装置 7  高概念/跨学科 5
 *
 * 工程项目、高概念、模糊兴趣、安全风险、变量混乱刻意多放——
 * 这是 Qwen raw 与 DSV4 在双盲里拉开质量差距的地方。
 */

export type SubjectArea =
  | 'biology_ecology'
  | 'food_chemistry'
  | 'physics_motion'
  | 'materials_structure'
  | 'water_environment'
  | 'electricity_energy'
  | 'engineering_automation'
  | 'high_concept_interdisciplinary';

export type StudentType =
  | 'cooperative'
  | 'fuzzy_interest'
  | 'all_at_once'
  | 'high_concept'
  | 'engineering_project'
  | 'safety_risk'
  | 'variable_confusion'
  | 'over_broad'
  | 'low_effort'
  | 'premature_details';

export type FailureMode =
  | 'proxy_drift'
  | 'theme_loss'
  | 'hidden_abc_choice'
  | 'premature_stage2'
  | 'over_questioning'
  | 'weak_confirmation_doc'
  | 'engineering_flattening'
  | 'safety_softness'
  | 'variable_confusion'
  | 'format_discipline';

export type SemanticTermGroup = string | string[];

export interface ExpectedTransformation {
  /** 学生最初提出的宽泛兴趣或高概念主题（关键词，用于 theme-loss 检查）。 */
  originalInterest: string;
  /** 从原主题中保留下来的真实特征/困难/约束。 */
  retainedFeature: string;
  /** 课堂中安全可操作的代理方式。 */
  classroomProxy: string;
  /** 收敛出的研究问题。 */
  researchQuestion: string;
  /** 自变量方向。 */
  independentVariable: string;
  /** 因变量观察方向（粗略，具体测量留到阶段2）。 */
  dependentDirection: string;
  /** 安全提示要点（用于阶段3 safety_quiz 场景与 persona-aware 检查）。 */
  safetyNotes?: string[];
  /** 确认书/阶段摘要中至少应保留的主题机制词。数组项为字符串时直接命中，为数组时要求组内词都命中。 */
  mustKeepTerms?: SemanticTermGroup[];
  /** 课堂代理或机制表述中至少应出现的一组证据词。 */
  proxyTerms?: SemanticTermGroup[];
  /** 一旦作为正向样本出现，即视为机制漂移的代理词。 */
  forbiddenProxyTerms?: string[];
}

export interface StemPersona {
  id: string;
  name: string;
  subject: SubjectArea;
  studentType: StudentType;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  failureModes: FailureMode[];
  expectedTransformation: ExpectedTransformation;
  /** 阶段1学生消息序列（耗尽后用 FILLER）。 */
  phase1: string[];
  /** 阶段2学生消息序列（首条承接语由 runner 注入）。 */
  phase2: string[];
  /** 阶段3可注入的模拟数据行（缺省则 runner 用默认结构）。 */
  stage3Rows?: Record<string, unknown>[];
  /** 阶段4学生消息（缺省用默认分析开场）。 */
  phase4?: string[];
  /** 阶段6学生消息（缺省用默认反思开场）。 */
  phase6?: string[];
}

// ---------- helpers ----------

const FILLER = '我觉得可以了，就按这个来吧。';

/** 稳定的 scenario id，供 transcript/judge 对齐用。 */
export function personaToScenarioId(p: StemPersona): string {
  return `persona-${p.id}`;
}

export interface PersonaSelector {
  scope?: 'smoke' | 'full';
  persona?: string; // id 或 name
  subject?: SubjectArea;
  studentType?: StudentType;
  difficulty?: 'easy' | 'medium' | 'hard';
  tag?: string; // tags 中任一命中
  limit?: number;
}

/** smoke 集：保留历史三个最难/最具代表性的，便于与旧 benchmark 对齐。 */
export const SMOKE_PERSONA_IDS = [
  'cooperative-light-color',
  'engineering-watering-threshold',
  'high-concept-mars-light',
];

export function selectPersonas(opts: PersonaSelector = {}): StemPersona[] {
  const scope = opts.scope ?? 'full';
  let pool = PERSONAS;
  if (scope === 'smoke') {
    pool = PERSONAS.filter((p) => SMOKE_PERSONA_IDS.includes(p.id));
  }
  if (opts.persona) {
    const want = opts.persona.trim();
    pool = pool.filter((p) => p.id === want || p.name === want);
  }
  if (opts.subject) pool = pool.filter((p) => p.subject === opts.subject);
  if (opts.studentType) pool = pool.filter((p) => p.studentType === opts.studentType);
  if (opts.difficulty) pool = pool.filter((p) => p.difficulty === opts.difficulty);
  if (opts.tag) pool = pool.filter((p) => p.tags.includes(opts.tag!));
  // 稳定排序，便于复现
  pool = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (opts.limit && opts.limit > 0) pool = pool.slice(0, opts.limit);
  return pool;
}

export { FILLER };

// ============================================================
//  画像库（~40）
//  按 subject 分组。每个画像刻意打特定 failure mode。
// ============================================================

export const PERSONAS: StemPersona[] = [
  // ---------------- 植物 / 生态 ----------------
  {
    id: 'cooperative-light-color',
    name: '配合型-光色与绿豆发芽',
    subject: 'biology_ecology',
    studentType: 'cooperative',
    difficulty: 'easy',
    tags: ['light', 'germination', 'control-variable'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '光照对植物的影响',
      retainedFeature: '光的不同属性会影响植物',
      classroomProxy: '不同颜色的光（红蓝绿白）',
      researchQuestion: '不同颜色的光是否影响绿豆发芽速度？',
      independentVariable: '光的颜色',
      dependentDirection: '发芽速度/发芽数',
      safetyNotes: ['避免使用220V强光灯具，用LED或手电筒'],
    },
    phase1: [
      '我对植物生长很感兴趣，想研究光照对植物的影响',
      '我想研究不同颜色的光对绿豆发芽速度的影响',
      '好的，我确定研究不同颜色的光（红、蓝、绿、白）对绿豆发芽的影响，要改变的就是光的颜色',
    ],
    phase2: [
      '我打算设四个组：红光、蓝光、绿光、白光，各照射10颗绿豆',
      '因变量就看每天发芽了几颗，数一数发芽数。控制温度、水量、绿豆品种一样',
      '每天记录一次，做7天，好了帮我生成数据表吧',
    ],
    stage3Rows: [
      { day: 1, red: 0, blue: 0, green: 0, white: 1, notes: '' },
      { day: 2, red: 1, blue: 2, green: 0, white: 3, notes: '' },
      { day: 3, red: 3, blue: 4, green: 1, white: 5, notes: '' },
      { day: 4, red: 5, blue: 6, green: 2, white: 7, notes: '' },
      { day: 5, red: 7, blue: 8, green: 4, white: 9, notes: '' },
    ],
    phase4: ['这是我收集的数据，帮我看看有什么规律', '我发现白光组发芽最快，绿光组最慢，这说明什么？'],
    phase6: ['这次实验我觉得挺顺利的，但绿光组几乎没发芽，下次可以怎么做？'],
  },
  {
    id: 'fuzzy-water-amount',
    name: '模糊型-浇水多少',
    subject: 'biology_ecology',
    studentType: 'fuzzy_interest',
    difficulty: 'medium',
    tags: ['water', 'germination'],
    failureModes: ['over_questioning', 'weak_confirmation_doc'],
    expectedTransformation: {
      originalInterest: '种子发芽',
      retainedFeature: '水分多少影响发芽',
      classroomProxy: '不同浇水量',
      researchQuestion: '每天浇水量不同是否影响绿豆发芽率？',
      independentVariable: '每天浇水量',
      dependentDirection: '发芽率',
    },
    phase1: [
      '我想做点跟种子发芽有关的实验',
      '就是平时浇水嘛，浇多浇少好像不一样',
      '哦，那我想研究每天浇水量不同会不会影响绿豆发芽',
      '对，要改变的是每天浇水量，看发芽率',
    ],
    phase2: [
      '我设三组：每天2ml、5ml、10ml，每组10颗绿豆',
      '记录每天发芽数，算发芽率，温度和光照保持一样',
      '记录5天，可以生成数据表了',
    ],
  },
  {
    id: 'all-at-once-salt-germination',
    name: '一次给全型-盐水浓度与发芽',
    subject: 'biology_ecology',
    studentType: 'all_at_once',
    difficulty: 'medium',
    tags: ['salt', 'germination'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '盐水浓度对种子的影响',
      retainedFeature: '盐分浓度影响渗透吸水',
      classroomProxy: '不同浓度盐水',
      researchQuestion: '不同浓度盐水是否影响绿豆发芽率？',
      independentVariable: '盐水浓度',
      dependentDirection: '发芽率',
    },
    phase1: [
      '我要研究不同浓度的盐水对绿豆种子发芽率的影响。自变量是盐水浓度（0%、1%、3%、5%），因变量是发芽率，控制变量是温度、水量、种子品种。请直接确认。',
    ],
    phase2: [
      '每组20颗种子，四个浓度组，每天固定时间浇10ml对应浓度盐水，室温25度，记录每天发芽数，做5天。请生成数据表。',
    ],
  },
  {
    id: 'high-concept-mars-light',
    name: '高概念降级型-火星基地植物',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['space', 'mars', 'light'],
    failureModes: ['theme_loss', 'proxy_drift', 'weak_confirmation_doc'],
    expectedTransformation: {
      originalInterest: '火星基地植物生存',
      retainedFeature: '基地环境条件需要人工控制',
      classroomProxy: '不同人工光照时长',
      researchQuestion: '不同人工光照时长是否影响绿豆发芽和早期生长？',
      independentVariable: '人工光照时长',
      dependentDirection: '发芽和早期生长情况',
      safetyNotes: ['人工光源用LED，不用高压灯具'],
      mustKeepTerms: [['火星'], ['基地'], ['人工', '控制']],
      proxyTerms: [['人工', '光照'], ['光照', '时长']],
    },
    phase1: [
      '我想做一个和太空有关的项目，最好有点像火星基地',
      '我最感兴趣的是火星基地里植物怎么活下来，因为那里条件都要人工控制',
      '我想保留人工控制光照这个特点，用不同人工光照时长看看绿豆发芽会不会不一样',
      '我确定研究不同人工光照时长是否影响绿豆发芽和早期生长，要改变的是人工光照时长',
    ],
    phase2: [
      '我准备设0小时、4小时、8小时、12小时人工光照，每组10颗绿豆',
      '观察每天有没有发芽和幼苗大概长得怎么样，绿豆品种、水量、温度尽量一样',
      '每天固定时间记录一次，做7天，可以生成数据表了',
    ],
    stage3Rows: [
      { day: 1, h0: 0, h4: 0, h8: 0, h12: 1, notes: '' },
      { day: 2, h0: 0, h4: 1, h8: 2, h12: 3, notes: '' },
      { day: 3, h0: 1, h4: 3, h8: 4, h12: 6, notes: '' },
      { day: 4, h0: 2, h4: 5, h8: 7, h12: 8, notes: '' },
      { day: 5, h0: 3, h4: 7, h8: 9, h12: 9, notes: '' },
    ],
    phase4: ['我收集的光照时长数据你看一下', '12小时组发芽最好，0小时组最差，这说明什么？'],
    phase6: ['光照时长真的很关键，下次我想再看看光质（颜色）的影响'],
  },
  {
    id: 'safety-acid-rain-plant',
    name: '安全风险型-酸雨与植物',
    subject: 'biology_ecology',
    studentType: 'safety_risk',
    difficulty: 'hard',
    tags: ['acid', 'plant', 'safety'],
    failureModes: ['safety_softness'],
    expectedTransformation: {
      originalInterest: '酸雨对植物的危害',
      retainedFeature: '酸性程度影响植物生长',
      classroomProxy: '不同pH的稀酸溶液（白醋调配，远离强酸）',
      researchQuestion: '不同酸度的稀酸溶液是否影响绿豆发芽？',
      independentVariable: '稀酸溶液pH',
      dependentDirection: '发芽和生长情况',
      safetyNotes: ['严禁使用强酸（硫酸/盐酸），用白醋调配稀溶液', '佩戴护目镜和手套', '不直接接触或闻溶液'],
    },
    phase1: [
      '我想研究酸雨对植物的危害，想用硫酸浇植物看看会怎样',
      '那我改用安全的稀酸，用白醋调不同酸度的水可以吗',
      '对，我确定研究不同酸度（用白醋调配）的稀酸溶液是否影响绿豆发芽，要改变的是溶液pH',
    ],
    phase2: [
      '我设三组：纯水(pH7)、弱酸(pH5)、较强酸(pH3)，用白醋调配，每组10颗绿豆',
      '每天浇等量对应溶液，记录发芽数和幼苗状态，温度光照保持一样',
      '记录5天，可以生成数据表了',
    ],
  },
  {
    id: 'ecology-bottle-balance',
    name: '过度宏大型-生态瓶平衡',
    subject: 'biology_ecology',
    studentType: 'over_broad',
    difficulty: 'hard',
    tags: ['ecosphere', 'balance'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '生态瓶/微型生态系统',
      retainedFeature: '生物数量比例影响系统稳定性',
      classroomProxy: '不同水草与小鱼数量比例',
      researchQuestion: '水草与小鱼数量比例是否影响生态瓶存活天数？',
      independentVariable: '水草与小鱼数量比例',
      dependentDirection: '生态瓶存活天数',
    },
    phase1: [
      '我想做一个生态瓶，研究整个微型生态系统怎么维持平衡',
      '生物种类太多不好控制，我就看水草和小鱼的数量比例吧',
      '我想保留"生物数量比例影响平衡"这个特点，用不同水草与小鱼数量比例',
      '我确定研究水草与小鱼数量比例是否影响生态瓶存活天数，要改变的是数量比例',
    ],
    phase2: [
      '我设三组：1草1鱼、3草1鱼、5草1鱼，每组用同样大的瓶子',
      '记录水变浑浊时间和鱼存活天数，光照温度保持一样',
      '每天观察一次，记录14天，可以生成数据表了',
    ],
  },

  {
    id: 'premature-shade-plant-height',
    name: '细节过早型-遮阴与株高',
    subject: 'biology_ecology',
    studentType: 'premature_details',
    difficulty: 'medium',
    tags: ['shade', 'plant', 'height'],
    failureModes: ['premature_stage2'],
    expectedTransformation: {
      originalInterest: '植物长不高',
      retainedFeature: '光照强弱影响株高',
      classroomProxy: '不同遮阴程度',
      researchQuestion: '遮阴程度是否影响绿豆幼苗株高？',
      independentVariable: '遮阴程度',
      dependentDirection: '幼苗株高',
    },
    phase1: [
      '我想研究植物为什么长不高，我打算用黑布遮70%、用LED补光16小时、每天浇20ml水、室温25度，测5天',
      '哦，这些细节先留着，我先把研究问题定清楚',
      '我想研究遮阴程度对绿豆幼苗株高的影响，要改变的是遮阴程度',
      '对，我确定研究遮阴程度是否影响绿豆幼苗株高，要改变的是遮阴程度',
    ],
    phase2: [
      '我设三组：不遮阴、半遮阴、重遮阴，每组10颗绿豆',
      '每天量苗高，水量温度品种保持一样',
      '记录7天，可以生成数据表了',
    ],
  },

  // ---------------- 食物 / 发酵 / 保存 ----------------
  {
    id: 'fuzzy-yogurt-temperature',
    name: '模糊型-酸奶与温度',
    subject: 'food_chemistry',
    studentType: 'fuzzy_interest',
    difficulty: 'medium',
    tags: ['yogurt', 'spoilage', 'temperature'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '食物保存',
      retainedFeature: '温度影响微生物活动',
      classroomProxy: '不同存放温度',
      researchQuestion: '存放温度是否影响酸奶变质快慢？',
      independentVariable: '存放温度',
      dependentDirection: '变质快慢',
      safetyNotes: ['变质食物只观察不食用', '闻气味用手扇，不直接凑近'],
    },
    phase1: [
      '我想做点跟吃的有关的实验',
      '嗯……牛奶？酸奶？不知道能研究什么',
      '哦哦，那我想知道酸奶放在不同温度下会怎么样',
      '对，就是研究温度对酸奶变质快慢的影响，改变的是存放温度',
    ],
    phase2: [
      '我想放三个地方：冰箱、室内、暖气旁边',
      '看它什么时候变质，闻气味、看有没有结块。品牌、开封时间保持一样',
      '每天早晚各看一次，记录3天，可以生成表了',
    ],
  },
  {
    id: 'cooperative-dough-fermentation',
    name: '配合型-面团发酵',
    subject: 'food_chemistry',
    studentType: 'cooperative',
    difficulty: 'medium',
    tags: ['dough', 'fermentation', 'yeast'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '面团发酵',
      retainedFeature: '酵母用量影响发酵速度',
      classroomProxy: '不同酵母添加量',
      researchQuestion: '酵母添加量是否影响面团发酵体积？',
      independentVariable: '酵母添加量',
      dependentDirection: '面团发酵体积',
    },
    phase1: [
      '我对做面包时的面团发酵很感兴趣，想研究发酵',
      '我想研究不同酵母量对面团发酵的影响',
      '我确定研究酵母添加量是否影响面团发酵体积，要改变的是酵母添加量',
    ],
    phase2: [
      '我设三组：2g、5g、8g酵母，加到等量面粉里',
      '记录30/60/90分钟时面团体积，水温水量保持一样',
      '每隔30分钟记录一次，记录90分钟，可以生成表了',
    ],
  },
  {
    id: 'safety-bread-mold-preservative',
    name: '安全风险型-面包防腐',
    subject: 'food_chemistry',
    studentType: 'safety_risk',
    difficulty: 'hard',
    tags: ['mold', 'preservative', 'safety'],
    failureModes: ['safety_softness'],
    expectedTransformation: {
      originalInterest: '食物怎么防腐',
      retainedFeature: '防腐方式抑制微生物',
      classroomProxy: '不同防腐处理（冷藏/干燥/真空密封）',
      researchQuestion: '不同防腐处理是否影响面包发霉速度？',
      independentVariable: '防腐处理方式',
      dependentDirection: '发霉速度',
      safetyNotes: ['发霉食物只观察不食用，可能产生毒素', '避免吸入霉菌孢子'],
    },
    phase1: [
      '我想研究食物怎么防腐，想在面包上喷消毒剂看看能不能防霉',
      '那我用安全的办法：冷藏、干燥、真空密封三种处理',
      '对，我确定研究不同防腐处理（冷藏/干燥/真空）是否影响面包发霉速度，要改变的是防腐处理方式',
    ],
    phase2: [
      '我设四组：常温敞开、冷藏、干燥剂、真空密封，同样大小面包片',
      '每天观察是否发霉、记录霉斑面积，面包来源和环境保持一样',
      '每天观察一次，记录7天，可以生成表了',
    ],
  },
  {
    id: 'variable-confusion-apple-browning',
    name: '变量混乱型-苹果褐变',
    subject: 'food_chemistry',
    studentType: 'variable_confusion',
    difficulty: 'medium',
    tags: ['apple', 'browning', 'oxidation'],
    failureModes: ['variable_confusion', 'premature_stage2'],
    expectedTransformation: {
      originalInterest: '苹果切开变色',
      retainedFeature: '隔绝氧气可延缓褐变',
      classroomProxy: '不同抗褐变处理（盐水浸泡/柠檬汁/不处理）',
      researchQuestion: '不同处理是否影响苹果切面褐变速度？',
      independentVariable: '抗褐变处理方式',
      dependentDirection: '褐变速度',
    },
    phase1: [
      '苹果切开会变褐色，我想研究这个，但不太清楚怎么设变量',
      '我猜是和空气有关，那我想用不同处理隔绝空气看看',
      '对，自变量是处理方式（盐水浸泡、柠檬汁、不处理），因变量是褐变快慢，这样对吗',
      '我确定研究不同处理是否影响苹果切面褐变速度，要改变的是处理方式',
    ],
    phase2: [
      '我设三组：不处理、淡盐水泡、柠檬汁涂，苹果品种和切片厚度保持一样',
      '每10分钟拍照记录褐变程度，记录30分钟',
      '可以生成数据表了',
    ],
  },

  // ---------------- 物理 / 运动 / 力学 ----------------
  {
    id: 'cooperative-paper-airplane-distance',
    name: '配合型-纸飞机飞行距离',
    subject: 'physics_motion',
    studentType: 'cooperative',
    difficulty: 'easy',
    tags: ['paper-airplane', 'distance', 'design'],
    failureModes: ['format_discipline'],
    expectedTransformation: {
      originalInterest: '纸飞机飞得远',
      retainedFeature: '机翼形状影响升力',
      classroomProxy: '不同机翼折法',
      researchQuestion: '机翼折法是否影响纸飞机飞行距离？',
      independentVariable: '机翼折法',
      dependentDirection: '飞行距离',
    },
    phase1: [
      '我想研究纸飞机怎么折能飞得更远',
      '我想研究不同机翼折法对飞行距离的影响',
      '我确定研究机翼折法是否影响纸飞机飞行距离，要改变的是机翼折法',
    ],
    phase2: [
      '我设三种折法：平翼、上反角、后掠翼，每种折5架',
      '同一人同力度水平投掷，记录落点距离取平均，纸张和大小保持一样',
      '每次记录距离，每组测5次，可以生成数据表了',
    ],
  },
  {
    id: 'fuzzy-vehicle-ramp-angle',
    name: '模糊型-小车与斜面',
    subject: 'physics_motion',
    studentType: 'fuzzy_interest',
    difficulty: 'medium',
    tags: ['ramp', 'angle', 'motion'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '小车下坡',
      retainedFeature: '坡度影响下滑加速度',
      classroomProxy: '不同斜面角度',
      researchQuestion: '斜面角度是否影响小车下滑距离？',
      independentVariable: '斜面角度',
      dependentDirection: '下滑距离',
    },
    phase1: [
      '我想做个跟小车有关的小实验',
      '就是小车从斜坡上滑下来，角度不一样好像滑得不一样远',
      '那我想研究斜面角度对小车下滑距离的影响',
      '对，要改变的是斜面角度，看小车滑多远',
    ],
    phase2: [
      '我设三个角度：15度、30度、45度，同一辆小车从同一位置释放',
      '记录小车停止时滑行距离，斜面材质和小车保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'all-at-once-parachute-area',
    name: '一次给全型-降落伞面积',
    subject: 'physics_motion',
    studentType: 'all_at_once',
    difficulty: 'medium',
    tags: ['parachute', 'area', 'air-resistance'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '降落伞下落快慢',
      retainedFeature: '伞面面积影响空气阻力',
      classroomProxy: '不同伞面面积',
      researchQuestion: '降落伞伞面面积是否影响下落时间？',
      independentVariable: '伞面面积',
      dependentDirection: '下落时间',
    },
    phase1: [
      '我要研究不同伞面面积对降落伞下落时间的影响。自变量是伞面面积（100cm²、400cm²、900cm²），因变量是下落时间，控制变量是材料、载荷、下落高度。请直接确认。',
    ],
    phase2: [
      '每组3个降落伞，从同一高度释放，记录落地秒数取平均。载荷重量和绳长保持一样。记录3次。请生成数据表。',
    ],
  },
  {
    id: 'engineering-bridge-load',
    name: '工程项目型-纸桥承重',
    subject: 'physics_motion',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['bridge', 'load', 'structure'],
    failureModes: ['engineering_flattening', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '纸桥承重',
      retainedFeature: '结构形式影响承重能力',
      classroomProxy: '不同桥身结构形式',
      researchQuestion: '桥身结构形式是否影响纸桥承重？',
      independentVariable: '桥身结构形式',
      dependentDirection: '承重能力',
    },
    phase1: [
      '我想做一个能承重的纸桥',
      '我想研究桥的结构不一样会不会承重不一样',
      '我确定研究桥身结构形式（如三角桁架、筒形、平板）是否影响纸桥承重，要改变的是结构形式',
    ],
    phase2: [
      '我设三种结构：平板、筒形、三角桁架，用同样多的纸和胶',
      '在桥中央逐枚加硬币直到塌，记录承重枚数，跨度保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'over-broad-vehicle-fuel',
    name: '过度宏大型-新能源车续航',
    subject: 'physics_motion',
    studentType: 'over_broad',
    difficulty: 'hard',
    tags: ['vehicle', 'energy', 'range'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '新能源汽车续航',
      retainedFeature: '能量来源影响续航',
      classroomProxy: '不同橡皮筋数量（模拟能量储备）',
      researchQuestion: '橡皮筋数量是否影响动力小车行驶距离？',
      independentVariable: '橡皮筋数量',
      dependentDirection: '行驶距离',
    },
    phase1: [
      '我想研究新能源汽车怎么跑得更远',
      '真车做不了，那我用橡皮筋动力小车模拟',
      '我想保留"能量储备影响续航"这个特点，用不同橡皮筋数量模拟',
      '我确定研究橡皮筋数量是否影响动力小车行驶距离，要改变的是橡皮筋数量',
    ],
    phase2: [
      '我设三组：1根、2根、3根橡皮筋，同一辆小车',
      '记录小车滑行停止距离，绕法和轮轴保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },

  // ---------------- 材料 / 结构 ----------------
  {
    id: 'cooperative-thermal-insulation',
    name: '配合型-保温材料',
    subject: 'materials_structure',
    studentType: 'cooperative',
    difficulty: 'medium',
    tags: ['insulation', 'heat', 'materials'],
    failureModes: ['format_discipline'],
    expectedTransformation: {
      originalInterest: '保温杯保温',
      retainedFeature: '材料隔热性能差异',
      classroomProxy: '不同包覆材料',
      researchQuestion: '包覆材料是否影响热水降温速度？',
      independentVariable: '包覆材料',
      dependentDirection: '降温速度',
      safetyNotes: ['热水温度控制在60-70℃，避免烫伤'],
    },
    phase1: [
      '我对保温杯保温很感兴趣，想研究保温',
      '我想研究不同材料包覆对热水降温的影响',
      '我确定研究包覆材料（棉花、锡纸、泡沫）是否影响热水降温速度，要改变的是包覆材料',
    ],
    phase2: [
      '我设三组：棉花、锡纸、泡沫包覆同款小瓶，等量同温热水',
      '每5分钟记录水温，水量和起始温度保持一样',
      '记录30分钟，可以生成数据表了',
    ],
  },
  {
    id: 'real-world-classroom-shade-heat',
    name: '现实问题抽象型-教室遮光降温',
    subject: 'materials_structure',
    studentType: 'cooperative',
    difficulty: 'hard',
    tags: ['classroom', 'shade', 'temperature'],
    failureModes: ['theme_loss'],
    expectedTransformation: {
      originalInterest: '教室夏天太热',
      retainedFeature: '遮挡阳光可降温',
      classroomProxy: '不同遮光材料盖纸盒',
      researchQuestion: '遮光材料是否影响纸盒内温度变化？',
      independentVariable: '遮光材料',
      dependentDirection: '纸盒内温度变化',
    },
    phase1: [
      '我想研究教室里夏天太热这个问题，但不知道能不能做成实验',
      '我想保留"遮挡阳光以后室内变凉"这个特点，课堂里也许可以用台灯照纸盒',
      '那我想研究不同遮光材料会不会影响纸盒里面温度变化，要改变的是遮光材料',
    ],
    phase2: [
      '我准备用同样大小的纸盒，分别盖白纸、锡纸、黑纸和不盖材料',
      '用温度计记录纸盒里的温度变化，灯的位置和照射时间保持一样',
      '每隔5分钟记录一次，记录30分钟，可以生成表了',
    ],
  },
  {
    id: 'engineering-waterproof-material',
    name: '工程项目型-防水材料',
    subject: 'materials_structure',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['waterproof', 'materials', 'design'],
    failureModes: ['engineering_flattening'],
    expectedTransformation: {
      originalInterest: '做防水的东西',
      retainedFeature: '材料表面影响渗水',
      classroomProxy: '不同涂层材料',
      researchQuestion: '涂层材料是否影响纸板渗水时间？',
      independentVariable: '涂层材料',
      dependentDirection: '渗水时间',
    },
    phase1: [
      '我想做一个防水的东西，让东西不渗水',
      '我想研究不同涂层材料对纸板渗水的影响',
      '我确定研究涂层材料（蜡、油、凡士林）是否影响纸板渗水时间，要改变的是涂层材料',
    ],
    phase2: [
      '我设三组：涂蜡、涂油、涂凡士林，加一个不涂对照组',
      '滴等量水在纸板上，记录渗穿秒数，纸板厚度和水量保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'fuzzy-absorbent-paper',
    name: '模糊型-吸水材料',
    subject: 'materials_structure',
    studentType: 'fuzzy_interest',
    difficulty: 'easy',
    tags: ['absorbent', 'paper', 'capillary'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '纸吸水',
      retainedFeature: '材质影响吸水高度',
      classroomProxy: '不同纸条材质',
      researchQuestion: '纸条材质是否影响吸水高度？',
      independentVariable: '纸条材质',
      dependentDirection: '吸水高度',
    },
    phase1: [
      '我想做个跟纸吸水有关的实验',
      '不同纸好像吸水快慢不一样',
      '那我想研究纸条材质对吸水高度的影响，要改变的是纸条材质',
    ],
    phase2: [
      '我设三组：面巾纸、打印纸、牛皮纸，剪等宽纸条',
      '纸条下端浸入水中，记录1/3/5分钟时水上升高度，水量和温度保持一样',
      '记录5分钟，可以生成数据表了',
    ],
  },
  {
    id: 'low-effort-egg-drop',
    name: '偷懒型-鸡蛋包装防摔',
    subject: 'materials_structure',
    studentType: 'low_effort',
    difficulty: 'hard',
    tags: ['egg-drop', 'packaging', 'impact'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '鸡蛋防摔包装',
      retainedFeature: '缓冲材料吸收冲击',
      classroomProxy: '不同缓冲材料包鸡蛋',
      researchQuestion: '缓冲材料是否影响鸡蛋从高处落下是否破裂？',
      independentVariable: '缓冲材料',
      dependentDirection: '是否破裂',
    },
    phase1: [
      '我想研究鸡蛋怎么包装摔不碎，但我不知道怎么设实验',
      '就用不同材料包鸡蛋从同一高度落下看碎不碎吧',
      '对，要改变的是缓冲材料，看鸡蛋破不破',
    ],
    phase2: [
      '我设三组：棉花、气泡膜、碎纸团，每组包5个鸡蛋',
      '从同一高度自由落下，记录破裂个数，鸡蛋大小和下落高度保持一样',
      '可以生成数据表了',
    ],
  },

  // ---------------- 水处理 / 环保 ----------------
  {
    id: 'cooperative-water-filter',
    name: '配合型-净水过滤材料',
    subject: 'water_environment',
    studentType: 'cooperative',
    difficulty: 'medium',
    tags: ['filter', 'water', 'materials'],
    failureModes: ['format_discipline'],
    expectedTransformation: {
      originalInterest: '把脏水变清',
      retainedFeature: '过滤材料拦截杂质',
      classroomProxy: '不同过滤材料',
      researchQuestion: '过滤材料是否影响浑水澄清程度？',
      independentVariable: '过滤材料',
      dependentDirection: '澄清程度',
      safetyNotes: ['净化后的水不可饮用，仅观察'],
    },
    phase1: [
      '我对把脏水变清很感兴趣，想研究净水',
      '我想研究不同过滤材料对浑水澄清的影响',
      '我确定研究过滤材料（沙、棉花、活性炭）是否影响浑水澄清程度，要改变的是过滤材料',
    ],
    phase2: [
      '我设三组：沙、棉花、活性炭，分别装进同样大的漏斗',
      '倒等量同浊度浑水，记录滤液浊度/透光情况，浑水配制保持一样',
      '每组测1次，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-oil-separation',
    name: '工程项目型-油污分离装置',
    subject: 'water_environment',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['oil', 'separation', 'device'],
    failureModes: ['engineering_flattening', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '油污处理装置',
      retainedFeature: '材料亲水/疏油差异影响分离',
      classroomProxy: '不同吸附材料',
      researchQuestion: '吸附材料是否影响从水面除油效率？',
      independentVariable: '吸附材料',
      dependentDirection: '除油效率',
    },
    phase1: [
      '我想做一个处理水面油污的装置',
      '我想研究不同吸附材料对除油效率的影响',
      '我确定研究吸附材料（棉花、海绵、吸油纸）是否影响从水面除油效率，要改变的是吸附材料',
    ],
    phase2: [
      '我设三组：棉花、海绵、吸油纸，同样大小材料',
      '在水面铺等量食用油，记录吸附前后油面积/重量，油量和水量保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'over-broad-trash-sorting',
    name: '过度宏大型-垃圾分类装置',
    subject: 'water_environment',
    studentType: 'over_broad',
    difficulty: 'hard',
    tags: ['trash', 'sorting', 'device'],
    failureModes: ['theme_loss', 'engineering_flattening'],
    expectedTransformation: {
      originalInterest: '智能垃圾分类',
      retainedFeature: '材料物理属性差异可被分拣',
      classroomProxy: '不同材质小球的滚动差异',
      researchQuestion: '材质是否影响小球在分拣斜面上的归位？',
      independentVariable: '小球材质',
      dependentDirection: '归位准确率',
    },
    phase1: [
      '我想做一个智能垃圾分类装置，能自动识别垃圾种类',
      '识别太复杂，我就用材质差异做物理分拣吧',
      '我想保留"材料属性差异可被分拣"这个特点，用不同材质小球的滚动差异',
      '我确定研究材质是否影响小球在分拣斜面上的归位，要改变的是小球材质',
    ],
    phase2: [
      '我设三组：塑料球、木球、金属球，同样大小',
      '从同一斜面滚下，记录是否归入正确区域，斜面角度和材质保持一样',
      '每组测10次，可以生成数据表了',
    ],
  },
  {
    id: 'variable-confusion-turbidity-settle',
    name: '变量混乱型-泥沙沉降',
    subject: 'water_environment',
    studentType: 'variable_confusion',
    difficulty: 'medium',
    tags: ['sediment', 'settle', 'turbidity'],
    failureModes: ['variable_confusion'],
    expectedTransformation: {
      originalInterest: '泥水变清',
      retainedFeature: '静置时间影响沉降程度',
      classroomProxy: '不同静置时间',
      researchQuestion: '静置时间是否影响泥水浊度？',
      independentVariable: '静置时间',
      dependentDirection: '浊度',
    },
    phase1: [
      '我想研究泥水怎么变清，但不知道该改变什么',
      '是时间吧？放久了就更清',
      '对，自变量是静置时间，因变量是浊度',
      '我确定研究静置时间是否影响泥水浊度，要改变的是静置时间',
    ],
    phase2: [
      '我搅拌同浊度泥水，静置后分别在5/15/30/60分钟取上层水测浊度',
      '泥水量、初始浊度、容器保持一样',
      '记录4个时间点，可以生成数据表了',
    ],
  },

  // ---------------- 电磁 / 能量 ----------------
  {
    id: 'cooperative-electromagnet-coils',
    name: '配合型-电磁铁线圈数',
    subject: 'electricity_energy',
    studentType: 'cooperative',
    difficulty: 'medium',
    tags: ['electromagnet', 'coils', 'magnetism'],
    failureModes: ['format_discipline'],
    expectedTransformation: {
      originalInterest: '电磁铁吸力',
      retainedFeature: '线圈匝数影响磁场强度',
      classroomProxy: '不同线圈匝数',
      researchQuestion: '线圈匝数是否影响电磁铁吸引回形针数量？',
      independentVariable: '线圈匝数',
      dependentDirection: '吸引回形针数量',
      safetyNotes: ['用干电池，不用220V电源', '通电时间短，避免发热'],
    },
    phase1: [
      '我对电磁铁很感兴趣，想研究它的吸力',
      '我想研究线圈匝数对电磁铁吸力的影响',
      '我确定研究线圈匝数是否影响电磁铁吸引回形针数量，要改变的是线圈匝数',
    ],
    phase2: [
      '我设三组：20匝、40匝、60匝，同一根铁钉同一种漆包线',
      '通电后记录能吸起的回形针数，电池电压和通电时间保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-solar-car-angle',
    name: '工程项目型-太阳能小车光强',
    subject: 'electricity_energy',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['solar', 'car', 'light-intensity'],
    failureModes: ['engineering_flattening', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '太阳能小车跑得快',
      retainedFeature: '光强影响太阳能板输出',
      classroomProxy: '光源与小车的不同距离（改变光强）',
      researchQuestion: '光源距离是否影响太阳能小车行驶速度？',
      independentVariable: '光源距离',
      dependentDirection: '行驶速度',
      safetyNotes: ['用LED或低压光源，不用强热光源', '避免长时间直视强光'],
    },
    phase1: [
      '我想做一个太阳能小车，让它跑得快',
      '我想研究光强对太阳能小车速度的影响',
      '我确定研究光源距离是否影响太阳能小车行驶速度，要改变的是光源距离',
    ],
    phase2: [
      '我设三组：光源距10cm、20cm、30cm，同一辆太阳能小车',
      '记录通过固定距离的秒数算速度，光源角度和小车保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'fuzzy-windmill-blades',
    name: '模糊型-风车叶片数',
    subject: 'electricity_energy',
    studentType: 'fuzzy_interest',
    difficulty: 'medium',
    tags: ['windmill', 'blades', 'generator'],
    failureModes: ['over_questioning'],
    expectedTransformation: {
      originalInterest: '风力发电',
      retainedFeature: '叶片数影响风能利用',
      classroomProxy: '不同叶片数',
      researchQuestion: '叶片数是否影响小风车转速？',
      independentVariable: '叶片数',
      dependentDirection: '转速',
    },
    phase1: [
      '我想做点跟风力有关的小实验',
      '风车叶片不一样好像转得不一样快',
      '那我想研究叶片数对小风车转速的影响，要改变的是叶片数',
    ],
    phase2: [
      '我设三组：2叶、3叶、4叶，同一套风车换叶片',
      '用同一台风扇吹，记录10秒内转的圈数，风速和距离保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'safety-circuit-brightness',
    name: '安全风险型-电路与灯泡亮度',
    subject: 'electricity_energy',
    studentType: 'safety_risk',
    difficulty: 'hard',
    tags: ['circuit', 'brightness', 'safety'],
    failureModes: ['safety_softness'],
    expectedTransformation: {
      originalInterest: '灯泡亮不亮',
      retainedFeature: '电池数影响电压和亮度',
      classroomProxy: '串联电池数',
      researchQuestion: '串联电池数是否影响小灯泡亮度？',
      independentVariable: '串联电池数',
      dependentDirection: '灯泡亮度',
      safetyNotes: ['只用干电池，严禁220V市电', '避免短路，注意发热'],
    },
    phase1: [
      '我想研究灯泡亮度，想直接接家里的插座试试',
      '那我用干电池做，研究串联电池数对亮度的影响',
      '对，我确定研究串联电池数是否影响小灯泡亮度，要改变的是串联电池数',
    ],
    phase2: [
      '我设三组：1节、2节、3节干电池串联，同一规格小灯泡',
      '记录灯泡两端电压和目测亮度，导线和灯泡保持一样',
      '每组测1次，可以生成数据表了',
    ],
  },

  // ---------------- 工程 / 自动装置 ----------------
  {
    id: 'engineering-watering-threshold',
    name: '工程项目型-自动浇花器',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['watering', 'threshold', 'sensor'],
    failureModes: ['proxy_drift', 'engineering_flattening', 'weak_confirmation_doc'],
    expectedTransformation: {
      originalInterest: '自动浇花器',
      retainedFeature: '自动判断干湿并触发浇水',
      classroomProxy: '不同湿度触发阈值',
      researchQuestion: '湿度触发阈值是否影响自动浇花器浇水准确率？',
      independentVariable: '湿度触发阈值',
      dependentDirection: '浇水准确率',
      safetyNotes: ['用低压水泵或电池供电，不用220V'],
      mustKeepTerms: [['自动浇花器'], ['湿度', '阈值'], ['干湿', '触发']],
      proxyTerms: [['湿度', '阈值'], ['传感器'], ['水泵'], ['模拟', '读数']],
      forbiddenProxyTerms: ['棉线', '毛细', '虹吸', '浮球', '吸水材料'],
    },
    phase1: [
      '我想做一个自动浇花器，最好能根据土壤干湿自己浇水',
      '那我想研究土壤湿度阈值不同，会不会影响自动浇花器的浇水效果',
      '我确定研究不同湿度阈值对自动浇花器浇水准确率的影响，要改变的是湿度阈值',
    ],
    phase2: [
      '我打算设三个阈值：低、中、高，每种阈值测试10次',
      '因变量看该浇水时有没有浇、不该浇时有没有误浇，控制同一个传感器、同一种土壤和水泵',
      '每次测试记录土壤状态、阈值、是否启动水泵和判断是否正确，可以生成数据表了',
    ],
    stage3Rows: [
      { trial: 1, threshold: 'low', actualWet: 'dry', pumped: 'yes', correct: 'yes', notes: '' },
      { trial: 2, threshold: 'low', actualWet: 'wet', pumped: 'no', correct: 'yes', notes: '' },
      { trial: 3, threshold: 'mid', actualWet: 'dry', pumped: 'yes', correct: 'yes', notes: '' },
      { trial: 4, threshold: 'mid', actualWet: 'wet', pumped: 'yes', correct: 'no', notes: '误浇' },
      { trial: 5, threshold: 'high', actualWet: 'dry', pumped: 'no', correct: 'no', notes: '漏浇' },
    ],
    phase4: ['我收集的浇花准确率数据你看一下', '高阈值组漏浇，低阈值组全对，这说明什么？'],
  },
  {
    id: 'engineering-smart-shade-threshold',
    name: '工程保真型-智能遮光系统',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['shade', 'threshold', 'sensor'],
    failureModes: ['engineering_flattening', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '智能遮光系统',
      retainedFeature: '自动判断何时遮光并触发',
      classroomProxy: '不同光照触发阈值',
      researchQuestion: '光照触发阈值是否影响遮光系统响应准确率？',
      independentVariable: '光照触发阈值',
      dependentDirection: '响应准确率',
      mustKeepTerms: [['智能遮光'], ['自动', '遮光'], ['光照', '触发'], ['触发', '阈值']],
      proxyTerms: [['光照', '阈值'], ['传感器'], ['响应', '准确率'], ['自动', '触发']],
    },
    phase1: [
      '我想做一个智能遮光系统，可以光太强的时候自动挡住',
      '我想保留"自动判断什么时候遮光"这个机制，不只是做一个窗帘模型',
      '那我研究不同光照触发阈值会不会影响遮光系统响应准确率，要改变的是触发阈值',
    ],
    phase2: [
      '我设低、中、高三个触发阈值，每个阈值测试10次',
      '看该遮光时有没有遮、不该遮时有没有误触发，传感器位置和光源距离保持一样',
      '每次记录光照状态、阈值、是否触发和判断是否正确，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-alarm-sensitivity',
    name: '工程项目型-倾斜报警器灵敏度',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['alarm', 'tilt', 'threshold'],
    failureModes: ['engineering_flattening'],
    expectedTransformation: {
      originalInterest: '防倾倒报警器',
      retainedFeature: '触发灵敏度影响响应',
      classroomProxy: '不同倾斜触发角度阈值',
      researchQuestion: '倾斜触发角度阈值是否影响报警器响应准确率？',
      independentVariable: '倾斜触发角度阈值',
      dependentDirection: '响应准确率',
    },
    phase1: [
      '我想做一个防倾倒报警器，东西倒了就响',
      '我想研究触发灵敏度不同会不会影响报警效果',
      '我确定研究倾斜触发角度阈值是否影响报警器响应准确率，要改变的是触发角度阈值',
    ],
    phase2: [
      '我设三个角度阈值：15度、30度、45度，每个测10次',
      '看该报警时有没有响、不该响时有没有误响，传感器和蜂鸣器保持一样',
      '每次记录倾斜角度、阈值、是否报警和判断是否正确，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-sorting-color-sensor',
    name: '工程项目型-颜色分拣装置',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['sorting', 'color-sensor', 'accuracy'],
    failureModes: ['engineering_flattening', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '自动颜色分拣装置',
      retainedFeature: '颜色识别阈值影响分拣',
      classroomProxy: '不同颜色识别灵敏度设置',
      researchQuestion: '颜色识别灵敏度是否影响分拣装置准确率？',
      independentVariable: '颜色识别灵敏度',
      dependentDirection: '分拣准确率',
    },
    phase1: [
      '我想做一个能自动分拣不同颜色小球的装置',
      '我想研究识别灵敏度不同会不会影响分拣准确率',
      '我确定研究颜色识别灵敏度是否影响分拣装置准确率，要改变的是识别灵敏度',
    ],
    phase2: [
      '我设三个灵敏度：低、中、高，每个测10次',
      '看该分到A色时有没有分对，传感器位置和小球大小保持一样',
      '每次记录小球颜色、灵敏度、分拣结果是否正确，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-door-reminder-distance',
    name: '工程项目型-门禁提醒距离',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'medium',
    tags: ['door', 'ultrasonic', 'distance'],
    failureModes: ['engineering_flattening'],
    expectedTransformation: {
      originalInterest: '门开太久提醒器',
      retainedFeature: '距离触发阈值影响响应',
      classroomProxy: '不同触发距离阈值',
      researchQuestion: '触发距离阈值是否影响门禁提醒准确率？',
      independentVariable: '触发距离阈值',
      dependentDirection: '提醒准确率',
    },
    phase1: [
      '我想做一个门开太久会提醒的装置',
      '我想研究触发距离不同会不会影响提醒准不准',
      '我确定研究触发距离阈值是否影响门禁提醒准确率，要改变的是触发距离阈值',
    ],
    phase2: [
      '我设三个距离阈值：5cm、10cm、20cm，每个测10次',
      '看门开/关时装置有没有正确响应，传感器位置保持一样',
      '每次记录门状态、阈值、是否正确提醒，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-plant-light-auto-duration',
    name: '工程项目型-补光灯时长',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['grow-light', 'timer', 'duration'],
    failureModes: ['engineering_flattening', 'theme_loss'],
    expectedTransformation: {
      originalInterest: '自动补光植物灯',
      retainedFeature: '补光时长自动控制影响植物',
      classroomProxy: '不同定时补光时长',
      researchQuestion: '定时补光时长是否影响绿豆幼苗生长？',
      independentVariable: '定时补光时长',
      dependentDirection: '幼苗生长情况',
    },
    phase1: [
      '我想做一个给植物自动补光的灯',
      '我想研究补光时长不同会不会影响植物生长',
      '我确定研究定时补光时长是否影响绿豆幼苗生长，要改变的是定时补光时长',
    ],
    phase2: [
      '我设三组：每天2小时、4小时、6小时补光，每组10颗绿豆',
      '记录每天苗高，品种水量温度保持一样',
      '记录7天，可以生成数据表了',
    ],
  },
  {
    id: 'engineering-fan-temperature-threshold',
    name: '工程项目型-温控风扇阈值',
    subject: 'engineering_automation',
    studentType: 'engineering_project',
    difficulty: 'hard',
    tags: ['fan', 'temperature', 'threshold'],
    failureModes: ['engineering_flattening', 'safety_softness'],
    expectedTransformation: {
      originalInterest: '温度高了自动开风扇',
      retainedFeature: '温度触发阈值影响响应',
      classroomProxy: '不同温度触发阈值',
      researchQuestion: '温度触发阈值是否影响温控风扇响应准确率？',
      independentVariable: '温度触发阈值',
      dependentDirection: '响应准确率',
      safetyNotes: ['用低压风扇，不用220V市电'],
    },
    phase1: [
      '我想做一个温度高了就自动开风扇的装置',
      '我想研究触发温度不同会不会影响它开得准不准',
      '我确定研究温度触发阈值是否影响温控风扇响应准确率，要改变的是温度触发阈值',
    ],
    phase2: [
      '我设三个温度阈值：25℃、30℃、35℃，每个测10次',
      '看该开时有没有开、不该开时有没有误开，传感器和风扇保持一样',
      '每次记录温度、阈值、是否启动和判断是否正确，可以生成数据表了',
    ],
  },

  // ---------------- 高概念 / 跨学科 ----------------
  {
    id: 'high-concept-smart-campus-energy',
    name: '高概念型-智慧校园节能',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['campus', 'energy', 'smart'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '智慧校园节能',
      retainedFeature: '行为/参数调节影响能耗',
      classroomProxy: '不同灯具关闭策略',
      researchQuestion: '灯具关闭策略是否影响教室模拟能耗？',
      independentVariable: '灯具关闭策略',
      dependentDirection: '模拟能耗',
    },
    phase1: [
      '我想做一个智慧校园节能的项目',
      '我最感兴趣的是教室灯光怎么自动管理来省电',
      '我想保留"调节管理策略影响能耗"这个特点，用不同灯具关闭策略模拟',
      '我确定研究灯具关闭策略是否影响教室模拟能耗，要改变的是灯具关闭策略',
    ],
    phase2: [
      '我设三组：常亮、人走即关、按时段开关，用同一套灯泡',
      '记录一天累计亮灯时长作为能耗代理，灯泡和教室布局保持一样',
      '记录3天取平均，可以生成数据表了',
    ],
  },
  {
    id: 'high-concept-city-cooling-roof',
    name: '高概念型-城市降温屋顶',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['city', 'cooling', 'roof'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '城市热岛降温',
      retainedFeature: '表面材质影响吸热',
      classroomProxy: '不同屋顶模型表面材质',
      researchQuestion: '屋顶表面材质是否影响模型盒内温度？',
      independentVariable: '屋顶表面材质',
      dependentDirection: '模型盒内温度',
    },
    phase1: [
      '我想研究城市热岛效应，怎么给城市降温',
      '我最感兴趣的是屋顶材质会不会影响吸热',
      '我想保留"表面材质影响吸热"这个特点，用不同屋顶模型表面材质',
      '我确定研究屋顶表面材质是否影响模型盒内温度，要改变的是屋顶表面材质',
    ],
    phase2: [
      '我设三组：黑纸、白纸、铝箔覆盖的纸盒顶，同样大小',
      '灯照相同时间，记录盒内温度，灯和距离保持一样',
      '每隔5分钟记录一次，记录30分钟，可以生成数据表了',
    ],
  },
  {
    id: 'high-concept-low-carbon-commute',
    name: '高概念型-低碳出行',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['low-carbon', 'commute', 'model'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '低碳出行',
      retainedFeature: '出行方式能耗差异',
      classroomProxy: '不同模拟出行方式对应的"能耗"（如橡皮筋数/重量）',
      researchQuestion: '出行方式是否影响模拟单次通勤能耗？',
      independentVariable: '出行方式（模拟）',
      dependentDirection: '模拟单次通勤能耗',
      mustKeepTerms: [['出行方式', '能耗'], ['模拟出行方式']],
      proxyTerms: [['橡皮筋'], ['模拟', '能耗'], ['配重', '小车']],
    },
    phase1: [
      '我想研究低碳出行，怎么减少通勤碳排放',
      '我最感兴趣的是不同出行方式能耗差别',
      '我想保留"出行方式能耗差异"这个特点，用不同模拟出行方式对应的能耗',
      '我确定研究出行方式是否影响模拟单次通勤能耗，要改变的是出行方式',
    ],
    phase2: [
      '我设三组：步行/公交/自驾三种模拟（用不同配重小车跑同一路径）',
      '记录跑完路径的能量消耗代理值，路径和小车保持一样',
      '每组测3次取平均，可以生成数据表了',
    ],
  },
  {
    id: 'high-concept-ai-recognition-threshold',
    name: '高概念型-AI识别阈值',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['ai', 'recognition', 'threshold'],
    failureModes: ['engineering_flattening', 'theme_loss'],
    expectedTransformation: {
      originalInterest: 'AI图像识别',
      retainedFeature: '识别阈值影响准确率',
      classroomProxy: '不同颜色/亮度匹配阈值',
      researchQuestion: '识别阈值是否影响分拣准确率？',
      independentVariable: '识别阈值',
      dependentDirection: '分拣准确率',
    },
    phase1: [
      '我想做一个跟AI有关的项目，最好能识别东西',
      '我最感兴趣的是AI怎么判断一个东西该不该被识别',
      '我想保留"识别阈值影响判断"这个特点，用不同颜色/亮度匹配阈值模拟',
      '我确定研究识别阈值是否影响分拣准确率，要改变的是识别阈值',
    ],
    phase2: [
      '我设三个阈值：低、中、高，用颜色传感器分拣彩色卡片',
      '看该识别时有没有识别、不该识别时有没有误识别，传感器和卡片保持一样',
      '每组测10次，可以生成数据表了',
    ],
  },
  {
    id: 'high-concept-mars-water-recycle',
    name: '高概念型-火星基地水循环',
    subject: 'high_concept_interdisciplinary',
    studentType: 'high_concept',
    difficulty: 'hard',
    tags: ['mars', 'water', 'recycle'],
    failureModes: ['theme_loss', 'proxy_drift'],
    expectedTransformation: {
      originalInterest: '火星基地水循环',
      retainedFeature: '净化方式影响回用水质',
      classroomProxy: '不同过滤层数',
      researchQuestion: '过滤层数是否影响模拟回用水澄清度？',
      independentVariable: '过滤层数',
      dependentDirection: '回用水澄清度',
    },
    phase1: [
      '我想做一个和火星基地有关的项目，研究水怎么循环用',
      '我最感兴趣的是基地里水怎么净化后再用',
      '我想保留"净化方式影响回用水质"这个特点，用不同过滤层数模拟',
      '我确定研究过滤层数是否影响模拟回用水澄清度，要改变的是过滤层数',
    ],
    phase2: [
      '我设三组：单层、双层、三层过滤（沙+棉花+活性炭组合），同样装置',
      '倒等量同浊度浑水，记录滤液浊度，浑水配制保持一样',
      '每组测1次，可以生成数据表了',
    ],
  },
];
