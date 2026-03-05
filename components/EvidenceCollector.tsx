"use client";
import React, { useState } from 'react';

interface Evidence {
  id: string;
  type: 'interview' | 'observation' | 'photo' | 'report' | 'article' | 'website';
  title: string;
  content: string;
  category: 'primary' | 'secondary';
  source?: string;
  timestamp: Date;
}

interface EvidenceCollectorProps {
  onEvidenceAdded?: (evidence: Evidence) => void;
  collectedEvidence?: Evidence[];
}

const evidenceIcons: Record<string, string> = {
  interview: '🎤',
  observation: '👁️',
  photo: '📸',
  report: '📄',
  article: '📰',
  website: '🌐'
};

const evidenceLabels: Record<string, string> = {
  interview: 'مقابلة',
  observation: 'ملاحظة',
  photo: 'صورة',
  report: 'تقرير',
  article: 'مقال',
  website: 'موقع إلكتروني'
};

export default function EvidenceCollector({ onEvidenceAdded, collectedEvidence = [] }: EvidenceCollectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<Evidence['type']>('interview');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState<'primary' | 'secondary'>('primary');

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;

    const newEvidence: Evidence = {
      id: `ev_${Date.now()}`,
      type: selectedType,
      title,
      content,
      category,
      source: source || undefined,
      timestamp: new Date()
    };

    onEvidenceAdded?.(newEvidence);

    // إعادة تعيين الحقول
    setTitle('');
    setContent('');
    setSource('');
    setIsOpen(false);
  };

  return (
    <>
      {/* زر فتح مجمع الأدلة */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-24 right-6 z-[100] bg-gradient-to-br from-purple-600 to-indigo-700 text-white px-5 py-3 rounded-2xl shadow-xl hover:shadow-purple-500/50 transition-all flex items-center gap-3 font-bold"
      >
        <span className="text-2xl">📝</span>
        <div className="text-left">
          <div className="text-xs opacity-80">دفتر الأدلة</div>
          <div className="text-sm">{collectedEvidence.length} دليل</div>
        </div>
      </button>

      {/* نافذة الأدلة */}
      {isOpen && (
        <div className="fixed inset-0 z-[250] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-purple-900/50 to-indigo-900/50">
              <div>
                <h2 className="text-2xl font-black text-white">📝 دفتر الأدلة</h2>
                <p className="text-sm text-white/60">جمع وتوثيق الأدلة البحثية</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                aria-label="Close"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* قسم إضافة دليل جديد */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                <h3 className="text-white font-bold mb-4 text-lg">➕ إضافة دليل جديد</h3>

                {/* اختيار نوع الدليل */}
                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2 font-semibold">نوع الدليل</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['interview', 'observation', 'photo', 'report', 'article', 'website'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => {
                          setSelectedType(type);
                          setCategory(type === 'interview' || type === 'observation' || type === 'photo' ? 'primary' : 'secondary');
                        }}
                        className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                          selectedType === type
                            ? 'bg-purple-500/20 border-purple-500 text-white'
                            : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        <span className="text-2xl">{evidenceIcons[type]}</span>
                        <span className="text-xs font-medium">{evidenceLabels[type]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* تصنيف البحث */}
                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2 font-semibold">تصنيف البحث</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCategory('primary')}
                      className={`flex-1 py-2 px-4 rounded-xl border-2 font-bold transition-all ${
                        category === 'primary'
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                          : 'bg-white/5 border-white/10 text-white/50'
                      }`}
                    >
                      بحث أولي
                    </button>
                    <button
                      onClick={() => setCategory('secondary')}
                      className={`flex-1 py-2 px-4 rounded-xl border-2 font-bold transition-all ${
                        category === 'secondary'
                          ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                          : 'bg-white/5 border-white/10 text-white/50'
                      }`}
                    >
                      بحث ثانوي
                    </button>
                  </div>
                </div>

                {/* عنوان الدليل */}
                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2 font-semibold">عنوان الدليل</label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="مثال: مقابلة مع صاحب المزرعة العائلية"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:border-purple-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* محتوى الدليل */}
                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2 font-semibold">محتوى/ملاحظات الدليل</label>
                  <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="اكتب ملاحظاتك، ملخص المقابلة، أو وصف الملاحظة..."
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:border-purple-500 focus:outline-none transition-colors resize-none"
                  />
                </div>

                {/* المصدر */}
                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2 font-semibold">المصدر (اختياري)</label>
                  <input
                    type="text"
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    placeholder="مثال: موقع الشركة الرسمي، تقرير سنوي..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:border-purple-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* زر الإضافة */}
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || !content.trim()}
                  className="w-full py-3 rounded-xl font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-indigo-700 text-white hover:shadow-lg hover:shadow-purple-500/50"
                >
                  ✓ حفظ الدليل
                </button>
              </div>

              {/* قائمة الأدلة المجمعة */}
              <div>
                <h3 className="text-white font-bold mb-4 text-lg">📚 الأدلة المجمعة ({collectedEvidence.length})</h3>
                {collectedEvidence.length === 0 ? (
                  <div className="text-center py-12 text-white/30">
                    <p className="text-4xl mb-2">📭</p>
                    <p>لم تقم بجمع أي أدلة بعد</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {collectedEvidence.map(ev => (
                      <div key={ev.id} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className="text-3xl">{evidenceIcons[ev.type]}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-white font-bold">{ev.title}</h4>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                ev.category === 'primary' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-orange-500/20 text-orange-400'
                              }`}>
                                {ev.category === 'primary' ? 'أولي' : 'ثانوي'}
                              </span>
                            </div>
                            <p className="text-sm text-white/60 mb-2">{ev.content}</p>
                            {ev.source && (
                              <p className="text-xs text-white/40">المصدر: {ev.source}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
