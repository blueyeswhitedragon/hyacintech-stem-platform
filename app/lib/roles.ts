export type UserRole = 'student' | 'teacher' | 'annotator' | 'reviewer' | 'admin';

export const DATA_LAB_ROLES: UserRole[] = ['annotator', 'reviewer', 'admin'];

export function isUserRole(value: string): value is UserRole {
  return ['student', 'teacher', ...DATA_LAB_ROLES].includes(value as UserRole);
}

export function isDataLabRole(role: UserRole): boolean {
  return DATA_LAB_ROLES.includes(role);
}

export function dashboardForRole(role: UserRole): string {
  if (role === 'teacher') return '/teacher/dashboard';
  if (isDataLabRole(role)) return '/data-lab';
  return '/student/dashboard';
}

export function roleLabel(role: UserRole): string {
  return {
    student: '学生',
    teacher: '教师',
    annotator: '标注者',
    reviewer: '复审者',
    admin: '管理员',
  }[role];
}
