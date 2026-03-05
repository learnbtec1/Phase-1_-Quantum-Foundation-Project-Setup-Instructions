import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { ProgressProvider } from '@/context/ProgressContext';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700', '900'],
  variable: '--font-cairo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nexus Academy | BTEC Platform',
  description: 'Future of Education',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable}`}>
      <body className={`${cairo.className} bg-[#020617] text-white min-h-screen antialiased overflow-hidden`}>
        <div className="flex h-screen">
          
          {/* القائمة الجانبية الشاملة */}
          <aside className="w-72 glass-nexus border-l border-white/5 flex flex-col z-50 h-full">
            <div className="p-6 text-center border-b border-white/5">
              <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">
                NEXUS ACADEMY
              </h1>
              <p className="text-[10px] text-gray-500 font-bold tracking-widest mt-1">V3.0 QUANTUM EDITION</p>
            </div>
            
            <nav className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
              <div className="text-xs font-bold text-gray-600 px-4 py-2 uppercase">Core Modules</div>
              
              <Link href="/dashboard" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">📊</span>
                <span className="font-bold text-sm">لوحة التحكم</span>
              </Link>
              
              <Link href="/assessment" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">📝</span>
                <span className="font-bold text-sm">التقييم (Assessment)</span>
              </Link>

              <div className="text-xs font-bold text-gray-600 px-4 py-2 mt-4 uppercase">AI & Simulation</div>

              <Link href="/plagiarism" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">📐</span>
                <span className="font-bold text-sm">فيثاغورس (AI Check)</span>
              </Link>

              <Link href="/unit-1-agriculture" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">🌾</span>
                <span className="font-bold text-sm">الوحدة 1: الزراعة (VR)</span>
              </Link>

              <Link href="/simulation" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">🏢</span>
                <span className="font-bold text-sm">محاكاة الشركات (Sim)</span>
              </Link>

              <Link href="/ai-teacher" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">🤖</span>
                <span className="font-bold text-sm">المعلم الذكي</span>
              </Link>

              <div className="text-xs font-bold text-gray-600 px-4 py-2 mt-4 uppercase">Students & Gamification</div>

              <Link href="/competition" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">🏆</span>
                <span className="font-bold text-sm">المنافسة (Competition)</span>
              </Link>

              <Link href="/student" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition text-gray-300 hover:text-white group">
                <span className="text-xl group-hover:scale-110 transition">👨‍🎓</span>
                <span className="font-bold text-sm">بوابة الطالب</span>
              </Link>
            </nav>

            <div className="p-4 border-t border-white/5 bg-black/20">
              <div className="flex items-center gap-3 opacity-70 hover:opacity-100 transition">
                <img src="/logo-hamzeh.svg" alt="Hamzeh" className="w-8 h-8" />
                <div>
                  <p className="text-xs font-bold text-white">Dr. Hamzeh</p>
                  <p className="text-[10px] text-emerald-500">System Admin</p>
                </div>
              </div>
            </div>
          </aside>

          {/* منطقة المحتوى */}
          <main className="flex-1 relative overflow-hidden bg-[#020617]">
             {/* الخلفية الكونية */}
             <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-cyan-900/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[120px]" />
             </div>
             
             <div className="relative z-10 h-full overflow-y-auto">
                <ProgressProvider>
                  {children}
                </ProgressProvider>
             </div>
          </main>
        </div>
      </body>
    </html>
  );
}