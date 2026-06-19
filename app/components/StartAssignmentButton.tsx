"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  assignmentId: string;
  started: boolean;
  completed?: boolean;
}

export default function StartAssignmentButton({ assignmentId, started, completed }: Props) {
  const router = useRouter();

  const handleClick = () => router.push(`/student/assignments/${assignmentId}`);

  let label: string;
  if (completed) label = '查看';
  else if (started) label = '继续';
  else label = '开始';

  return (
    <button onClick={handleClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${completed ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
      {label}
    </button>
  );
}
