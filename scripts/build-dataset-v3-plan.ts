#!/usr/bin/env tsx
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { STYLE_FAMILIES, type StyleFamily } from '../app/lib/stylePolicy';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type {
  DatasetV3AnomalyPattern,
  DatasetV3DataPattern,
  DatasetV3DomainSpec,
  DatasetV3ExpectedTransformation as ExpectedTransformation,
  DatasetV3Phase as Phase,
  DatasetV3Plan,
  DatasetV3Task,
} from './dataset-v3-types';

const DATA_PATTERNS: DatasetV3DataPattern[] = [
  'rising',
  'falling',
  'weak_trend',
  'plateau',
  'non_monotonic',
  'overlap',
  'single_outlier',
  'missing_measurement',
  'replicate_variation',
];

interface DomainTemplate extends Omit<DatasetV3DomainSpec, 'researchQuestion' | 'hypothesis' | 'dataPattern' | 'anomalyPattern'> {
  match: RegExp;
}

const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    match: /酸雨|稀酸|pH/i,
    independentVariable: { name: '白醋稀释液pH', levels: ['pH 4.5', 'pH 5.5', 'pH 6.5'] },
    dependentVariable: { name: '第5天发芽率', measurement: '以胚根突破种皮为已发芽；第5天统计已发芽种子数并计算百分比', unit: '%', reasonableRange: [0, 100] },
    controlledVariables: ['绿豆数量', '培养温度', '每日溶液体积', '光照时长'],
    materials: ['绿豆', '白醋稀释液', '培养皿', '滴管', 'pH试纸'],
    procedure: ['配制并核对三种pH稀释液', '每皿放入相同数量绿豆', '每天加入相同体积对应溶液', '第5天按胚根突破种皮的标准统计发芽数'],
    repeatCount: 3,
    safetyRisks: ['只使用教师配制的白醋稀释液并佩戴护目镜', '液体接触皮肤后立即用清水冲洗'],
  },
  {
    match: /光色|颜色.*光|红蓝绿白/,
    independentVariable: { name: '光的颜色', levels: ['红光', '蓝光', '白光'] },
    dependentVariable: { name: '第4天发芽数', measurement: '以胚根突破种皮为已发芽；第4天统计每皿已发芽绿豆数量', unit: '粒', reasonableRange: [0, 20] },
    controlledVariables: ['每皿绿豆数量', '光照时长', '灯距', '浇水量'],
    materials: ['绿豆', '培养皿', '红蓝白LED灯', '滴管'],
    procedure: ['将等量绿豆分入培养皿', '分别置于三种颜色灯光下', '每天同一时间补充等量清水', '第4天统计发芽数'],
    repeatCount: 3,
    safetyRisks: ['避免直视LED灯', '电源和滴水区域保持分离'],
  },
  {
    match: /浇水|水量/,
    independentVariable: { name: '每日浇水量', levels: ['2 mL', '5 mL', '8 mL'] },
    dependentVariable: { name: '第5天发芽率', measurement: '以胚根突破种皮为已发芽；第5天统计发芽数并计算百分比', unit: '%', reasonableRange: [0, 100] },
    controlledVariables: ['绿豆数量', '土壤质量', '光照时长', '环境温度'],
    materials: ['绿豆', '相同花盆', '土壤', '量筒'],
    procedure: ['每盆装入相同质量土壤并播种等量绿豆', '每天加入对应体积清水', '保持摆放位置一致', '第5天统计发芽数'],
    repeatCount: 3,
    safetyRisks: ['及时擦干洒出的水，防止滑倒'],
  },
  {
    match: /光合作用/,
    independentVariable: { name: '灯与水草距离', levels: ['10 cm', '20 cm', '30 cm'] },
    dependentVariable: { name: '每分钟气泡数', measurement: '稳定2分钟后计数1分钟内释放的气泡', unit: '个/min', reasonableRange: [0, 60] },
    controlledVariables: ['水草长度', '水温', '计数时间', '碳酸氢钠溶液体积'],
    materials: ['金鱼藻', '烧杯', 'LED灯', '刻度尺', '秒表'],
    procedure: ['将等长金鱼藻放入等量溶液', '按刻度尺设置灯距', '稳定2分钟', '计数1分钟气泡并重复测量'],
    repeatCount: 3,
    safetyRisks: ['LED灯与水保持安全距离', '移动烧杯时防止液体泼洒'],
  },
  {
    match: /火星|植物|发芽|株高|遮阴/,
    independentVariable: { name: '每日人工光照时长', levels: ['4 h', '8 h', '12 h'] },
    dependentVariable: { name: '第7天幼苗株高', measurement: '第7天从土面到幼苗顶端测量高度', unit: 'mm', reasonableRange: [0, 160] },
    controlledVariables: ['绿豆数量', '土壤质量', '每日浇水量', '灯距'],
    materials: ['绿豆', '相同花盆', '土壤', 'LED灯', '刻度尺'],
    procedure: ['播种等量绿豆', '分别设置三种每日光照时长', '每天同一时间浇等量水', '第7天测量株高'],
    repeatCount: 3,
    safetyRisks: ['避免直视LED灯', '浇水时先切断灯具电源'],
  },
  {
    match: /生态瓶|水草.*小鱼/,
    independentVariable: { name: '水草与小鱼数量组合', levels: ['2株水草+1条小鱼', '4株水草+1条小鱼', '4株水草+2条小鱼'] },
    dependentVariable: { name: '第7天溶解氧', measurement: '第7天用溶解氧传感器测量', unit: 'mg/L', reasonableRange: [0, 14] },
    controlledVariables: ['瓶体积', '水体积', '光照时长', '投喂量'],
    materials: ['透明生态瓶', '水草', '小鱼', '溶解氧传感器'],
    procedure: ['按组合放入水草和小鱼', '加入相同体积水', '保持光照和投喂一致', '第7天测量溶解氧'],
    repeatCount: 3,
    safetyRisks: ['轻拿生态瓶，避免玻璃破裂', '实验结束后按教师要求妥善安置小鱼'],
  },
  {
    match: /面包|发霉|防腐/,
    independentVariable: { name: '保存方式', levels: ['室温密封', '冷藏密封', '室温干燥'] },
    dependentVariable: { name: '第7天霉斑覆盖率', measurement: '隔着密封袋用方格纸估算霉斑面积百分比', unit: '%', reasonableRange: [0, 100] },
    controlledVariables: ['面包大小', '面包批次', '观察时间', '包装袋大小'],
    materials: ['同批次面包片', '密封袋', '方格纸'],
    procedure: ['将等大面包片分别密封', '按三种方式保存', '全程不打开袋子', '第7天隔袋估算霉斑覆盖率'],
    repeatCount: 3,
    safetyRisks: ['发霉样品全程密封且不得闻或触摸', '实验结束后由教师统一处置'],
  },
  {
    match: /酸奶|变质|存放温度/,
    independentVariable: { name: '存放温度', levels: ['4 ℃', '20 ℃', '30 ℃'] },
    dependentVariable: { name: 'pH变化量', measurement: '在0小时和24小时各测一次pH并计算变化量', unit: 'pH', reasonableRange: [0, 3] },
    controlledVariables: ['酸奶批次', '样品体积', '容器大小', '存放时长'],
    materials: ['同批次酸奶', '带盖样品杯', 'pH试纸', '温度计'],
    procedure: ['分装等体积酸奶', '记录初始pH', '分别存放24小时', '测量末次pH并计算变化量'],
    repeatCount: 3,
    safetyRisks: ['实验样品不得食用', '样品保持封闭并由教师统一处置'],
  },
  {
    match: /净水|过滤|浑浊|泥沙|沉降|油污|分离/,
    independentVariable: { name: '过滤材料', levels: ['棉布', '滤纸', '活性炭+滤纸'] },
    dependentVariable: { name: '过滤后浊度', measurement: '用浊度传感器测量过滤后水样', unit: 'NTU', reasonableRange: [0, 300] },
    controlledVariables: ['原水体积', '原水批次', '过滤材料面积', '静置时间'],
    materials: ['模拟浑水', '棉布', '滤纸', '活性炭', '漏斗', '浊度传感器'],
    procedure: ['混匀同一批模拟浑水', '装配三种过滤材料', '分别过滤相同体积水样', '测量过滤后浊度'],
    repeatCount: 3,
    safetyRisks: ['模拟浑水不得饮用', '活性炭粉末避免吸入并及时清理'],
  },
  {
    match: /苹果|褐变/,
    independentVariable: { name: '抗褐变处理', levels: ['不处理', '5%盐水浸泡', '柠檬汁浸泡'] },
    dependentVariable: { name: '30分钟褐变面积率', measurement: '30分钟后用方格纸估算褐变面积百分比', unit: '%', reasonableRange: [0, 100] },
    controlledVariables: ['苹果批次', '切片厚度', '浸泡时长', '观察时间'],
    materials: ['同一苹果', '5%盐水', '柠檬汁', '方格纸'],
    procedure: ['由教师切取等厚苹果片', '按三种方式处理相同时长', '平放30分钟', '估算褐变面积率'],
    repeatCount: 3,
    safetyRisks: ['刀具只由教师使用', '实验样品不得食用'],
  },
  {
    match: /纸桥|结构|承重|稳定性/,
    independentVariable: { name: '纸桥结构', levels: ['平板形', '拱形', '三角桁架形'] },
    dependentVariable: { name: '最大承重质量', measurement: '逐次增加砝码，记录桥面明显变形前的总质量', unit: 'g', reasonableRange: [0, 1500] },
    controlledVariables: ['纸张规格', '桥跨长度', '胶带用量', '加载位置'],
    materials: ['A4纸', '胶带', '砝码', '电子秤', '支撑块'],
    procedure: ['用相同纸张制作三种结构', '设置相同桥跨', '在桥中央逐次增加砝码', '记录明显变形前总质量'],
    repeatCount: 3,
    safetyRisks: ['砝码从低处轻放，脚部不得位于桥下'],
  },
  {
    match: /小车|斜面/,
    independentVariable: { name: '斜面角度', levels: ['10°', '20°', '30°'] },
    dependentVariable: { name: '离开斜面后的滑行距离', measurement: '从斜面末端到小车停止位置测量距离', unit: 'cm', reasonableRange: [0, 400] },
    controlledVariables: ['小车型号', '释放位置', '斜面表面', '地面材质'],
    materials: ['实验小车', '斜面板', '量角器', '卷尺'],
    procedure: ['调节并核对斜面角度', '从同一位置无推力释放小车', '测量滑行距离', '每个角度重复测量'],
    repeatCount: 3,
    safetyRisks: ['在轨道末端设置软挡板，避免小车撞人'],
  },
  {
    match: /降落伞|伞面/,
    independentVariable: { name: '伞面面积', levels: ['400 cm²', '625 cm²', '900 cm²'] },
    dependentVariable: { name: '下落时间', measurement: '从2 m高度释放后用秒表记录落地时间', unit: 's', reasonableRange: [0.5, 8] },
    controlledVariables: ['载荷质量', '伞绳长度', '释放高度', '释放姿态'],
    materials: ['塑料伞面', '细绳', '相同载荷', '卷尺', '秒表'],
    procedure: ['制作三种面积伞面', '连接相同载荷和等长伞绳', '从2 m高度释放', '记录下落时间'],
    repeatCount: 3,
    safetyRisks: ['释放区下方保持无人', '只在教师指定高度操作，不攀爬桌椅'],
  },
  {
    match: /弹性|橡皮筋|续航/,
    independentVariable: { name: '橡皮筋数量', levels: ['1根', '2根', '3根'] },
    dependentVariable: { name: '小车行驶距离', measurement: '从起点到小车停止位置测量距离', unit: 'cm', reasonableRange: [0, 800] },
    controlledVariables: ['橡皮筋规格', '小车质量', '缠绕圈数', '地面材质'],
    materials: ['橡皮筋动力小车', '同规格橡皮筋', '卷尺'],
    procedure: ['安装对应数量橡皮筋', '保持缠绕圈数一致', '从同一起点释放小车', '测量停止距离'],
    repeatCount: 3,
    safetyRisks: ['检查橡皮筋无裂纹并远离面部', '行驶区域保持无人'],
  },
  {
    match: /遮光|降温|保温|包覆/,
    independentVariable: { name: '包覆材料', levels: ['无包覆', '棉布', '铝箔气泡膜'] },
    dependentVariable: { name: '20分钟温度下降值', measurement: '记录初温和20分钟温度并计算差值', unit: '℃', reasonableRange: [0, 35] },
    controlledVariables: ['水体积', '初始温度', '容器规格', '室温'],
    materials: ['相同烧杯', '温水', '棉布', '铝箔气泡膜', '温度计'],
    procedure: ['向烧杯加入等体积同温温水', '按三种方式包覆', '同时开始计时', '20分钟后记录温度并计算下降值'],
    repeatCount: 3,
    safetyRisks: ['使用不超过50 ℃的温水', '擦干洒出的水并轻拿玻璃器皿'],
  },
  {
    match: /电磁铁|磁性/,
    independentVariable: { name: '线圈匝数', levels: ['20匝', '40匝', '60匝'] },
    dependentVariable: { name: '吸起回形针数量', measurement: '通电3秒后统计一次吸起的回形针数', unit: '枚', reasonableRange: [0, 50] },
    controlledVariables: ['铁钉规格', '电池电压', '通电时间', '回形针规格'],
    materials: ['铁钉', '绝缘导线', '低压电池盒', '开关', '回形针'],
    procedure: ['绕制三种匝数线圈', '接入相同低压电源', '每次通电3秒吸取回形针', '断电后统计数量'],
    repeatCount: 3,
    safetyRisks: ['每次通电不超过3秒并在测量间隔断电', '导线发热时立即停止'],
  },
  {
    match: /防水|涂层|吸水材料|纸条材质/,
    independentVariable: { name: '表面处理材料', levels: ['不处理', '蜡笔涂层', '透明胶带覆盖'] },
    dependentVariable: { name: '3分钟吸水质量', measurement: '接触水前后称量并计算质量增加值', unit: 'g', reasonableRange: [0, 30] },
    controlledVariables: ['纸片面积', '接触水深', '接触时间', '水温'],
    materials: ['同规格纸片', '蜡笔', '透明胶带', '清水', '电子秤'],
    procedure: ['制作三种表面处理纸片', '称量初始质量', '接触相同深度清水3分钟', '擦去表面水后再次称量'],
    repeatCount: 3,
    safetyRisks: ['及时擦干电子秤附近的水', '电子秤不得直接接触水'],
  },
  {
    match: /化学|控制变量|实验设计|影响因素/,
    independentVariable: { name: '泡腾片颗粒大小', levels: ['整片', '分成4块', '研成粗粉'] },
    dependentVariable: { name: '完全溶解时间', measurement: '投入水中后用秒表记录到无固体可见的时间', unit: 's', reasonableRange: [5, 240] },
    controlledVariables: ['泡腾片质量', '水体积', '水温', '容器规格'],
    materials: ['同批次泡腾片', '清水', '烧杯', '量筒', '秒表'],
    procedure: ['准备三种颗粒大小的等质量泡腾片', '量取等体积同温清水', '投入后立即计时', '记录固体完全消失时间'],
    repeatCount: 3,
    safetyRisks: ['实验溶液不得饮用', '研碎操作由教师指导并避免粉末进入眼睛'],
  },
];

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function intFlag(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须为正整数`);
  return value;
}

function hashInt(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16);
}

function familyKey(record: ShareGPTRecord): string {
  const persona = typeof record.meta?.personaId === 'string' ? record.meta.personaId : undefined;
  return persona ?? record.id.replace(/^stem-distill-dsv4-p\d-/, '').replace(/-v\d+-[0-9a-f]+-v\d+$/i, '');
}

function expected(record: ShareGPTRecord): ExpectedTransformation | undefined {
  const value = record.meta?.expectedTransformation;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ExpectedTransformation : undefined;
}

function anomalyFor(pattern: DatasetV3DataPattern): DatasetV3AnomalyPattern {
  if (pattern === 'single_outlier' || pattern === 'missing_measurement' || pattern === 'replicate_variation') return pattern;
  return 'none';
}

function resolveDomainSpec(record: ShareGPTRecord, ordinal: number): DatasetV3DomainSpec {
  const transformation = expected(record);
  const haystack = [
    record.scenario,
    transformation?.independentVariable,
    transformation?.dependentDirection,
    transformation?.classroomProxy,
  ].filter(Boolean).join('\n');
  const template = DOMAIN_TEMPLATES.find((item) => item.match.test(haystack)) ?? DOMAIN_TEMPLATES.at(-1)!;
  const pattern = DATA_PATTERNS[ordinal % DATA_PATTERNS.length];
  return {
    researchQuestion: `${template.independentVariable.name}如何影响${template.dependentVariable.name}？`,
    hypothesis: `不同${template.independentVariable.name}水平会使${template.dependentVariable.name}出现可测差异。`,
    independentVariable: { ...template.independentVariable, levels: [...template.independentVariable.levels] },
    dependentVariable: { ...template.dependentVariable, reasonableRange: [...template.dependentVariable.reasonableRange] as [number, number] },
    controlledVariables: [...template.controlledVariables],
    materials: [...template.materials],
    procedure: [...template.procedure],
    repeatCount: template.repeatCount,
    safetyRisks: [...template.safetyRisks],
    dataPattern: pattern,
    anomalyPattern: anomalyFor(pattern),
  };
}

const PATTERN_LEVELS: Record<DatasetV3DataPattern, [number, number, number]> = {
  rising: [0.22, 0.5, 0.78],
  falling: [0.78, 0.5, 0.22],
  weak_trend: [0.46, 0.5, 0.54],
  plateau: [0.28, 0.68, 0.7],
  non_monotonic: [0.34, 0.76, 0.45],
  overlap: [0.5, 0.51, 0.49],
  single_outlier: [0.3, 0.52, 0.74],
  missing_measurement: [0.24, 0.51, 0.75],
  replicate_variation: [0.32, 0.55, 0.72],
};

function roundValue(value: number, range: [number, number]): number {
  const span = range[1] - range[0];
  if (span > 80) return Math.round(value);
  if (span > 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function buildRows(spec: DatasetV3DomainSpec, seed: number): Record<string, unknown>[] {
  const [min, max] = spec.dependentVariable.reasonableRange;
  const span = max - min;
  const levels = PATTERN_LEVELS[spec.dataPattern];
  const anomalyRow = seed % spec.repeatCount;
  const anomalyLevel = Math.floor(seed / 7) % 3;
  return Array.from({ length: spec.repeatCount }, (_, repeatIndex) => {
    const row: Record<string, unknown> = { trial: repeatIndex + 1 };
    for (let levelIndex = 0; levelIndex < 3; levelIndex++) {
      const key = `result_${String.fromCharCode(97 + levelIndex)}`;
      const baseNoise = (((seed >> (levelIndex * 3)) + repeatIndex * 7 + levelIndex * 5) % 7 - 3) / 100;
      const variation = spec.dataPattern === 'replicate_variation' ? (repeatIndex - 1) * 0.09 * (levelIndex === 1 ? -1 : 1) : 0;
      let ratio = levels[levelIndex] + baseNoise + variation;
      if (spec.dataPattern === 'single_outlier' && repeatIndex === anomalyRow && levelIndex === anomalyLevel) ratio += 0.2;
      ratio = Math.max(0.02, Math.min(0.98, ratio));
      row[key] = roundValue(min + span * ratio, spec.dependentVariable.reasonableRange);
    }
    row.notes = '';
    if (spec.dataPattern === 'missing_measurement' && repeatIndex === anomalyRow) {
      const key = `result_${String.fromCharCode(97 + anomalyLevel)}`;
      row[key] = '';
      row.notes = `第${repeatIndex + 1}次的${spec.independentVariable.levels[anomalyLevel]}未记录到读数`;
    } else if (spec.dataPattern === 'single_outlier' && repeatIndex === anomalyRow) {
      row.notes = `第${repeatIndex + 1}次${spec.independentVariable.levels[anomalyLevel]}的读数与同组其余记录差异较大`;
    } else if (spec.dataPattern === 'replicate_variation' && repeatIndex === spec.repeatCount - 1) {
      row.notes = `第${repeatIndex + 1}次测量与前两次的差值较大，保留原始记录`;
    }
    return row;
  });
}

function dataSchema(spec: DatasetV3DomainSpec) {
  return {
    columns: [
      { key: 'trial', title: '重复序号', type: 'number' as const, required: true },
      ...spec.independentVariable.levels.map((level, index) => ({
        key: `result_${String.fromCharCode(97 + index)}`,
        title: `${level}：${spec.dependentVariable.name}（${spec.dependentVariable.unit}）`,
        type: 'number' as const,
        required: true,
      })),
      { key: 'notes', title: '客观异常备注', type: 'text' as const, required: false },
    ],
    minRows: spec.repeatCount,
    maxRows: 200,
  };
}

function rowsText(rows: Record<string, unknown>[], spec: DatasetV3DomainSpec): string {
  return rows.map((row) => {
    const values = spec.independentVariable.levels.map((level, index) => `${level}=${String(row[`result_${String.fromCharCode(97 + index)}`] ?? '')}${spec.dependentVariable.unit}`);
    return `第${row.trial}次：${values.join('；')}；备注=${String(row.notes ?? '')}`;
  }).join('\n');
}

function approvedPlanText(spec: DatasetV3DomainSpec, includeMethod = true): string {
  const lines = [
    `【已确认研究问题】${spec.researchQuestion}`,
    ...(includeMethod ? [`【已确认假设】${spec.hypothesis}`] : ['【缺失信息】研究假设尚未由学生提供。']),
    `【已审核变量】自变量：${spec.independentVariable.name}；水平：${spec.independentVariable.levels.join('、')}；因变量：${spec.dependentVariable.name}；测量：${spec.dependentVariable.measurement}；单位：${spec.dependentVariable.unit}`,
    `【已审核控制变量】${spec.controlledVariables.join('、')}`,
    `【已审核重复次数】每个水平${spec.repeatCount}次`,
    `【已审核安全】${spec.safetyRisks.join('、')}`,
  ];
  if (includeMethod) {
    lines.push(`【已审核材料】${spec.materials.join('、')}`);
    lines.push(`【已审核步骤】${spec.procedure.join('；')}`);
  } else {
    lines.push('【缺失信息】材料和步骤尚未由学生提供。');
  }
  return lines.join('\n');
}

function acceptedAnalysis(rows: Record<string, unknown>[], spec: DatasetV3DomainSpec): string[] {
  const first = rows[0];
  const second = rows[1] ?? rows[0];
  const a = String(first.result_a ?? '缺失');
  const b = String(first.result_b ?? '缺失');
  const c = String(second.result_c ?? '缺失');
  const notes = rows.map((row) => String(row.notes ?? '')).find(Boolean);
  return [
    `学生已引用第1次的${spec.independentVariable.levels[0]}=${a}${spec.dependentVariable.unit}和${spec.independentVariable.levels[1]}=${b}${spec.dependentVariable.unit}进行比较。`,
    `学生又引用第2次的${spec.independentVariable.levels[2]}=${c}${spec.dependentVariable.unit}，并把观察到的差异表述为相关现象而非确定因果。${notes ? `学生客观指出：${notes}。` : ''}`,
  ];
}

function priorSummaryFor(phase: Phase, spec: DatasetV3DomainSpec, rows: Record<string, unknown>[], reportPath?: 'complete' | 'fallback'): string | undefined {
  if (phase === 1) return undefined;
  const topic = [
    `【已确认研究问题】${spec.researchQuestion}`,
    `【因素与现象方向】拟改变：${spec.independentVariable.name}；关注：${spec.dependentVariable.name}`,
  ].join('\n');
  if (phase === 2) return topic;
  const plan = approvedPlanText(spec, !(phase === 5 && reportPath === 'fallback'));
  if (phase === 3) return plan;
  const data = `【学生真实数据】\n${rowsText(rows, spec)}`;
  if (phase === 4) return `${plan}\n${data}`;
  const analysis = `【已接受的两轮数据分析】\n${acceptedAnalysis(rows, spec).join('\n')}`;
  if (phase === 5) return `${plan}\n${data}\n${analysis}`;
  return `${plan}\n${data}\n${analysis}\n【已提交报告】报告正文已提交；最终局限与改进由学生本人在反思表单填写。`;
}

function triggerFor(phase: Phase): DatasetV3Task['triggerType'] {
  if (phase === 2 || phase === 4) return 'STAGE_TRANSITION';
  if (phase === 3) return 'STAGE_ENTER';
  if (phase === 5) return 'REPORT_BOOTSTRAP';
  if (phase === 6) return 'OPTIONAL_COACHING';
  return 'USER_MESSAGE';
}

function openingFor(record: ShareGPTRecord, phase: Phase, spec: DatasetV3DomainSpec): string {
  if (phase === 2) return '系统触发：学生已确认选题。请发送阶段2方案设计的开场，只推进第一个方案缺口。';
  if (phase === 3) return '系统触发：学生首次进入过程执行阶段，请先进行与已审核风险相关的安全问答。';
  if (phase === 4) return '系统触发：学生已完成数据收集。请读取已提交的数据表，并发送阶段4的数据分析开场。';
  if (phase === 5) return '系统触发：学生已完成数据分析，请基于前序结构化状态生成报告框架。';
  if (phase === 6) return `我想反思“${spec.researchQuestion}”这次实验，但不希望你直接替我写答案。`;
  return `我对“${record.scenario.replace(/-蒸馏样本\d+$/, '')}”感兴趣，但还不知道怎样变成课堂里能研究的问题。`;
}

function decisionFacts(phase: Phase, spec: DatasetV3DomainSpec): string[] {
  if (phase === 1) return [`我真正感兴趣的是${spec.researchQuestion.replace(/如何影响.*/, '')}与观察现象之间的关系，但尚未决定水平、测量或步骤。`];
  return [
    `我选择${spec.independentVariable.name}，具体水平为${spec.independentVariable.levels.join('、')}。`,
    `我提出的假设是：${spec.hypothesis}`,
    `我要测量${spec.dependentVariable.name}：${spec.dependentVariable.measurement}，单位${spec.dependentVariable.unit}。`,
    `我会控制${spec.controlledVariables.join('、')}。`,
    `我选择的材料是${spec.materials.join('、')}。`,
    `我确认的步骤是${spec.procedure.join('；')}。`,
    `每个水平重复${spec.repeatCount}次；安全要求是${spec.safetyRisks.join('、')}。`,
  ];
}

function buildTask(record: ShareGPTRecord, styleFamily: StyleFamily, ordinal: number, reportPath?: 'complete' | 'fallback'): DatasetV3Task {
  const phase = record.phase as Phase;
  const spec = resolveDomainSpec(record, ordinal);
  const seed = hashInt(`${familyKey(record)}:${phase}:${styleFamily}:${ordinal}`);
  const rows = buildRows(spec, seed);
  const priorSummary = priorSummaryFor(phase, spec, rows, reportPath);
  const scenario = record.scenario.replace(/-蒸馏样本\d+$/, '');
  const schema = dataSchema(spec);
  return {
    id: `dataset-v3-${record.id}`,
    cellKey: `P${phase}:${styleFamily}`,
    parentLegacyRecordId: record.id,
    familyKey: familyKey(record),
    phase,
    scenario,
    styleFamily,
    triggerType: triggerFor(phase),
    reportPath: phase === 5 ? reportPath ?? 'complete' : undefined,
    domainSpec: spec,
    studentVisible: {
      profile: typeof record.meta?.studentType === 'string' ? record.meta.studentType : '普通初中生',
      openingMessage: openingFor(record, phase, spec),
      brief: [
        `我正在做“${scenario}”主题的探究。`,
        phase === 1 ? '我还没有确定具体变量、组别、测量方法或步骤。' : '我只会依据已确认的前序状态回答导师。',
      ],
      decisionFacts: decisionFacts(phase, spec),
      realRows: phase >= 4 ? rows : [],
    },
    tutorVisible: {
      priorSummary,
      dataRows: phase === 4 || phase === 5 ? rows : undefined,
      dataSchema: phase === 4 || phase === 5 ? schema : undefined,
      approvedPlan: phase >= 3 && !(phase === 5 && reportPath === 'fallback') ? spec : undefined,
      acceptedAnalysis: phase >= 5 ? acceptedAnalysis(rows, spec) : undefined,
    },
    evaluatorOnly: {
      expectedTransformation: expected(record),
      domainSpec: spec,
      failureModes: Array.isArray(record.meta?.failureModes) ? record.meta.failureModes.map(String) : [],
      rubricTargets: record.rubricTargets ?? [],
    },
  };
}

function balancedSelect(records: ShareGPTRecord[], target: number): DatasetV3Task[] {
  const buckets = new Map<Phase, ShareGPTRecord[]>();
  for (const record of records) {
    const phase = record.phase as Phase;
    if (!buckets.has(phase)) buckets.set(phase, []);
    buckets.get(phase)!.push(record);
  }
  const cursors = new Map<Phase, number>();
  const usedFamilies = new Set<string>();
  const selected: DatasetV3Task[] = [];
  const phases: Phase[] = [1, 2, 3, 4, 5, 6];
  for (let styleIndex = 0; selected.length < Math.min(target, records.length); styleIndex++) {
    const style = STYLE_FAMILIES[styleIndex % STYLE_FAMILIES.length];
    for (const phase of phases) {
      const bucket = buckets.get(phase) ?? [];
      if (bucket.length === 0) continue;
      const start = cursors.get(phase) ?? 0;
      let selectedIndex = -1;
      for (let offset = 0; offset < bucket.length; offset++) {
        const candidateIndex = (start + offset) % bucket.length;
        if (!usedFamilies.has(familyKey(bucket[candidateIndex]))) {
          selectedIndex = candidateIndex;
          break;
        }
      }
      if (selectedIndex < 0) selectedIndex = start % bucket.length;
      const record = bucket[selectedIndex];
      cursors.set(phase, (selectedIndex + 1) % bucket.length);
      usedFamilies.add(familyKey(record));
      const p5Ordinal = selected.filter((task) => task.phase === 5).length;
      selected.push(buildTask(record, style, selected.length, phase === 5 && p5Ordinal === 4 ? 'fallback' : 'complete'));
      if (selected.length >= target) break;
    }
  }
  return selected;
}

async function main() {
  const legacyFile = path.resolve(flag('--legacy', 'data/sft/sharegpt-distill-dsv4-all-clean.json')!);
  const outFile = path.resolve(flag('--out', 'data/sft/v3/plans/plan-v3.json')!);
  const dispositionFile = path.resolve(flag('--disposition-out', 'data/sft/v3/legacy-489-disposition.json')!);
  const target = intFlag('--target', 400);
  const records = JSON.parse(await readFile(legacyFile, 'utf8')) as ShareGPTRecord[];
  const eligible = records.filter((record) => Number.isInteger(record.phase) && record.phase >= 1 && record.phase <= 6);
  const tasks = balancedSelect(eligible, target);
  const plan: DatasetV3Plan = {
    schemaVersion: 3,
    stageContractVersion: STAGE_CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    sourceFile: path.relative(process.cwd(), legacyFile),
    sourceUsage: 'SCENARIO_SEEDS_ONLY',
    tasks,
  };
  const disposition = {
    schemaVersion: 1,
    sourceFile: path.relative(process.cwd(), legacyFile),
    disposition: 'LEGACY_QUARANTINED',
    sftEligibility: 'BLOCKED',
    records: records.map((record) => ({
      id: record.id,
      phase: record.phase,
      familyKey: familyKey(record),
      allowedUses: ['scenario_seed', 'rejected_preference', 'regression_case'],
    })),
  };
  await Promise.all([
    mkdir(path.dirname(outFile), { recursive: true }),
    mkdir(path.dirname(dispositionFile), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8'),
    writeFile(dispositionFile, `${JSON.stringify(disposition, null, 2)}\n`, 'utf8'),
  ]);
  const byPhase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [`P${phase}`, tasks.filter((task) => task.phase === phase).length]));
  const byStyle = Object.fromEntries(STYLE_FAMILIES.map((style) => [style, tasks.filter((task) => task.styleFamily === style).length]));
  const byPattern = Object.fromEntries(DATA_PATTERNS.map((pattern) => [pattern, tasks.filter((task) => task.domainSpec.dataPattern === pattern).length]));
  console.log(JSON.stringify({ source: records.length, selected: tasks.length, byPhase, byStyle, byPattern, outFile, dispositionFile }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
