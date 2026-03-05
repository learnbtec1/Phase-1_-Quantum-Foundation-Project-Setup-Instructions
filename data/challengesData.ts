import type { ChallengeDefinition } from '@/types/gameTypes';

export const challengesData: ChallengeDefinition[] = [
  {
    id: 'pestle',
    title: 'تحليل PESTLE',
    description: 'اسحب العناصر إلى الخانات الصحيحة لتحليل البيئة الخارجية.',
    rewardXp: 150
  },
  {
    id: 'fourps',
    title: 'مزيج التسويق 4Ps',
    description: 'رتّب البطاقات للوصول إلى مزيج متوازن.',
    rewardXp: 150
  },
  {
    id: 'budget',
    title: 'توزيع الميزانية',
    description: 'وزّع الأموال على البنود دون تجاوز الحد.',
    rewardXp: 150
  },
  {
    id: 'competitors',
    title: 'تحليل المنافسين',
    description: 'قارن البيانات وحدد أقوى منافس.',
    rewardXp: 100
  },
  {
    id: 'campaign',
    title: 'حملة إعلانية',
    description: 'اختر القنوات المناسبة للحملة.',
    rewardXp: 200
  }
];
