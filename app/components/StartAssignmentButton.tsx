"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  assignmentId: string;
  started: boolean;
}

export default function StartAssignmentButton({ assignmentId, started }: Props) {
  const router = useRouter();

  // 会话页 /student/assignments/[id] 会自动 find-or-create 会话。
  const handleClick = () => {
    router.push(`/student/assignments/${assignmentId}`);
  };

  return (
    <button
      onClick={handleClick}
      className="bg-blue-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-600 whitespace-nowrap"
    >
      {started ? '继续' : '开始'}
    </button>
  );
}
