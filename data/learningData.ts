import type { NPCDefinition } from '@/types/gameTypes';

export const npcDefinitions: NPCDefinition[] = [
  {
    id: 'npc-trainer',
    name: 'مدرب البداية',
    role: 'trainer',
    position: { x: -4, y: 0, z: 2 },
    avatarUrl: '/avatars/trainer.svg',
    dialogue: [
      { speaker: 'المدرب', text: 'مرحباً بك في غرفة المهمة. هدفك بناء خطة تسويق متكاملة.' },
      { speaker: 'المدرب', text: 'ابدأ بتحليل البيئة الخارجية عبر PESTLE.' }
    ],
    challengeId: 'pestle'
  },
  {
    id: 'npc-market',
    name: 'محلل السوق',
    role: 'market-analyst',
    position: { x: 3, y: 0, z: -3 },
    avatarUrl: '/avatars/analyst.svg',
    dialogue: [
      { speaker: 'محلل السوق', text: 'سنفحص العوامل السياسية والاقتصادية والاجتماعية والتقنية.' },
      { speaker: 'محلل السوق', text: 'أكمل شبكة PESTLE لتفتح المرحلة التالية.' }
    ],
    challengeId: 'pestle'
  },
  {
    id: 'npc-product',
    name: 'مدير المنتج',
    role: 'product-manager',
    position: { x: -2, y: 0, z: -4 },
    avatarUrl: '/avatars/product.svg',
    dialogue: [
      { speaker: 'مدير المنتج', text: 'أريد مزيج تسويق متوازن لـ 4Ps.' },
      { speaker: 'مدير المنتج', text: 'اضبط القيم بحيث تكون واقعية ومتقاربة.' }
    ],
    challengeId: 'fourps'
  },
  {
    id: 'npc-finance',
    name: 'المدير المالي',
    role: 'finance-manager',
    position: { x: 4, y: 0, z: 4 },
    avatarUrl: '/avatars/finance.svg',
    dialogue: [
      { speaker: 'المدير المالي', text: 'نحتاج ميزانية متوازنة وتوزيع منطقي.' },
      { speaker: 'المدير المالي', text: 'حافظ على المصروف ضمن الحد.' }
    ],
    challengeId: 'budget'
  },
  {
    id: 'npc-host',
    name: 'منظم المسابقة',
    role: 'tournament-host',
    position: { x: 0, y: 0, z: 5 },
    avatarUrl: '/avatars/host.svg',
    dialogue: [
      { speaker: 'المنظم', text: 'حان وقت التحدي النهائي!' },
      { speaker: 'المنظم', text: 'اختر القنوات الإعلانية المناسبة.' }
    ],
    challengeId: 'campaign'
  }
];
