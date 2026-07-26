"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';

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

  // 已完成的作业只是「可回看」，不该继续占用珊瑚色——那是留给待办动作的。
  return (
    <Button variant={completed ? 'secondary' : 'primary'} onClick={handleClick}>
      {label}
    </Button>
  );
}
