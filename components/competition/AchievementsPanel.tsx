'use client';

const achievements = [
  { title: 'ملك السرعة', desc: 'أنهى 3 تحديات بأسرع وقت' },
  { title: 'دقة القناص', desc: 'حقق دقة 95% في التقييم' },
  { title: 'مثابرة الحديد', desc: 'أكمل 5 مهام متتالية' },
];

const ranks = ['مبتدئ', 'متوسط', 'خبير', 'محترف', 'ماستر'];

export default function AchievementsPanel() {
  return (
    <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
      <h3 className="text-xl font-bold mb-4">🎖️ الإنجازات والرتب</h3>
      <div className="mb-4">
        <div className="text-sm text-gray-400 mb-2">الرتبة الحالية</div>
        <div className="flex flex-wrap gap-2">
          {ranks.map((rank, index) => (
            <span key={rank} className={`px-3 py-1 rounded-full text-xs font-bold ${index === 2 ? 'bg-purple-900 text-purple-200' : 'bg-gray-800 text-gray-400'}`}>
              {rank}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {achievements.map((achievement) => (
          <div key={achievement.title} className="p-3 rounded-xl bg-gray-800/50 border border-gray-700">
            <div className="font-bold text-white">{achievement.title}</div>
            <div className="text-xs text-gray-400">{achievement.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
