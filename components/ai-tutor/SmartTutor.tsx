"use client";
import React, { useState, useEffect, useRef } from 'react';

export default function SmartTutor({ taskMessage }: { taskMessage?: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState([
    { id: 1, text: 'مرحباً! أنا أحمد، صديقك ومعلمك في هذه الرحلة التعليمية. كيف حالك اليوم؟', sender: 'tutor', timestamp: new Date() }
  ]);
  const [inputText, setInputText] = useState('');
  const [userLevel, setUserLevel] = useState('beginner'); // beginner, intermediate, advanced
  const [weakPoints, setWeakPoints] = useState<string[]>([]);
  const [tutorMood, setTutorMood] = useState('friendly'); // friendly, encouraging, analytical
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // نقاط الضعف الشائعة بناءً على المستوى
  const commonWeakPoints = {
    beginner: ['التخطيط للمشروع', 'تحليل المتطلبات', 'تنظيم الوقت'],
    intermediate: ['التفاصيل الدقيقة', 'التحليل العميق', 'التوثيق'],
    advanced: ['التحسينات المتقدمة', 'الابتكار', 'التقييم النقدي']
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const analyzeResponse = (text: string) => {
    // تحليل إجابة الطالب لتحديد نقاط الضعف
    const newWeakPoints = [...weakPoints];
    
    if (text.length < 20 && !weakPoints.includes('التوضيح')) {
      newWeakPoints.push('التوضيح');
    }
    
    if (!text.includes('و') && !text.includes('ثم') && !weakPoints.includes('الربط بين الأفكار')) {
      newWeakPoints.push('الربط بين الأفكار');
    }
    
    setWeakPoints(newWeakPoints);
    
    // تحديد مستوى الطالب بناءً على الإجابة
    if (text.length > 100 && newWeakPoints.length < 2) {
      setUserLevel('advanced');
    } else if (text.length > 50) {
      setUserLevel('intermediate');
    }
    
    // تغيير مزاج المعلم بناءً على الجواب
    if (text.includes('😊') || text.includes('جيد')) {
      setTutorMood('encouraging');
    } else if (text.includes('؟') || text.includes('مساعدة')) {
      setTutorMood('analytical');
    } else {
      setTutorMood('friendly');
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    // إضافة رسالة المستخدم
    const userMessage = {
      id: messages.length + 1,
      text: inputText,
      sender: 'user',
      timestamp: new Date()
    };

    // تحليل الإجابة
    analyzeResponse(inputText);

    // إضافة رد المعلم الذكي
    setTimeout(() => {
      const responses = {
        friendly: [
          `أرى أنك تتقدم بشكل جيد! ${weakPoints.length > 0 ? `لاحظت أن ${weakPoints[weakPoints.length - 1]} يحتاج بعض الاهتمام، هل تريد مساعدة في ذلك؟` : 'استمر في هذا النهج!'}`,
          'ممتاز! هذا التفكير في الاتجاه الصحيح. دعنا نعمق الفكرة قليلاً...',
          'شكراً لمشاركة أفكارك! هذا يظهر أنك تفكر بطريقة نقدية، وهو أمر رائع.'
        ],
        encouraging: [
          'رائع! هذا التقدم ملحوظ. أنا فخور بك!',
          'إجابة ممتازة! لاحظت تطوراً كبيراً في تفكيرك منذ آخر مرة.',
          'أحسنت! الآن دعنا نأخذ هذه الفكرة إلى المستوى التالي...'
        ],
        analytical: [
          `بناءً على إجابتك، أقترح التركيز على: ${commonWeakPoints[userLevel as keyof typeof commonWeakPoints].join('، ')}`,
          'لاحظت شيئاً مهماً في تفكيرك. دعنا نحلله معاً...',
          'هذا سؤال ممتاز! يدل على فضولك المعرفي. للإجابة عليه بشكل كامل، نحتاج إلى...'
        ]
      };

      const tutorResponse = {
        id: messages.length + 2,
        text: responses[tutorMood as keyof typeof responses][
          Math.floor(Math.random() * responses[tutorMood as keyof typeof responses].length)
        ],
        sender: 'tutor',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, userMessage, tutorResponse]);
    }, 1000);

    setInputText('');
  };

  const getPersonalizedAdvice = () => {
    if (weakPoints.length === 0) {
      return 'أنت على المسار الصحيح! استمر في التقدم بنفس الوتيرة.';
    }
    
    return `لتحسين أدائك، أنصحك بالتركيز على: ${weakPoints.slice(0, 3).join('، ')}`;
  };

  const getTutorAvatar = () => {
    const avatars = {
      friendly: '👨‍🏫',
      encouraging: '🌟',
      analytical: '🔍'
    };
    return avatars[tutorMood as keyof typeof avatars];
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-cyan-500/30 backdrop-blur-xl p-6 rounded-3xl w-96 shadow-2xl animate-fadeIn">
          {/* Header with Tutor Personality */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center text-2xl">
                {getTutorAvatar()}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-slate-900"></div>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-cyan-400 text-lg">أحمد - معلمك الشخصي</h3>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-1 h-3 bg-cyan-500/50 mx-0.5 rounded-full"></div>
                  ))}
                </div>
                <span className="text-xs text-slate-400">
                  {userLevel === 'beginner' ? 'مبتدئ' : userLevel === 'intermediate' ? 'متوسط' : 'متقدم'}
                </span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Weakness Analysis */}
          {weakPoints.length > 0 && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-400">🔍 نقاط تحتاج تطوير</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {weakPoints.slice(0, 3).map((point, index) => (
                  <span key={index} className="px-2 py-1 bg-red-900/40 rounded-lg text-xs">
                    {point}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="h-64 overflow-y-auto mb-4 space-y-4 p-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-2xl ${
                    message.sender === 'user'
                      ? 'bg-cyan-900/30 border border-cyan-500/20 rounded-br-none'
                      : 'bg-slate-800/50 border border-slate-700/50 rounded-bl-none'
                  }`}
                >
                  <p className="text-sm">{message.text}</p>
                  <span className="text-xs opacity-50 mt-1 block">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Personalized Advice */}
          <div className="mb-4 p-3 bg-cyan-900/20 border border-cyan-500/30 rounded-xl">
            <p className="text-sm text-cyan-300">💡 نصيحة شخصية: {getPersonalizedAdvice()}</p>
          </div>

          {/* Input Area */}
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="اكتب سؤالك أو تحدث عن تقدمك..."
              className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSendMessage}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 px-4 rounded-xl hover:opacity-90 transition-opacity"
            >
              ↲
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                setInputText('أحتاج مساعدة في فهم هذا الجزء');
                setTimeout(() => handleSendMessage(), 100);
              }}
              className="flex-1 text-xs p-2 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors"
            >
              🤔 أسئلة تحتاج توضيح
            </button>
            <button
              onClick={() => {
                setInputText('كيف أعرف أنني على المسار الصحيح؟');
                setTimeout(() => handleSendMessage(), 100);
              }}
              className="flex-1 text-xs p-2 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors"
            >
              ✅ تحقق من التقدم
            </button>
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="mt-4 float-right bg-gradient-to-r from-cyan-500 to-blue-600 p-5 rounded-2xl shadow-2xl hover:scale-110 transition-all duration-300 animate-pulse-slow relative group"
        aria-label="التحدث مع المعلم الذكي"
      >
        <div className="text-2xl">👨‍🏫</div>
        
        {/* Notification badge for new advice */}
        {weakPoints.length > 0 && (
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-xs animate-bounce">
            {weakPoints.length}
          </div>
        )}
        
        <div className="absolute -left-40 top-1/2 transform -translate-y-1/2 bg-slate-900 text-white px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm">
          تحدث مع معلمك أحمد
        </div>
      </button>
    </div>
  );
}