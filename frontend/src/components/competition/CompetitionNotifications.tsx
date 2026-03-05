'use client';

import { useEffect, useState } from 'react';

interface NotificationItem {
  id: string;
  text: string;
  type: 'success' | 'info' | 'warning';
}

const initialNotifications: NotificationItem[] = [
  { id: 'n1', text: '⚡ فريق السرعة تقدم للمركز الثاني!', type: 'info' },
  { id: 'n2', text: '🏆 أحمد محمد حقق إنجاز ملك السرعة', type: 'success' },
  { id: 'n3', text: '⏱️ تبقى 3 دقائق على تحدي اليوم', type: 'warning' }
];

export default function CompetitionNotifications() {
  const [items, setItems] = useState(initialNotifications);

  useEffect(() => {
    const interval = setInterval(() => {
      setItems((prev) => {
        const next = [...prev];
        next.unshift({
          id: `n${Date.now()}`,
          text: '🔔 تم فتح تحدٍ جماعي جديد',
          type: 'info'
        });
        return next.slice(0, 4);
      });
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4">
      <h3 className="text-lg font-bold text-white mb-3">🔔 إشعارات المنافسة</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`text-sm rounded-lg px-3 py-2 ${
              item.type === 'success'
                ? 'bg-emerald-900/40 text-emerald-200'
                : item.type === 'warning'
                ? 'bg-yellow-900/40 text-yellow-200'
                : 'bg-blue-900/40 text-blue-200'
            }`}
          >
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
