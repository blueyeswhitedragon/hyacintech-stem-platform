"use client";

import React from "react";
import PhaseIndicator from "./components/PhaseIndicator";
import ChatInterface from "./components/ChatInterface";
import SafetyFilter from "./components/SafetyFilter";

export default function Home() {
  const handleSafetyCheck = (text: string, isSafe: boolean, keyword?: string) => {
    // 可以在这里记录安全检查日志或执行其他操作
    if (!isSafe) {
      console.log(`安全警告: 检测到敏感关键词 "${keyword}" 在文本中`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col">
      {/* 头部 */}
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold text-blue-600">Hyacintech</h1>
            <span className="ml-4 font-medium text-gray-500">AI驱动的STEM教育平台</span>
          </div>
          <div>
            <span className="text-sm text-gray-500">让科创教育无边界</span>
          </div>
        </div>
      </header>
      
      {/* 主内容区 */}
      <div className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-6">
        {/* 左侧工具栏 */}
        <div className="w-full md:w-64 bg-white rounded-lg shadow-sm p-4">
          <PhaseIndicator />
          <div className="mt-8">
            <h3 className="font-medium mb-3">资源与工具</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center text-blue-600 hover:text-blue-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <a href="#">科学实验手册</a>
              </li>
              <li className="flex items-center text-blue-600 hover:text-blue-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <a href="#">教学视频</a>
              </li>
              <li className="flex items-center text-blue-600 hover:text-blue-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <a href="#">安全指南</a>
              </li>
              <li className="flex items-center text-blue-600 hover:text-blue-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <a href="#">历届优秀作品</a>
              </li>
            </ul>
          </div>
        </div>
        
        {/* 右侧聊天区 */}
        <div className="flex-1 bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b">
            <h2 className="text-lg font-medium">与STEM教育指导教师对话</h2>
            <p className="text-sm text-gray-500">AI教师将引导你完成科学探究的每个阶段</p>
          </div>
          
          <div className="flex-1 flex flex-col min-h-[500px]">
            <SafetyFilter onCheck={handleSafetyCheck}>
              <ChatInterface />
            </SafetyFilter>
          </div>
        </div>
      </div>
      
      {/* 页脚 */}
      <footer className="bg-gray-50 border-t py-6 mt-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-gray-500 text-sm">
          <p>Copyright © 2024 Hyacintech 团队. 保留所有权利。</p>
          <p className="mt-1">基于上海市课程标准，让STEM教育资源普惠全国各地学生</p>
        </div>
      </footer>
    </main>
  );
}