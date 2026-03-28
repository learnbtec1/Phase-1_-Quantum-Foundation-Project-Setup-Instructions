// مسار المجلد الذي يحتوي على حركات VRMA (تأكد من مطابقته لمشروعك)
export const VRMA_BASE_PATH = '/models/animations/vrma_output/';

// خريطة النوايا (Intents) إلى أسماء ملفات الحركة
export const CogniAnimations: Record<string, string[]> = {
  idle: [
    'Idle1.vrma',
    'Idle2.vrma',
    'Idle3.vrma',
    'Breathing Idle.vrma',
    'Happy Idle.vrma',
  ],
  explaining: [
    'Having A Meeting, Male.vrma',
    'Sitting Talking.vrma',
    'Standing Arguing.vrma',
  ],
  pointing: ['Pointing.vrma', 'Sitting and pointing.vrma'],
  agreeing: [
    'Agreeing.vrma',
    'Acknowledging.vrma',
    'hard head YES.vrma',
    'Lengthy Head Nod.vrma',
  ],
  praising: ['Clapping.vrma', 'Cheering.vrma', 'Happy Hand Gesture.vrma'],
  disagreeing: [
    'annoyed head shake.vrma',
    'Thoughtful Head Shake.vrma',
    'Sarcastic Head No.vrma',
    'Sitting Disapproval.vrma',
  ],
  greeting: ['Waving.vrma', 'Quick Formal Bow.vrma', 'Salute.vrma'],
  thinking: ['Thinking.vrma', 'Focus.vrma', 'LookAround.vrma'],
};

export type CogniAnimationIntent = keyof typeof CogniAnimations;

/**
 * دالة لاختيار حركة عشوائية بناءً على النية (Intent)
 * @param intent - النية القادمة من نظام الذكاء الاصطناعي (مثل: 'praising')
 * @returns المسار الكامل لملف الحركة
 */
export function getRandomAnimationPath(intent: string): string {
  const category = CogniAnimations[intent] ? intent : 'idle';
  const animationsList = CogniAnimations[category];
  if (!animationsList?.length) {
    return `${VRMA_BASE_PATH}Idle1.vrma`;
  }
  const randomIndex = Math.floor(Math.random() * animationsList.length);
  const fileName = animationsList[randomIndex];
  return `${VRMA_BASE_PATH}${fileName}`;
}
