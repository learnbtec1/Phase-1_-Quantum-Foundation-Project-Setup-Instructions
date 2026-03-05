export type PESTLESection = 'Political' | 'Economic' | 'Social' | 'Technological' | 'Legal' | 'Environmental';
export type GradeType = 'Distinction' | 'Merit' | 'Pass' | 'Referral';

export interface GradingResult {
  grade: GradeType;
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export interface Evidence {
  id: string;
  entityName: string;
  category: string;
  timestamp: number;
  title: string;
  content: string;
}

export interface Assessment {
  id: string;
  unit: string;
  submission: string;
  grade: GradeType;
  score: number;
  timestamp: string;
  feedback?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'admin';
}
