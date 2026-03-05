'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Target,
  Globe,
  Cpu,
  Shield,
  DollarSign,
  Calendar,
  Zap,
  Lock,
  Unlock,
  CheckCircle,
  AlertCircle,
  Rocket,
  BarChart3,
  Users,
  Package,
  TrendingUp,
  MapPin,
  Megaphone,
  Clock,
  Star,
  Award,
  BrainCircuit,
  Network,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';

// أنواع البيانات
interface SMARTCriteria {
  specific: boolean;
  measurable: boolean;
  achievable: boolean;
  relevant: boolean;
  timeBound: boolean;
}

interface PESTLECard {
  id: string;
  title: string;
  description: string;
  factors: string[];
  completed: boolean;
  color: string;
}

interface MarketingMix {
  product: number;
  price: number;
  place: number;
  promotion: number;
}

interface BudgetItem {
  id: string;
  name: string;
  allocated: number;
  spent: number;
  category: string;
}

interface CriteriaStatus {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed';
  description: string;
}

export default function MarketingSimulation() {
  // حالة المحاكاة
  const [currentStage, setCurrentStage] = useState(1);
  const [businessType, setBusinessType] = useState('');
  const [companyName, setCompanyName] = useState('');

  // المعايير
  const [smartGoals, setSmartGoals] = useState<string>('');
  const [smartCriteria, setSmartCriteria] = useState<SMARTCriteria>({
    specific: false,
    measurable: false,
    achievable: false,
    relevant: false,
    timeBound: false
  });

  const [pestleCards, setPestleCards] = useState<PESTLECard[]>([
    { id: 'political', title: 'سياسي', description: 'القوانين واللوائح الحكومية', factors: [], completed: false, color: 'bg-red-500/20' },
    { id: 'economic', title: 'اقتصادي', description: 'الظروف الاقتصادية والتضخم', factors: [], completed: false, color: 'bg-blue-500/20' },
    { id: 'social', title: 'اجتماعي', description: 'العادات والتقاليد والثقافة', factors: [], completed: false, color: 'bg-green-500/20' },
    { id: 'technological', title: 'تكنولوجي', description: 'التطور التكنولوجي والابتكار', factors: [], completed: false, color: 'bg-purple-500/20' },
    { id: 'legal', title: 'قانوني', description: 'الجوانب القانونية والتشريعات', factors: [], completed: false, color: 'bg-yellow-500/20' },
    { id: 'environmental', title: 'بيئي', description: 'القضايا البيئية والاستدامة', factors: [], completed: false, color: 'bg-cyan-500/20' }
  ]);

  const [marketingMix, setMarketingMix] = useState<MarketingMix>({
    product: 50,
    price: 50,
    place: 50,
    promotion: 50
  });

  const [budget, setBudget] = useState<BudgetItem[]>([
    { id: 'research', name: 'بحث السوق', allocated: 5000, spent: 0, category: 'تحليل' },
    { id: 'product', name: 'تطوير المنتج', allocated: 15000, spent: 0, category: 'إنتاج' },
    { id: 'ads', name: 'الإعلانات', allocated: 8000, spent: 0, category: 'تسويق' },
    { id: 'salaries', name: 'الرواتب', allocated: 12000, spent: 0, category: 'عمليات' }
  ]);

  const [totalBudget, setTotalBudget] = useState(40000);
  const [totalSpent, setTotalSpent] = useState(0);

  const [criteriaStatus, setCriteriaStatus] = useState<CriteriaStatus[]>([
    { id: 'A.P1', title: 'أهداف SMART', status: 'pending', description: 'تحديد أهداف ذكية وقابلة للقياس' },
    { id: 'A.P2', title: 'تحليل PESTLE', status: 'pending', description: 'تحليل العوامل الخارجية الستة' },
    { id: 'A.M1', title: 'فعالية الأهداف', status: 'pending', description: 'ربط الأهداف بنجاح المنظمة' },
    { id: 'A.D1', title: 'تقييم نقدي', status: 'pending', description: 'تحديد المخاطر والضعف' },
    { id: 'B.P3', title: 'مزيج التسويق 4Ps', status: 'pending', description: 'تطبيق المنتج، السعر، المكان، الترويج' },
    { id: 'B.P4', title: 'الميزانية', status: 'pending', description: 'تخصيص الميزانية بشكل مناسب' },
    { id: 'B.P5', title: 'الجدول الزمني', status: 'pending', description: 'إنشاء خطة زمنية واقعية' },
    { id: 'B.M2', title: 'التبرير المنطقي', status: 'pending', description: 'شرح منطق الاستراتيجية' }
  ]);

  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);

  // تأثيرات صوتية ومرئية
  const audioRef = useRef<HTMLAudioElement>(null);

  // التحقق من المعايير تلقائياً
  useEffect(() => {
    checkCriteria();
    updateProgress();
  }, [smartGoals, pestleCards, marketingMix, budget]);

  const checkCriteria = () => {
    const newStatus = [...criteriaStatus];

    // A.P1: SMART Goals
    const isSmartComplete = Object.values(smartCriteria).every(v => v);
    newStatus[0].status = isSmartComplete ? 'completed' : smartGoals.length > 0 ? 'in-progress' : 'pending';

    // A.P2: PESTLE
    const pestleComplete = pestleCards.filter(card => card.completed).length >= 4;
    newStatus[1].status = pestleComplete ? 'completed' : pestleCards.some(c => c.factors.length > 0) ? 'in-progress' : 'pending';

    // B.P3: Marketing Mix
    const mixComplete = Object.values(marketingMix).every(v => v > 25 && v < 75);
    newStatus[4].status = mixComplete ? 'completed' : 'in-progress';

    // B.P4: Budget
    const budgetComplete = totalSpent <= totalBudget && budget.every(item => item.spent <= item.allocated);
    newStatus[5].status = budgetComplete ? 'completed' : 'in-progress';

    setCriteriaStatus(newStatus);
  };

  const updateProgress = () => {
    const completed = criteriaStatus.filter(c => c.status === 'completed').length;
    const total = criteriaStatus.length;
    const progress = (completed / total) * 100;

    // حساب XP
    const newXp = completed * 100;
    setXp(newXp);

    // مستوى جديد كل 500 XP
    const newLevel = Math.floor(newXp / 500) + 1;
    if (newLevel > level) {
      setLevel(newLevel);
      toast.success(`🎉 وصلت للمستوى ${newLevel}!`);
    }
  };

  const playSound = (type: 'click' | 'success' | 'error') => {
    if (audioRef.current) {
      // يمكن إضافة تأثيرات صوتية هنا
    }
  };

  // مراحل المحاكاة
  const renderStage = () => {
    switch (currentStage) {
      case 1:
        return renderMissionBriefing();
      case 2:
        return renderWarRoom();
      case 3:
        return renderLab();
      case 4:
        return renderVault();
      case 5:
        return renderControlCenter();
      default:
        return renderMissionBriefing();
    }
  };

  // المرحلة 1: غرفة المهمة
  const renderMissionBriefing = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative glass p-8 rounded-3xl border border-cyan-500/30"
    >
      <div className="absolute top-4 right-4">
        <div className="flex items-center gap-2 bg-black/50 px-4 py-2 rounded-full">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-bold">المستوى {level}</span>
        </div>
      </div>

      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <Rocket className="w-16 h-16 text-cyan-400 animate-pulse" />
        </div>
        <h2 className="text-3xl font-black mb-2 text-gradient">غرفة المهمة</h2>
        <p className="text-gray-400">ابدأ رحلتك في عالم التسويق الاستراتيجي</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="space-y-4">
          <div>
            <label className="block text-cyan-300 mb-2 font-bold">اسم الشركة</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full bg-black/40 border border-cyan-500/30 rounded-xl p-4 text-white outline-none focus:border-cyan-500"
              placeholder="أدخل اسم شركتك..."
            />
          </div>

          <div>
            <label className="block text-cyan-300 mb-2 font-bold">نوع النشاط</label>
            <div className="grid grid-cols-2 gap-3">
              {['تكنولوجيا', 'بيع بالتجزئة', 'خدمات', 'تصنيع', 'تعليم', 'صحة'].map((type) => (
                <button
                  key={type}
                  onClick={() => setBusinessType(type)}
                  className={`p-4 rounded-xl border transition-all ${
                    businessType === type
                      ? 'border-cyan-500 bg-cyan-500/20'
                      : 'border-gray-700 hover:border-cyan-500/50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-black/30 rounded-2xl p-6 border border-gray-800">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-purple-400" />
            التعليمات المبدئية
          </h3>
          <ul className="space-y-3 text-gray-300">
            <li className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>سوف تبني خطة تسويق متكاملة خطوة بخطوة</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>كل مرحلة تفتح معايير BTEC جديدة</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>ستحصل على نقاط خبرة (XP) لكل معيار تكملة</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={() => {
            if (companyName && businessType) {
              setCurrentStage(2);
              playSound('success');
              toast.success('تم بدء المهمة! انتقل إلى غرفة الحرب');
            } else {
              toast.error('يرجى ملء جميع الحقول');
            }
          }}
          className="px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold rounded-2xl transition-all hover:scale-105 shadow-lg shadow-cyan-500/30"
        >
          ابدأ الرحلة 🚀
        </button>
      </div>
    </motion.div>
  );

  // المرحلة 2: غرفة الحرب (PESTLE)
  const renderWarRoom = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black mb-2 text-gradient">غرفة الحرب - تحليل بيئة الأعمال</h2>
        <p className="text-gray-400">قم بتحليل العوامل الخارجية المؤثرة على عملك</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* شبكة PESTLE */}
        <div className="glass p-6 rounded-3xl border border-cyan-500/30">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Globe className="w-5 h-5 text-green-400" />
            تحليل PESTLE التفاعلي
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {pestleCards.map((card) => (
              <motion.div
                key={card.id}
                whileHover={{ scale: 1.02 }}
                className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                  card.completed
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-gray-700 hover:border-cyan-500/50'
                } ${card.color}`}
                onClick={() => {
                  const factor = prompt(`أضف عامل ${card.title}:`);
                  if (factor) {
                    setPestleCards(prev =>
                      prev.map(c =>
                        c.id === card.id
                          ? {
                              ...c,
                              factors: [...c.factors, factor],
                              completed: c.factors.length >= 2
                            }
                          : c
                      )
                    );
                    playSound('click');
                  }
                }}
              >
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-bold text-lg">{card.title}</h4>
                  {card.completed && <CheckCircle className="w-5 h-5 text-green-400" />}
                </div>
                <p className="text-sm text-gray-300 mb-3">{card.description}</p>
                <div className="space-y-1">
                  {card.factors.map((factor, idx) => (
                    <div key={idx} className="text-xs bg-black/30 px-2 py-1 rounded">
                      • {factor}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-gray-400">
                  {card.factors.length}/2 عوامل مطلوبة
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* أهداف SMART */}
        <div className="glass p-6 rounded-3xl border border-purple-500/30">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-400" />
            صياغة أهداف SMART
          </h3>

          <textarea
            value={smartGoals}
            onChange={(e) => {
              setSmartGoals(e.target.value);
              // تحقق تلقائي من SMART
              const text = e.target.value.toLowerCase();
              setSmartCriteria({
                specific: text.includes('محدد') || text.length > 50,
                measurable: text.includes('قابل للقياس') || text.includes('%') || text.includes('رقم'),
                achievable: text.includes('قابل للتحقيق') || !text.includes('مستحيل'),
                relevant: text.includes('ذات صلة') || text.includes('ملائم'),
                timeBound: text.includes('محدد زمنياً') || text.includes('شهر') || text.includes('سنة')
              });
            }}
            className="w-full h-48 bg-black/40 border border-purple-500/30 rounded-xl p-4 text-white outline-none focus:border-purple-500 mb-4"
            placeholder="اكتب أهدافك التسويقية هنا..."
          />

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(smartCriteria).map(([key, value]) => (
              <div
                key={key}
                className={`p-3 rounded-xl text-center ${
                  value
                    ? 'bg-green-500/20 border border-green-500/50'
                    : 'bg-gray-800/50 border border-gray-700'
                }`}
              >
                <div className="text-xs font-bold mb-1">
                  {key === 'specific' && 'محدد'}
                  {key === 'measurable' && 'قابل للقياس'}
                  {key === 'achievable' && 'قابل للتحقيق'}
                  {key === 'relevant' && 'ذات صلة'}
                  {key === 'timeBound' && 'محدد زمنياً'}
                </div>
                {value ? (
                  <CheckCircle className="w-5 h-5 text-green-400 mx-auto" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-gray-500 mx-auto" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* رادار المخاطر */}
      <div className="glass p-6 rounded-3xl border border-orange-500/30">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <Shield className="w-5 h-5 text-orange-400" />
          رادار المخاطر (A.D1)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {['تكنولوجي', 'اقتصادي', 'تنافسي', 'قانوني'].map((risk) => (
            <div key={risk} className="text-center p-4 bg-black/30 rounded-2xl">
              <div className="text-lg font-bold mb-2">{risk}</div>
              <div className="relative h-32 w-32 mx-auto">
                <svg className="w-full h-full">
                  <circle cx="50%" cy="50%" r="40%" fill="rgba(255,100,0,0.1)" />
                  <circle cx="50%" cy="50%" r="30%" fill="rgba(255,100,0,0.2)" />
                  <circle cx="50%" cy="50%" r="20%" fill="rgba(255,100,0,0.3)" />
                </svg>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                defaultValue="30"
                aria-label={`مستوى المخاطر - ${risk}`}
                title={`مستوى المخاطر - ${risk}`}
                className="w-full mt-4"
                onChange={(e) => {
                  // تحديث مستوى المخاطر
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );

  // المرحلة 3: المختبر (4Ps)
  const renderLab = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black mb-2 text-gradient">المختبر - هندسة مزيج التسويق</h2>
        <p className="text-gray-400">صمم مزيج التسويق المثالي لشركتك</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* لوحة التحكم 4Ps */}
        <div className="glass p-6 rounded-3xl border border-blue-500/30">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            لوحة تحكم مزيج التسويق 4Ps
          </h3>

          <div className="space-y-6">
            {[
              { key: 'product', label: 'المنتج', icon: Package, color: 'blue' },
              { key: 'price', label: 'السعر', icon: DollarSign, color: 'green' },
              { key: 'place', label: 'المكان', icon: MapPin, color: 'purple' },
              { key: 'promotion', label: 'الترويج', icon: Megaphone, color: 'orange' }
            ].map(({ key, label, icon: Icon, color }) => (
              <div key={key} className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-5 h-5 text-${color}-400`} />
                    <span className="font-bold">{label}</span>
                  </div>
                  <span className="text-xl font-black">{marketingMix[key as keyof MarketingMix]}%</span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={marketingMix[key as keyof MarketingMix]}
                  aria-label={`مستوى ${label}`}
                  title={`مستوى ${label}`}
                  onChange={(e) => {
                    setMarketingMix(prev => ({
                      ...prev,
                      [key]: parseInt(e.target.value)
                    }));
                    playSound('click');
                  }}
                  className={`w-full h-2 bg-gray-800 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-${color}-500`}
                />

                <div className="flex justify-between text-xs text-gray-400">
                  <span>منخفض</span>
                  <span>متوسط</span>
                  <span>مرتفع</span>
                </div>
              </div>
            ))}
          </div>

          {/* مقياس التوازن */}
          <div className="mt-8 p-4 bg-black/30 rounded-2xl">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-bold">توازن المزيج</span>
              <span className={`text-sm font-bold ${
                Math.abs(marketingMix.product - marketingMix.price) < 30 &&
                Math.abs(marketingMix.place - marketingMix.promotion) < 30
                  ? 'text-green-400'
                  : 'text-orange-400'
              }`}>
                {Math.abs(marketingMix.product - marketingMix.price) < 30 &&
                 Math.abs(marketingMix.place - marketingMix.promotion) < 30
                  ? 'متوازن ✓'
                  : 'يحتاج تعديل'}
              </span>
            </div>
            <progress
              className="w-full h-2 rounded-full overflow-hidden bg-gray-800 accent-cyan-500"
              value={
                (marketingMix.product +
                  marketingMix.price +
                  marketingMix.place +
                  marketingMix.promotion) /
                4
              }
              max={100}
            />
          </div>
        </div>

        {/* معاينة النتائج */}
        <div className="glass p-6 rounded-3xl border border-green-500/30">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-green-400" />
            معاينة الاستراتيجية
          </h3>

          <div className="space-y-6">
            <div className="p-4 bg-black/40 rounded-2xl">
              <h4 className="font-bold mb-3">المنتج</h4>
              <p className="text-gray-300 text-sm">
                {marketingMix.product > 70
                  ? 'منتج متطور بميزات فريدة'
                  : marketingMix.product > 30
                  ? 'منتج قياسي بجودة جيدة'
                  : 'منتج بسيط أساسي'}
              </p>
            </div>

            <div className="p-4 bg-black/40 rounded-2xl">
              <h4 className="font-bold mb-3">استراتيجية السعر</h4>
              <p className="text-gray-300 text-sm">
                {marketingMix.price > 70
                  ? 'سعر مرتفع لجودة فاخرة'
                  : marketingMix.price > 30
                  ? 'سعر تنافسي معتدل'
                  : 'سعر منخفض لجذب العملاء'}
              </p>
            </div>

            <div className="p-4 bg-black/40 rounded-2xl">
              <h4 className="font-bold mb-3">قنوات التوزيع</h4>
              <p className="text-gray-300 text-sm">
                {marketingMix.place > 70
                  ? 'توزيع واسع عبر منافذ متعددة'
                  : marketingMix.place > 30
                  ? 'توزيع انتقائي'
                  : 'توزيع محدود'}
              </p>
            </div>

            <div className="p-4 bg-black/40 rounded-2xl">
              <h4 className="font-bold mb-3">حملات الترويج</h4>
              <p className="text-gray-300 text-sm">
                {marketingMix.promotion > 70
                  ? 'حملات ترويجية مكثفة'
                  : marketingMix.promotion > 30
                  ? 'ترويج معتدل'
                  : 'ترويج محدود'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // المرحلة 4: الخزنة (الميزانية)
  const renderVault = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black mb-2 text-gradient">الخزنة - إدارة الموارد المالية</h2>
        <p className="text-gray-400">خصص الميزانية بحكمة لتحقيق أقصى عائد</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* نظرة عامة */}
        <div className="glass p-6 rounded-3xl border border-yellow-500/30 lg:col-span-2">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            لوحة الميزانية التفاعلية
          </h3>

          <div className="space-y-6">
            {budget.map((item) => (
              <div key={item.id} className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold">{item.name}</div>
                    <div className="text-sm text-gray-400">{item.category}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">
                      {item.spent.toLocaleString()} / {item.allocated.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-400">
                      {Math.round((item.spent / item.allocated) * 100)}%
                    </div>
                  </div>
                </div>

                <progress
                  className={`w-full h-2 rounded-full overflow-hidden bg-gray-800 ${
                    item.spent <= item.allocated * 0.8
                      ? 'accent-green-500'
                      : item.spent <= item.allocated
                      ? 'accent-yellow-500'
                      : 'accent-red-500'
                  }`}
                  value={Math.min(100, (item.spent / item.allocated) * 100)}
                  max={100}
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (totalSpent < totalBudget) {
                        setBudget(prev =>
                          prev.map(i =>
                            i.id === item.id
                              ? { ...i, spent: Math.min(i.spent + 1000, i.allocated) }
                              : i
                          )
                        );
                        setTotalSpent(prev => prev + 1000);
                        playSound('click');
                      }
                    }}
                    className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 py-2 rounded-lg transition"
                  >
                    +١٠٠٠
                  </button>
                  <button
                    onClick={() => {
                      setBudget(prev =>
                        prev.map(i =>
                          i.id === item.id ? { ...i, spent: Math.max(i.spent - 1000, 0) } : i
                        )
                      );
                      setTotalSpent(prev => Math.max(prev - 1000, 0));
                      playSound('click');
                    }}
                    className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 py-2 rounded-lg transition"
                  >
                    -١٠٠٠
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ملخص الميزانية */}
        <div className="glass p-6 rounded-3xl border border-cyan-500/30">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            ملخص الموارد
          </h3>

          <div className="space-y-6">
            <div className="text-center p-6 bg-black/40 rounded-2xl">
              <div className="text-3xl font-black mb-2">
                {(totalBudget - totalSpent).toLocaleString()}
              </div>
              <div className="text-gray-400">المتبقي من الميزانية</div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <span>إجمالي الميزانية:</span>
                <span className="font-bold">{totalBudget.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>المصروف:</span>
                <span className={`font-bold ${
                  totalSpent <= totalBudget ? 'text-green-400' : 'text-red-400'
                }`}>
                  {totalSpent.toLocaleString()}
                </span>
              </div>
              <div className="h-px bg-gray-800"></div>
              <div className="flex justify-between text-lg">
                <span>النسبة:</span>
                <span className={`font-bold ${
                  totalSpent <= totalBudget ? 'text-green-400' : 'text-red-400'
                }`}>
                  {Math.round((totalSpent / totalBudget) * 100)}%
                </span>
              </div>
            </div>

            {/* مؤشر الجدول الزمني */}
            <div className="p-4 bg-black/40 rounded-2xl">
              <h4 className="font-bold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                الجدول الزمني
              </h4>
              <div className="space-y-2">
                {['التخطيط', 'التطوير', 'الاختبار', 'الإطلاق'].map((phase, idx) => (
                  <div key={phase} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <div className="flex-1">
                      <div className="text-sm">{phase}</div>
                      <progress
                        className="w-full h-1 rounded-full overflow-hidden bg-gray-800 accent-blue-500"
                        value={(idx + 1) * 25}
                        max={100}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // المرحلة 5: مركز التحكم
  const renderControlCenter = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center"
    >
      <div className="glass p-12 rounded-3xl border border-purple-500/30">
        <div className="mb-8">
          <div className="inline-block p-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl mb-6">
            <Award className="w-16 h-16 text-white" />
          </div>
          <h2 className="text-4xl font-black mb-2 text-gradient">🎉 مهمة مكتملة!</h2>
          <p className="text-gray-400 text-xl">لقد بنيت خطة تسويق متكاملة بنجاح</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <div className="p-6 bg-black/40 rounded-2xl">
            <div className="text-3xl font-black text-cyan-400 mb-2">{xp}</div>
            <div className="text-gray-400">نقطة خبرة</div>
          </div>
          <div className="p-6 bg-black/40 rounded-2xl">
            <div className="text-3xl font-black text-green-400 mb-2">
              {criteriaStatus.filter(c => c.status === 'completed').length}
            </div>
            <div className="text-gray-400">معيار مكتمل</div>
          </div>
          <div className="p-6 bg-black/40 rounded-2xl">
            <div className="text-3xl font-black text-yellow-400 mb-2">{level}</div>
            <div className="text-gray-400">المستوى</div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 justify-center">
          <button
            onClick={() => {
              // تصدير التقرير
              toast.success('جاري إنشاء التقرير...');
            }}
            className="px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-2xl transition hover:scale-105"
          >
            📄 تصدير التقرير النهائي
          </button>
          <button
            onClick={() => setCurrentStage(1)}
            className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-2xl transition hover:scale-105"
          >
            🔄 بدء مهمة جديدة
          </button>
        </div>
      </div>
    </motion.div>
  );

  // الشريط الجانبي
  const Sidebar = () => (
    <div className="glass p-6 rounded-3xl border border-gray-800 h-fit sticky top-6">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Network className="w-5 h-5 text-cyan-400" />
        لوحة التحكم
      </h3>

      {/* خريطة المراحل */}
      <div className="mb-8">
        <h4 className="font-bold mb-4 text-gray-300">مسار الرحلة</h4>
        <div className="space-y-3">
          {[
            { stage: 1, label: 'المهمة', icon: Rocket },
            { stage: 2, label: 'غرفة الحرب', icon: Globe },
            { stage: 3, label: 'المختبر', icon: Cpu },
            { stage: 4, label: 'الخزنة', icon: DollarSign },
            { stage: 5, label: 'التحكم', icon: Award }
          ].map(({ stage, label, icon: Icon }) => (
            <button
              key={stage}
              onClick={() => setCurrentStage(stage)}
              className={`flex items-center gap-3 w-full p-3 rounded-xl transition ${
                currentStage === stage
                  ? 'bg-cyan-500/20 border border-cyan-500/50'
                  : 'hover:bg-gray-800/50'
              }`}
            >
              <div className={`p-2 rounded-lg ${
                currentStage === stage ? 'bg-cyan-500' : 'bg-gray-800'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="font-bold">{label}</span>
              {stage < currentStage && (
                <CheckCircle className="w-4 h-4 text-green-400 ml-auto" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* قائمة المعايير */}
      <div>
        <h4 className="font-bold mb-4 text-gray-300">معايير BTEC</h4>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
          {criteriaStatus.map((criteria) => (
            <div
              key={criteria.id}
              className={`p-3 rounded-xl border ${
                criteria.status === 'completed'
                  ? 'bg-green-500/10 border-green-500/30'
                  : criteria.status === 'in-progress'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-gray-800/30 border-gray-700'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <div className="font-bold text-sm">{criteria.id}</div>
                <div className={`w-2 h-2 rounded-full ${
                  criteria.status === 'completed'
                    ? 'bg-green-500'
                    : criteria.status === 'in-progress'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-gray-600'
                }`}></div>
              </div>
              <div className="text-xs text-gray-300">{criteria.title}</div>
              <div className="text-xs text-gray-400 mt-1">{criteria.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* شريط التقدم */}
      <div className="mt-8 pt-6 border-t border-gray-800">
        <div className="flex justify-between text-sm mb-2">
          <span>تقدم المهمة</span>
          <span>{Math.round((xp / 800) * 100)}%</span>
        </div>
        <progress
          className="w-full h-2 rounded-full overflow-hidden bg-gray-800 accent-cyan-500"
          value={Math.min(100, (xp / 800) * 100)}
          max={100}
        />
        <div className="flex justify-between text-xs text-gray-400 mt-2">
          <span>المستوى {level}</span>
          <span>{xp}/800 XP</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4 md:p-8 font-sans">
      <audio ref={audioRef} />

      {/* شريط العنوان */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-black mb-2 text-gradient">
              NEXUS-EDU
            </h1>
            <p className="text-gray-400">الغرفة الافتراضية للتسويق الاستراتيجي - BTEC المستوى 2</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-400">الشركة</div>
              <div className="font-bold text-lg">{companyName || 'غير محدد'}</div>
            </div>
            <div className="h-12 w-px bg-gray-700"></div>
            <div className="text-right">
              <div className="text-sm text-gray-400">المستوى</div>
              <div className="font-bold text-2xl text-cyan-400">{level}</div>
            </div>
          </div>
        </div>
      </div>

      {/* المحتوى الرئيسي */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* المحتوى */}
        <div className="lg:col-span-3">
          <AnimatePresence mode="wait">
            {renderStage()}
          </AnimatePresence>

          {/* أزرار التنقل */}
          <div className="flex justify-between mt-8">
            <button
              onClick={() => {
                if (currentStage > 1) {
                  setCurrentStage(currentStage - 1);
                  playSound('click');
                }
              }}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition ${
                currentStage > 1
                  ? 'bg-gray-800 hover:bg-gray-700'
                  : 'bg-gray-900/50 text-gray-500 cursor-not-allowed'
              }`}
              disabled={currentStage <= 1}
            >
              ← المرحلة السابقة
            </button>

            <button
              onClick={() => {
                if (currentStage < 5) {
                  setCurrentStage(currentStage + 1);
                  playSound('success');
                  if (currentStage === 4) {
                    toast.success('🎉 مبروك! أكملت جميع المراحل');
                  }
                }
              }}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold rounded-2xl transition hover:scale-105"
            >
              {currentStage < 5 ? 'المرحلة التالية →' : 'إنهاء المهمة 🎯'}
            </button>
          </div>
        </div>

        {/* الشريط الجانبي */}
        <div>
          <Sidebar />
        </div>
      </div>

      {/* تذييل الصفحة */}
      <div className="max-w-7xl mx-auto mt-12 pt-6 border-t border-gray-800 text-center text-gray-500 text-sm">
        <p>© 2024 NEXUS-EDU - نظام محاكاة BTEC المستوى 2 | وحدة 4: خطة التسويق</p>
        <p className="mt-2">تم تصميم هذا النظام لفهم عميق لمعايير التقييم من خلال تجربة تفاعلية غامرة</p>
      </div>
    </div>
  );
}

