'use client';

import { useEffect, useMemo, useState } from 'react';

interface TeamRoom {
  id: string;
  name: string;
  code: string;
  members: string[];
  points: number;
  activeChallenge: string;
}

const initialRooms: TeamRoom[] = [
  { id: 'r1', name: 'فريق النخبة', code: 'ELITE', members: ['أحمد', 'نورة', 'فهد'], points: 3200, activeChallenge: 'تحليل SWOT' },
  { id: 'r2', name: 'فريق السرعة', code: 'FAST', members: ['سارة', 'محمد'], points: 2850, activeChallenge: 'PESTLE سريع' },
  { id: 'r3', name: 'فريق الخبراء', code: 'PRO', members: ['ليان', 'عبدالله', 'ريم'], points: 2550, activeChallenge: 'كتابة التقرير' }
];

const weeklyChallenges = [
  { title: 'سباق تحليل السوق', reward: '250 نقطة للفريق', status: 'نشط' },
  { title: 'كتابة التقرير المثالي', reward: 'شارة الخبراء', status: 'قريباً' },
  { title: 'مقارنة الشركات', reward: '150 نقطة إضافية', status: 'قريباً' }
];

export default function TeamCompetition() {
  const [rooms, setRooms] = useState<TeamRoom[]>(initialRooms);
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState<TeamRoom | null>(null);

  useEffect(() => {
    const savedCode = localStorage.getItem('teamCode');
    if (savedCode) {
      const match = rooms.find((room) => room.code === savedCode);
      if (match) setCurrentRoom(match);
    }
  }, [rooms]);

  const createRoom = () => {
    if (!roomName.trim() || !roomCode.trim()) return;
    const code = roomCode.trim().toUpperCase();
    const newRoom: TeamRoom = {
      id: `r${rooms.length + 1}`,
      name: roomName.trim(),
      code,
      members: ['أنت'],
      points: 1200,
      activeChallenge: 'PESTLE سريع'
    };
    setRooms((prev) => [newRoom, ...prev]);
    setCurrentRoom(newRoom);
    localStorage.setItem('teamCode', code);
    setRoomName('');
    setRoomCode('');
  };

  const joinRoom = (room: TeamRoom) => {
    setCurrentRoom(room);
    localStorage.setItem('teamCode', room.code);
  };

  const sortedRooms = useMemo(() => [...rooms].sort((a, b) => b.points - a.points), [rooms]);

  return (
    <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-gray-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-2xl font-bold">👥 المنافسة الجماعية</h3>
        <span className="text-emerald-400 text-sm">غرف متعددة وتحديات فريقية</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700">
            <h4 className="font-bold text-white mb-3">الغرف النشطة</h4>
            <div className="space-y-3">
              {sortedRooms.map((room, index) => (
                <div key={room.id} className="flex items-center justify-between bg-black/40 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full ${index === 0 ? 'bg-yellow-500' : 'bg-gray-700'}`}>
                      <span className="font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <div className="font-bold text-white">{room.name}</div>
                      <div className="text-xs text-gray-400">{room.members.length} أعضاء • كود: {room.code}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold">{room.points} XP</div>
                    <div className="text-xs text-gray-400">{room.activeChallenge}</div>
                  </div>
                  <button
                    onClick={() => joinRoom(room)}
                    className={`px-4 py-2 rounded-lg text-sm ${currentRoom?.id === room.id ? 'bg-emerald-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    {currentRoom?.id === room.id ? 'غرفتك' : 'انضم'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700">
            <h4 className="font-bold text-white mb-3">تحديات أسبوعية</h4>
            <div className="space-y-2">
              {weeklyChallenges.map((challenge) => (
                <div key={challenge.title} className="flex items-center justify-between bg-black/40 rounded-lg p-3">
                  <div>
                    <div className="font-bold text-white">{challenge.title}</div>
                    <div className="text-xs text-gray-400">{challenge.reward}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${challenge.status === 'نشط' ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-700 text-gray-300'}`}>
                    {challenge.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700">
            <h4 className="font-bold text-white mb-3">إنشاء غرفة</h4>
            <div className="space-y-3">
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="اسم الغرفة"
                aria-label="اسم الغرفة"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
              />
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="كود الفريق"
                aria-label="كود الفريق"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
              />
              <button
                onClick={createRoom}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-2 rounded-lg"
              >
                إنشاء غرفة
              </button>
            </div>
          </div>

          <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700">
            <h4 className="font-bold text-white mb-3">غرفتك الحالية</h4>
            {currentRoom ? (
              <div className="space-y-2">
                <div className="text-white font-bold">{currentRoom.name}</div>
                <div className="text-xs text-gray-400">الكود: {currentRoom.code}</div>
                <div className="flex flex-wrap gap-2">
                  {currentRoom.members.map((member) => (
                    <span key={member} className="px-2 py-1 bg-gray-700 text-xs rounded-full">
                      {member}
                    </span>
                  ))}
                </div>
                <div className="text-emerald-400 font-bold">{currentRoom.points} XP</div>
              </div>
            ) : (
              <div className="text-sm text-gray-400">اختر غرفة للانضمام.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
