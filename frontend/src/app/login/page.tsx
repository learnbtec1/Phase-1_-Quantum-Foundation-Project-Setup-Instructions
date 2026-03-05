'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const isLoggedIn = await login(email, password);
    if (isLoggedIn) {
      router.push('/dashboard-2d');
    } else {
      setError('بيانات الدخول غير صحيحة');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="glass p-8 rounded-2xl w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-6 text-gradient">
          تسجيل الدخول
        </h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800/50 border border-cyan-500/30 rounded-lg focus:outline-none focus:border-cyan-500"
              placeholder="student@nexus.edu"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800/50 border border-cyan-500/30 rounded-lg focus:outline-none focus:border-cyan-500"
              placeholder="password123"
              required
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            className="w-full btn-neon py-3 rounded-lg font-bold"
          >
            دخول
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-4">
          بيانات تجريبية: student@nexus.edu / password123
        </p>
      </div>
    </div>
  );
}