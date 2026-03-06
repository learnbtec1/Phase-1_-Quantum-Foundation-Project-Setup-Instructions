import type { Metadata } from 'next';
import AvatarAgentClient from './AvatarAgentClient';

export const metadata: Metadata = {
  title: 'Avatar Agent — NEXUS',
  description: 'محادثة صوتية مع الدكتور حمزة — النظام الذكي للتعلم التفاعلي',
};

export default function AvatarAgentPage() {
  return <AvatarAgentClient />;
}