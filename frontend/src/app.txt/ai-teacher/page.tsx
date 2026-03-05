'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
// تأكد أن مسار useAuth صحيح لديك، وإذا لم يكن لديك Auth حالياً يمكنك تعليق هذا السطر
// import { useAuth } from '@/hooks/useAuth'; 
import { toast } from 'react-hot-toast';
import { 
  Brain, Send, Bot, User, Sparkles, BookOpen, Target, TrendingUp, 
  AlertCircle, Trophy, Lightbulb, Zap, Star, ThumbsUp, MessageCircle,
  Award, GraduationCap, ChevronRight, HelpCircle, Clock, Bookmark
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type?: 'question' | 'explanation' | 'tip' | 'feedback';
}

interface Weakness {
  id: string;
  topic: string;
  level: 'low' | 'medium' | 'high';
  lastOccurred: Date;
  suggestions: string[];
}

// قمنا بتغيير الاسم هنا ليتطابق مع الاستدعاء
export default function AiTeacherChat() {
  const router = useRouter();
  // const { isAuthenticated } = useAuth(); // تفعيل هذا السطر لاحقاً عند ضبط المصادقة
  const isAuthenticated = true; // مؤقت ليعمل الكود الآن

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'مرحباً! أنا د. أحمد، معلمك الشخصي في رحلة BTEC. اليوم سنعمل معاً على تطوير مهاراتك التحليلية. كيف كان يومك الدراسي؟',
      timestamp: new Date(),
      type: 'question'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userLevel, setUserLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([
    { 
      id: '1', 
      topic: 'التحليل النقدي', 
      level: 'medium', 
      lastOccurred: new Date(),
      suggestions: ['استخدم أسئلة "لماذا" متعددة', 'قارن بين وجهات نظر مختلفة', 'اربط مع أمثلة واقعية']
    },
    { 
      id: '2', 
      topic: 'استخدام المصادر', 
      level: 'low', 
      lastOccurred: new Date(),
      suggestions: ['استخدم مصادر أكاديمية متنوعة', 'وثق المصادر بشكل صحيح', 'انقد موثوقية المصادر']
    }
  ]);
  const [conversationContext, setConversationContext] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  /* useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isAuthenticated, router]);
  */
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  
  // if (!isAuthenticated) return null;
  
  const analyzeUserResponse = (text: string): {
    level: 'beginner' | 'intermediate' | 'advanced';
    weaknesses: Weakness[];
    context: string;
  } => {
    const newWeaknesses = [...weaknesses];
    let detectedLevel = userLevel;
    
    // تحليل مستوى اللغة والتفكير
    const wordCount = text.split(' ').length;
    const hasCriticalWords = text.includes('لأن') || text.includes('بسبب') || text.includes('مقارنة');
    const hasAdvancedTerms = text.includes('التحليل') || text.includes('الاستراتيجية') || text.includes('التقييم');
    
    if (wordCount > 100 && hasAdvancedTerms && hasCriticalWords) {
      detectedLevel = 'advanced';
    } else if (wordCount > 50 && hasCriticalWords) {
      detectedLevel = 'intermediate';
    } else {
      detectedLevel = 'beginner';
    }
    
    // اكتشاف نقاط الضعف
    if (wordCount < 30 && !weaknesses.find(w => w.topic === 'التوضيح والتوسع')) {
      newWeaknesses.push({
        id: Date.now().toString(),
        topic: 'التوضيح والتوسع',
        level: 'medium',
        lastOccurred: new Date(),
        suggestions: ['أضف أمثلة توضيحية', 'اشرح الفكرة بتوسع أكثر', 'استخدم مقارنات']
      });
    }
    
    if (!text.includes('مصدر') && !text.includes('دراسة') && !text.includes('بحث')) {
      const existing = weaknesses.find(w => w.topic === 'استخدام المصادر');
      if (existing) {
        existing.level = 'high';
        existing.lastOccurred = new Date();
      }
    }
    
    // استخراج السياق
    let context = conversationContext;
    if (text.includes('pestle') || text.includes('بيستل')) {
      context = 'pestle';
    } else if (text.includes('swot') || text.includes('سوات')) {
      context = 'swot';
    } else if (text.includes('distinction') || text.includes('تميز')) {
      context = 'grading';
    }
    
    return { level: detectedLevel, weaknesses: newWeaknesses, context };
  };
  
  const getPersonalizedResponse = (
    userInput: string, 
    userLevel: string, 
    context: string
  ): string => {
    const analysis = analyzeUserResponse(userInput);
    
    // ردود بناءً على السياق والمستوى
    const responses = {
      pestle: {
        beginner: `ممتاز! أنت تبدأ في فهم PESTLE. دعني أشرحه لك كما لو كنت أشرح لزميل:\n\nتخيل أنك تفتح مشروعاً جديداً - PESTLE يسألك 6 أسئلة أساسية:\n1️⃣ السياسي: هل القوانين تساعد أم تعيق؟\n2️⃣ الاقتصادي: هل الناس عندهم فلوس يشتروا منتجك؟\n3️⃣ الاجتماعي: هل المجتمع بيقبل الفكرة؟\n\nما رأيك نبدأ بتحليل شركة نعرفها معاً؟`,
        intermediate: `تحليل عميق! أرى أنك تفهم الأساسيات. الآن لنرتفع لمستوى أعلى:\n\nالتميز في PESTLE يأتي من:\n• الربط بين العوامل (كيف يؤثر الاقتصادي على الاجتماعي؟)\n• النظر للمستقبل (الاتجاهات القادمة)\n• التقييم الكمي (مدى التأثير من 1-10)\n\nهل تريد أن نتدرب على تحليل متكامل؟`,
        advanced: `تحليل استثنائي! أنت جاهز للتميز. التحدي الآن هو:\n• الابتكار في الربط بين العوامل غير التقليدية\n• التنبؤ بالمستقبل باستخدام البيانات\n• تقديم توصيات قابلة للتطبيق فعلياً\n\nلدي تمرين متقدم إذا كنت مستعداً...`
      },
      swot: {
        beginner: `SWOT هو أفضل صديق للمحلل! فكر فيه كمرآة للمشروع:\n\n🔍 نقاط القوة: ماذا تجيد؟ (مهاراتك الفريدة)\n⚠️ نقاط الضعف: أين تحتاج تحسين؟ (لا تخف، كلنا عندنا)\n🚀 الفرص: ما الفرص حولك؟ (السوق، التكنولوجيا)\n🌪️ التهديدات: ما التحديات؟ (المنافسة، التغيرات)\n\nلنبدأ بمشروعك الدراسي - ما أقوى نقطة فيه؟`,
        intermediate: `تحليل SWOT لديك جيد! للوصول للتميز:\n• اجعل كل نقطة محددة وقابلة للقياس\n• اربط القوة بفرصة (كيف تستغل ما تملكه؟)\n• حوّل الضعف لفرصة (كيف تتعلم منه؟)\n\nهل تريد أن أشاركك أمثلة من مشاريع حقيقية؟`,
        advanced: `تحليل احترافي! أنت تفهم أن SWOT ليس قائمة بل خريطة علاقات. التميز يأتي من:\n• تحليل التفاعل بين العناصر (كيف تحمي القوة من التهديد؟)\n• وضع استراتيجيات متعددة الخطوات\n• التقييم المستمر والتحديث\n\nلدي حالة دراسية معقدة لتتحدى مهاراتك...`
      },
      grading: {
        beginner: `للتميز، ركز على الأساسيات أولاً:\n✅ فهم السؤال تماماً\n✅ تنظيم الأفكار بوضوح\n✅ استخدام المصادر الأساسية\n✅ الكتابة بلغة صحيحة\n\nأرى أنك على الطريق الصحيح! ما أكبر تحدي تواجهه؟`,
        intermediate: `أنت على بعد خطوات من التميز! ركز على:\n⭐ العمق في التحليل (لماذا × 3)\n⭐ ربط النظريات بالتطبيق\n⭐ التفكير النقدي في المصادر\n⭐ الإبداع في الحلول\n\nهل تريد مراجعة نموذج تقرير ممتاز معاً؟`,
        advanced: `مستوى متميز! الآن للوصول للقمة:\n🏆 الابتكار في المنهجية\n🏆 تحليل متعدد الأبعاد\n🏆 توصيات عملية وقابلة للقياس\n🏆 تقييم ذاتي نقدي\n\nأقترح أن نعمل على مشروع بحثي صغير لصقل مهاراتك...`
      },
      default: {
        beginner: `شكراً لمشاركتك! أرى حماساً للتعلم. كمعلمك، أنصحك بالتركيز على:\n\n📚 فهم الأساسيات جيداً\n🎯 التدرب على الأمثلة البسيطة أولاً\n🤔 طرح الأسئلة باستمرار\n\nما الموضوع الذي تريد البدء به اليوم؟`,
        intermediate: `تفكير ناضج! هذا يظهر تطور ملحوظ. لتطوير مهاراتك أكثر:\n\n🔗 اربط ما تتعلمه بواقعك\n📊 استخدم أدوات تحليل متنوعة\n💡 فكر خارج الصندوق\n\nهل لديك مشروع معين تريد تحسينه؟`,
        advanced: `مستوى متقدم! أنت لا تحتاج معلماً بل شريك تفكير. دعنا نركز على:\n\n🚀 تحدي الافتراضات التقليدية\n🎨 الابتكار في المنهجيات\n🌍 الربط بالسياق العالمي\n\nما التحدي الأكاديمي الذي يواجهك؟`
      }
    };
    
    const contextKey = context || 'default';
    const levelKey = analysis.level || 'beginner';
    
    return responses[contextKey as keyof typeof responses]?.[levelKey as keyof typeof responses['default']] 
      || responses.default[levelKey as keyof typeof responses['default']];
  };
  
  const handleSend = async () => {
    if (!input.trim()) return;
    
    // إضافة رسالة المستخدم
    const userMessage: Message = { 
      role: 'user', 
      content: input,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    
    // تحليل الاستجابة
    const analysis = analyzeUserResponse(input);
    setUserLevel(analysis.level);
    setWeaknesses(analysis.weaknesses);
    setConversationContext(analysis.context);
    
    // استجابة المعلم الذكي
    setTimeout(() => {
      const response = getPersonalizedResponse(input, analysis.level, analysis.context);
      
      const assistantMessage: Message = { 
        role: 'assistant', 
        content: response,
        timestamp: new Date(),
        type: 'explanation'
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      // إضافة سؤال متابعة بعد 2 ثانية
      setTimeout(() => {
        const followUpQuestions = [
          "ما الجزء الذي وجدته أصعب في فهم هذا المفهوم؟",
          "هل تريد أن أشرح نقطة معينة بتفصيل أكثر؟",
          "هل لديك مثال من واقعك تريد تحليله معاً؟",
          "كيف ستطبق هذا المفهوم في مشروعك القادم؟"
        ];
        
        const followUpMessage: Message = {
          role: 'assistant',
          content: followUpQuestions[Math.floor(Math.random() * followUpQuestions.length)],
          timestamp: new Date(),
          type: 'question'
        };
        
        setMessages(prev => [...prev, followUpMessage]);
      }, 2000);
      
      setIsLoading(false);
      
      // إشعار بنقاط التطوير
      if (analysis.weaknesses.length > weaknesses.length) {
        toast.success('لقد حددت نقطة تطوير جديدة! راجع قسم "نقاط التطوير"', {
          icon: '🎯',
          duration: 4000,
        });
      }
    }, 1500);
  };
  
  const quickQuestions = [
    { text: 'كيف أحلل شركة باستخدام PESTLE؟', icon: <Target className="w-4 h-4" /> },
    { text: 'ما الفرق بين Merit و Distinction؟', icon: <Trophy className="w-4 h-4" /> },
    { text: 'كيف أطور تحليلي النقدي؟', icon: <TrendingUp className="w-4 h-4" /> },
    { text: 'أمثلة عملية على SWOT', icon: <Lightbulb className="w-4 h-4" /> }
  ];
  
  return (
    <div className="w-full h-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
          {/* العمود الأيسر: معلومات الطالب */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-1 space-y-6 overflow-y-auto custom-scrollbar pr-2"
            style={{maxHeight: 'calc(100vh - 200px)'}}
          >
            {/* بطاقة مستوى الطالب */}
            <div className="glass-nexus rounded-2xl p-6 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                  <User className="w-5 h-5" />
                  مستواك الحالي
                </h3>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                  userLevel === 'beginner' ? 'bg-blue-500/20 text-blue-400' :
                  userLevel === 'intermediate' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-amber-500/20 text-amber-400'
                }`}>
                  {userLevel === 'beginner' ? 'مبتدئ' : 
                   userLevel === 'intermediate' ? 'متوسط' : 'متقدم'}
                </span>
              </div>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1 text-gray-300">
                    <span>التحليل النقدي</span>
                    <span>65%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full w-[65%]"></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1 text-gray-300">
                    <span>الفهم النظري</span>
                    <span>80%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-500 to-cyan-500 rounded-full w-[80%]"></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1 text-gray-300">
                    <span>التطبيق العملي</span>
                    <span>45%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full w-[45%]"></div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* نقاط التطوير */}
            <div className="glass-nexus rounded-2xl p-6 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                  <AlertCircle className="w-5 h-5" />
                  نقاط التطوير
                </h3>
                <span className="text-xs text-gray-400">{weaknesses.length} نقطة</span>
              </div>
              
              <div className="space-y-3">
                <AnimatePresence>
                  {weaknesses.slice(0, 3).map((weakness, index) => (
                    <motion.div
                      key={weakness.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="p-3 bg-gray-900/50 rounded-xl border border-gray-800"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">{weakness.topic}</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          weakness.level === 'low' ? 'bg-green-500/20 text-green-400' :
                          weakness.level === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {weakness.level === 'low' ? 'منخفض' : 
                           weakness.level === 'medium' ? 'متوسط' : 'مرتفع'}
                        </span>
                      </div>
                      <ul className="text-sm text-gray-400 space-y-1">
                        {weakness.suggestions.slice(0, 2).map((suggestion, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" />
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              
              <button className="w-full mt-4 p-2 text-sm bg-gray-900/50 rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 text-gray-300">
                <BookOpen className="w-4 h-4" />
                عرض جميع النقاط
              </button>
            </div>
            
            {/* الأسئلة السريعة */}
            <div className="glass-nexus rounded-2xl p-6 border border-white/5">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
                <Zap className="w-5 h-5" />
                أسئلة مقترحة
              </h3>
              
              <div className="space-y-2">
                {quickQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q.text)}
                    className="w-full text-right p-3 bg-gray-900/30 hover:bg-gray-800/50 rounded-xl transition-all hover:translate-x-1 group flex items-center justify-between"
                  >
                    <span className="text-sm text-gray-300 group-hover:text-white">{q.text}</span>
                    <div className="text-gray-500 group-hover:text-cyan-400 transition-colors">
                      {q.icon}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
          
          {/* العمود الأيمن: المحادثة */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-2 flex flex-col h-full overflow-hidden"
          >
              {/* منطقة المحادثة */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                <AnimatePresence>
                  {messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`flex items-start gap-3 ${
                        message.role === 'user' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                        message.role === 'assistant' 
                          ? 'bg-gradient-to-br from-cyan-500 to-blue-600' 
                          : 'bg-gray-800 border border-gray-700'
                      }`}>
                        {message.role === 'assistant' ? (
                          <Bot className="w-5 h-5 text-white" />
                        ) : (
                          <User className="w-5 h-5 text-white" />
                        )}
                      </div>
                      
                      <motion.div
                        initial={{ scale: 0.95 }}
                        animate={{ scale: 1 }}
                        className={`max-w-[85%] p-4 rounded-2xl relative ${
                          message.role === 'assistant'
                            ? 'bg-gray-800/80 border border-gray-700 text-gray-100'
                            : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white'
                        } ${message.role === 'assistant' ? 'rounded-bl-none' : 'rounded-br-none'}`}
                      >
                        {/* أيقونة نوع الرسالة */}
                        {message.role === 'assistant' && (
                          <div className="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center">
                            {message.type === 'question' ? (
                              <HelpCircle className="w-4 h-4 text-cyan-400" />
                            ) : message.type === 'tip' ? (
                              <Lightbulb className="w-4 h-4 text-amber-400" />
                            ) : (
                              <MessageCircle className="w-4 h-4 text-blue-400" />
                            )}
                          </div>
                        )}
                        
                        <div className="text-sm whitespace-pre-line leading-relaxed">
                          {message.content}
                        </div>
                        
                        <div className="text-xs opacity-50 mt-2 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {message.timestamp.toLocaleTimeString('ar-SA', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </div>
                      </motion.div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                
                {isLoading && (
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div className="bg-gray-900/70 border border-gray-800 rounded-2xl rounded-bl-none p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce bounce-delay-200"></div>
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce bounce-delay-400"></div>
                        </div>
                        <span className="text-sm text-gray-400">د. أحمد يفكر...</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
              
              {/* حقل الإدخال */}
              <div className="p-4 border-t border-gray-800 bg-gray-900/30">
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
                      placeholder="اكتب رسالتك لـ د. أحمد..."
                      className="w-full bg-gray-900/50 border border-gray-700 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all pr-12 text-white"
                      disabled={isLoading}
                    />
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-6 rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
                
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs text-gray-500">نصيحة: </span>
                  <button
                    onClick={() => setInput('أحتاج أمثلة عملية على ' + (conversationContext || 'PESTLE'))}
                    className="text-xs px-3 py-1 bg-gray-800/50 rounded-full hover:bg-gray-700 transition-colors text-gray-300"
                  >
                    أمثلة عملية
                  </button>
                  <button
                    onClick={() => setInput('كيف أحسن من ' + (weaknesses[0]?.topic || 'تحليلي النقدي'))}
                    className="text-xs px-3 py-1 bg-gray-800/50 rounded-full hover:bg-gray-700 transition-colors text-gray-300"
                  >
                    تحسين نقطة ضعف
                  </button>
                  <button
                    onClick={() => setInput('ما هو تقييمك لمستواي الحالي؟')}
                    className="text-xs px-3 py-1 bg-gray-800/50 rounded-full hover:bg-gray-700 transition-colors text-gray-300"
                  >
                    تقييم المستوى
                  </button>
                </div>
              </div>
          </motion.div>
        </div>
    </div>
  );
}