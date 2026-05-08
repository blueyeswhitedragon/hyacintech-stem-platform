import { NextResponse } from 'next/server';
import { checkBlacklistedKeywords, getPromptForPhase } from '../../prompts';
import { PhaseEnum, ChatRequest, ChatResponse } from '../../models/types';

// 模拟LLM API调用的函数（实际项目中需要改为真实的API调用）
async function callLLMAPI(systemPrompt: string, message: string, history: any[]) {
  // 在这里，实际项目会调用OpenAI或DeepSeek等模型API
  // 为了演示，我们返回一个模拟响应
  
  console.log('系统提示词:', systemPrompt);
  console.log('用户消息:', message);
  console.log('对话历史:', history);
  
  // 根据不同的阶段和用户输入，返回不同的模拟响应
  const phase = history.length > 0 ? history.length % 6 + 1 : 1;
  
  // 模拟回复（实际项目中会由LLM生成）
  const mockResponses: Record<number, ChatResponse> = {
    1: {
      dialogue: "你好！我看到你对科学探究感兴趣。我是你的STEM教育指导教师。请告诉我你感兴趣的科学领域，我们一起将你的兴趣转化为一个可探究的科学问题。",
      next_action_type: "ask_choice",
      options: ["物理学（如力学、电学等）", "生物学（如植物生长、动物行为等）", "化学（如化学反应、物质性质等）", "地球科学（如天气、地质等）"],
      phase_complete: false
    },
    2: {
      dialogue: "非常好的选择！现在我们需要设计一个详细的实验方案。让我们先确定实验中的自变量、因变量和控制变量。你认为在这个实验中，你想要改变什么（自变量）？想要测量什么（因变量）？需要保持不变的是什么（控制变量）？",
      next_action_type: "text_input",
      phase_complete: false
    },
    3: {
      dialogue: "实验方案看起来不错！在开始实验前，请确保你已准备好所有材料。执行实验时，请记得记录所有观察数据。你准备好开始实验了吗？",
      next_action_type: "confirmation",
      phase_complete: false
    },
    4: {
      dialogue: "你收集的数据很有价值。现在让我们一起分析这些数据。首先，你认为应该用什么类型的图表来展示这些数据？条形图、折线图还是散点图？",
      next_action_type: "ask_choice",
      options: ["条形图", "折线图", "散点图", "饼图"],
      phase_complete: false
    },
    5: {
      dialogue: "数据分析做得很好！现在是时候将你的发现整理成一个完整的科学报告了。一份好的科学报告应包含：引言、材料与方法、结果、讨论和结论。你想从哪部分开始撰写？",
      next_action_type: "ask_choice",
      options: ["引言", "材料与方法", "结果", "讨论", "结论"],
      phase_complete: false
    },
    6: {
      dialogue: "恭喜你完成了科学报告！现在让我们一起反思整个研究过程。回顾这次科学探究，你认为最成功的部分是什么？你学到了什么？如果可以重新开始，你会有哪些改进？",
      next_action_type: "text_input",
      phase_complete: true
    }
  };

  return mockResponses[phase as PhaseEnum];
}

export async function POST(request: Request) {
  try {
    // 解析请求体
    const requestData: ChatRequest = await request.json();
    const { message, phase, history } = requestData;
    
    // 安全检查：检查黑名单关键词
    const blacklistedKeyword = checkBlacklistedKeywords(message);
    if (blacklistedKeyword) {
      return NextResponse.json({
        error: 'safety_violation',
        keyword: blacklistedKeyword,
        message: `您的请求包含可能存在安全风险的内容（${blacklistedKeyword}），请调整后重试。为了确保实验安全，我们建议使用更安全的替代方案。`
      }, { status: 400 });
    }
    
    // 获取对应阶段的提示词
    const systemPrompt = getPromptForPhase(phase as PhaseEnum);
    
    // 调用LLM API
    const response = await callLLMAPI(systemPrompt, message, history);
    
    // 返回响应
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('处理聊天请求时出错:', error);
    return NextResponse.json({ 
      error: 'internal_server_error', 
      message: '处理请求时发生错误，请稍后再试。' 
    }, { status: 500 });
  }
}