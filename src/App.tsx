/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  setDoc, 
  doc, 
  onSnapshot,
  orderBy,
  limit,
  Timestamp,
  getDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { format, startOfToday, eachDayOfInterval, subDays, isSameDay, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { 
  Users, 
  ClipboardCheck, 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight,
  Settings,
  Check,
  X,
  Plus,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Firebase Error Handling ---
interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: any[];
  }
}

const handleFirestoreError = (error: any, operationType: any, path: string | null = null) => {
  console.error(`Firestore Error [${operationType}]:`, error);
  if (error.code === 'permission-denied') {
    const errorInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType,
      path,
      authInfo: {
        userId: 'anonymous',
        email: '',
        emailVerified: false,
        isAnonymous: true,
        providerInfo: []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
};

// --- Types ---

interface Member {
  id: string;
  clubId: string;
  name: string;
  grade: number;
  class: number;
  number: number;
  gender: string;
}

interface AttendanceRecord {
  memberId: string;
  clubId: string;
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent';
}

const CLUBS = [
  { id: 'plogging', name: '플로깅' }
];

// --- Initial Data (Extracted from user screenshots) ---

const INITIAL_MEMBERS = {
  plogging: [
    { name: '김담율', grade: 1, class: 1, number: 1, gender: '남' },
    { name: '김재현', grade: 1, class: 1, number: 6, gender: '남' },
    { name: '문주안', grade: 1, class: 1, number: 8, gender: '남' },
    { name: '차윤수', grade: 1, class: 1, number: 20, gender: '남' },
    { name: '홍기주', grade: 1, class: 1, number: 21, gender: '남' },
    { name: '김시오', grade: 1, class: 2, number: 2, gender: '남' },
    { name: '윤민솔', grade: 1, class: 2, number: 13, gender: '여' },
    { name: '최진우', grade: 1, class: 2, number: 21, gender: '남' },
    { name: '권승호', grade: 1, class: 3, number: 3, gender: '남' },
    { name: '서민기', grade: 1, class: 3, number: 12, gender: '남' },
    { name: '임지민', grade: 1, class: 3, number: 17, gender: '여' },
    { name: '김규현', grade: 1, class: 4, number: 2, gender: '남' },
    { name: '조은서', grade: 1, class: 4, number: 18, gender: '여' },
    { name: '최은우', grade: 1, class: 4, number: 19, gender: '남' },
  ]
};

const ACTIVITY_SCHEDULE: Record<string, string> = {
  '2026-03-17': '조직/계획',
  '2026-03-20': '1차',
  '2026-04-10': '2차',
  '2026-05-22': '3차',
  '2026-06-12': '4차',
  '2026-07-10': '5차',
  '2026-08-21': '6차',
  '2026-09-11': '7차',
  '2026-10-30': '8차',
  '2026-11-06': '9차',
  '2026-11-12': '10차',
};

const SCHEDULED_DATES = Object.keys(ACTIVITY_SCHEDULE);

// --- Components ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'check' | 'status'>('status');
  const [selectedClubId, setSelectedClubId] = useState<string>(CLUBS[0].id);
  const [attendance, setAttendance] = useState<Record<string, 'present' | 'absent'>>({}); // For current date
  const [allAttendance, setAllAttendance] = useState<AttendanceRecord[]>([]); // For status page
  const [popupInfo, setPopupInfo] = useState<{ id: number; name: string; present: number; absent: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checkDate, setCheckDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  
  // New member form state
  const [newMember, setNewMember] = useState({
    name: '',
    grade: 1,
    class: 1,
    number: 1,
    gender: '남'
  });

  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // Initialize data if empty (Clean seeding to prevent duplicates)
  useEffect(() => {
    const initData = async () => {
      // Check specifically if members for the current club exist
      const q = query(collection(db, 'members'), where('clubId', '==', selectedClubId));
      const membersSnap = await getDocs(q);
      
      if (membersSnap.empty) {
        console.log(`Seeding initial members for ${selectedClubId}...`);
        const batch = writeBatch(db);
        const membersList = INITIAL_MEMBERS[selectedClubId as keyof typeof INITIAL_MEMBERS] || [];
        
        membersList.forEach((m) => {
          const stableId = `${selectedClubId}_${m.grade}_${m.class}_${m.number}`;
          const memberRef = doc(db, 'members', stableId);
          batch.set(memberRef, { ...m, clubId: selectedClubId });
        });
        
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, 'write', `batch/members/${selectedClubId}`);
        }
      }
    };
    if (selectedClubId) initData();
  }, [selectedClubId]);

  // Fetch members
  useEffect(() => {
    const q = query(collection(db, 'members')); // Fetch all members to support cross-club stats if needed, but filter in view
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const membersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setAllMembers(membersData);
    });
    return () => unsubscribe();
  }, []);

  const [allMembers, setAllMembers] = useState<Member[]>([]);
  
  const members = useMemo(() => {
    const filtered = allMembers.filter(m => m.clubId === selectedClubId);
    filtered.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.class !== b.class) return a.class - b.class;
      return a.number - b.number;
    });
    return filtered;
  }, [allMembers, selectedClubId]);

  useEffect(() => {
    setIsLoading(false);
  }, [members]);

  // Fetch today's attendance (Using checkDate state)
  useEffect(() => {
    const q = query(
      collection(db, 'attendance'), 
      where('clubId', '==', selectedClubId),
      where('date', '==', checkDate)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const attMap: Record<string, 'present' | 'absent'> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        attMap[data.memberId] = data.status;
      });
      setAttendance(attMap);
    });
    return () => unsubscribe();
  }, [selectedClubId, checkDate]);

  // Fetch all attendance for statistics and status page
  useEffect(() => {
    const q = query(collection(db, 'attendance'), where('clubId', '==', selectedClubId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as AttendanceRecord);
      // Sort by date string
      data.sort((a: AttendanceRecord, b: AttendanceRecord) => a.date.localeCompare(b.date));
      setAllAttendance(data);
    });
    return () => unsubscribe();
  }, [selectedClubId]);

  const uniqueDates = useMemo(() => {
    const recordedDates = allAttendance.map(a => a.date);
    const combined = Array.from(new Set([...SCHEDULED_DATES, ...recordedDates]));
    combined.sort((a: string, b: string) => a.localeCompare(b));
    return combined;
  }, [allAttendance]);

  const handleAttendanceCheck = async (member: Member) => {
    const recordId = `${member.id}_${checkDate}`;
    const docRef = doc(db, 'attendance', recordId);
    
    // Toggle off
    if (attendance[member.id] === 'present') {
      const batch = writeBatch(db);
      batch.delete(docRef);
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, 'delete', `attendance/${recordId}`);
      }
      return;
    }

    // Mark present
    try {
      await setDoc(docRef, {
        memberId: member.id,
        clubId: selectedClubId,
        date: checkDate,
        status: 'present'
      });
    } catch (err) {
      handleFirestoreError(err, 'create', `attendance/${recordId}`);
    }

    // Immediate calculation for popup based on current synced state + the new action
    // We filter allAttendance for this member
    const existingPresentCount = allAttendance.filter(a => a.memberId === member.id && a.status === 'present').length;
    // Check if current date already exists as a present record in allAttendance (might not be synced yet)
    const isTodayRecorded = allAttendance.some(a => a.memberId === member.id && a.date === checkDate && a.status === 'present');
    
    const finalPresent = existingPresentCount + (isTodayRecorded ? 0 : 1);
    
    // Total days is the current unique dates count. 
    // If today is a new date not yet in uniqueDates, we add it for the calculation.
    let totalRecordedDays = uniqueDates.length;
    if (!uniqueDates.includes(checkDate)) {
      totalRecordedDays += 1;
    }
    
    const finalAbsent = Math.max(0, totalRecordedDays - finalPresent);

    setPopupInfo({ 
      id: Date.now(),
      name: member.name, 
      present: finalPresent, 
      absent: finalAbsent 
    });
  };

  useEffect(() => {
    if (popupInfo) {
      const timer = setTimeout(() => {
        setPopupInfo(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [popupInfo]);

  const manualToggle = async (memberId: string, date: string, currentStatus: 'present' | 'absent' | undefined) => {
    // Cycle: present -> absent -> none (delete)
    const docRef = doc(db, 'attendance', `${memberId}_${date}`);
    
    if (currentStatus === 'present') {
      try {
        await setDoc(docRef, { memberId, clubId: selectedClubId, date, status: 'absent' });
      } catch (err) {
        handleFirestoreError(err, 'update', `attendance/${memberId}_${date}`);
      }
    } else if (currentStatus === 'absent') {
      const batch = writeBatch(db);
      batch.delete(docRef);
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, 'delete', `attendance/${memberId}_${date}`);
      }
    } else {
      try {
        await setDoc(docRef, { memberId, clubId: selectedClubId, date, status: 'present' });
      } catch (err) {
        handleFirestoreError(err, 'create', `attendance/${memberId}_${date}`);
      }
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.name) return;
    
    // Create stable ID to prevent duplicates
    const stableId = `${selectedClubId}_${newMember.grade}_${newMember.class}_${newMember.number}`;
    const memberRef = doc(db, 'members', stableId);
    
    try {
      await setDoc(memberRef, {
        ...newMember,
        clubId: selectedClubId
      });
      setShowAddMemberModal(false);
      setNewMember({ name: '', grade: 1, class: 1, number: 1, gender: '남' });
    } catch (err) {
      handleFirestoreError(err, 'create', `members/manual_add`);
      alert('이미 등록되었거나 등록 중 오류가 발생했습니다.');
    }
  };

  const currentPresentCount = useMemo(() => {
    return members.filter(m => attendance[m.id] === 'present').length;
  }, [members, attendance]);
  
  const currentAbsentCount = members.length - currentPresentCount;

  const handleDownloadExcel = () => {
    // Prepare Data
    const data = members.map(member => {
      const row: any = {
        '학년': member.grade,
        '반': member.class,
        '번호': member.number,
        '이름': member.name,
        '성별': member.gender,
      };

      uniqueDates.forEach(date => {
        const record = allAttendance.find(a => a.memberId === member.id && a.date === date && a.clubId === selectedClubId);
        row[date] = record ? 'O' : 'X';
      });

      const presentCount = allAttendance.filter(a => a.memberId === member.id && a.status === 'present' && a.clubId === selectedClubId).length;
      row['누적 출석'] = presentCount;
      row['누적 결석'] = uniqueDates.length - presentCount;

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "출결현황");
    
    const clubName = CLUBS.find(c => c.id === selectedClubId)?.name || '스포츠클럽';
    XLSX.writeFile(workbook, `${clubName}_출결현황_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#212529] font-sans">
      {/* Member Add Modal */}
      <AnimatePresence>
        {showAddMemberModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl flex flex-col gap-6"
            >
              <div className="flex justify-between items-center border-b pb-4">
                <h2 className="text-xl font-black text-gray-800 flex items-center gap-2">
                  <span className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Plus size={20} /></span>
                  {CLUBS.find(c => c.id === selectedClubId)?.name} 부원 추가
                </h2>
                <button onClick={() => setShowAddMemberModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddMember} className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-gray-400 ml-1">학년</label>
                    <select 
                      value={newMember.grade}
                      onChange={e => setNewMember({...newMember, grade: parseInt(e.target.value)})}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 outline-none bg-gray-50 text-sm font-bold"
                    >
                      {[1, 2, 3].map(g => <option key={g} value={g}>{g}학년</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-gray-400 ml-1">반</label>
                    <input 
                      type="number"
                      required
                      min={1}
                      max={20}
                      value={newMember.class}
                      onChange={e => setNewMember({...newMember, class: parseInt(e.target.value)})}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 outline-none bg-gray-50 text-sm font-bold"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-gray-400 ml-1">번호</label>
                    <input 
                      type="number"
                      required
                      min={1}
                      max={50}
                      value={newMember.number}
                      onChange={e => setNewMember({...newMember, number: parseInt(e.target.value)})}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 outline-none bg-gray-50 text-sm font-bold"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-400 ml-1">이름</label>
                  <input 
                    type="text"
                    required
                    placeholder="이름을 입력하세요"
                    value={newMember.name}
                    onChange={e => setNewMember({...newMember, name: e.target.value})}
                    className="px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 outline-none bg-gray-50 text-sm font-bold"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-400 ml-1">성별</label>
                  <div className="flex gap-2">
                    {['남', '여'].map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setNewMember({...newMember, gender: g})}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-sm font-bold border transition-all",
                          newMember.gender === g ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-50 border-gray-200 text-gray-500"
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 mt-2 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95"
                >
                  명단에 추가하기
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation Header */}
      <header className="bg-white border-b border-gray-200 px-3 py-2 flex flex-wrap items-center justify-between sticky top-0 z-30 shadow-sm gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-black text-blue-600 flex items-center gap-1.5 tracking-tight shrink-0">
            <ClipboardCheck size={18} />
            플로깅
          </h1>
          <div className="h-4 w-[1px] bg-gray-200 mx-1" />
          <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-md border border-gray-200 shrink-0">
            <CalendarIcon size={12} className="text-gray-400" />
            <input 
              type="date"
              value={checkDate}
              onChange={(e) => {
                setCheckDate(e.target.value);
              }}
              className="text-xs font-bold text-gray-700 bg-transparent border-none focus:ring-0 cursor-pointer p-0 w-[85px]"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowAddMemberModal(true)}
            className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-black border border-blue-100 hover:bg-blue-100 transition-all shrink-0"
          >
            <Plus size={14} />
            추가
          </button>
          <button 
            onClick={handleDownloadExcel}
            className="text-[10px] bg-green-50 text-green-600 px-1.5 py-1.5 rounded-lg border border-green-100 font-bold hover:bg-green-100 transition-all flex items-center gap-1 shrink-0"
          >
            <Download size={14} />
            엑셀
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 flex flex-col gap-4 max-w-7xl mx-auto">
        
        {/* Club Selection Hidden (Only one club) */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <div className="bg-blue-600 px-6 py-2 rounded-full text-sm font-bold text-white shadow-md">
              플로깅
            </div>
          </div>
          
          <div className="flex items-center gap-3 text-[11px] font-bold">
            <div className="text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
              <Users size={12} />
              전체 {members.length}
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div 
            key="status"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-1.5 text-left border-right border-gray-200 w-20 sticky left-0 bg-gray-50 z-20 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                        <div className="flex flex-col text-[10px] leading-tight">
                          <span className="text-gray-400 font-normal">이름</span>
                          <span className="text-blue-600 font-black">부원명</span>
                        </div>
                      </th>
                      {/* All Recorded Dates */}
                      {uniqueDates.length > 0 ? (
                        uniqueDates.map((d, i) => (
                          <th key={i} className="p-1 text-center border-right border-gray-200 min-w-[44px]">
                            <div className="flex flex-col gap-0">
                              {ACTIVITY_SCHEDULE[d] && (
                                <span className="text-[8px] text-blue-500 font-black leading-none">{ACTIVITY_SCHEDULE[d]}</span>
                              )}
                              <span className="text-[10px] text-gray-600 font-bold tracking-tighter">{d.slice(5).replace('-', '/')}</span>
                              <div className="flex items-center justify-center gap-1 text-[8px] mt-0.5 leading-none font-bold">
                                <span className="text-green-600">{allAttendance.filter(a => a.date === d && a.status === 'present' && a.clubId === selectedClubId).length}</span>
                                <span className="text-gray-300">/</span>
                                <span className="text-red-400">{members.length - allAttendance.filter(a => a.date === d && a.status === 'present' && a.clubId === selectedClubId).length}</span>
                              </div>
                            </div>
                          </th>
                        ))
                      ) : (
                        <th className="p-2 text-center text-gray-400 italic">기록 없음</th>
                      )}
                      <th className="p-1 text-center bg-blue-50 text-blue-700 w-16 text-[10px]">
                         누적
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(member => {
                      const memberAtt = allAttendance.filter(a => a.memberId === member.id);
                      const presentCount = memberAtt.filter(a => a.status === 'present').length;
                      // Automatic absence: Total recorded dates minus present count
                      const absentCount = uniqueDates.length - presentCount;

                      return (
                        <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="p-1.5 font-bold border-right border-gray-200 sticky left-0 bg-white z-20 group-hover:bg-gray-50 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                            <div className="flex flex-col leading-tight">
                              <span className={cn(
                                "text-[8px] font-mono",
                                member.gender === '남' ? "text-blue-500" : "text-purple-500"
                              )}>
                                {member.grade}{member.class}{member.number.toString().padStart(2, '0')}
                              </span>
                              <span className="text-[13px] tracking-tight">{member.name}</span>
                            </div>
                          </td>
                          {uniqueDates.map((dateStr, i) => {
                            const record = allAttendance.find(a => a.memberId === member.id && a.date === dateStr);
                            return (
                              <td key={i} className="p-0 border-right border-gray-200">
                                <button
                                  onClick={() => manualToggle(member.id, dateStr, record?.status)}
                                  className={cn(
                                    "w-full h-10 flex items-center justify-center transition-all",
                                    record?.status === 'present' ? "bg-green-100 text-green-700" :
                                    record?.status === 'absent' ? "bg-red-100 text-red-700" :
                                    "text-gray-200 hover:bg-gray-50"
                                  )}
                                >
                                  {record?.status === 'present' ? <Check size={14} strokeWidth={3} /> : 
                                   record?.status === 'absent' ? <X size={14} strokeWidth={3} /> : '-'}
                                </button>
                              </td>
                            );
                          })}
                          <td className="p-1 px-2 text-center bg-blue-50/20">
                            <div className="flex flex-col gap-0 items-center leading-none">
                              <span className="text-green-600 font-black text-[11px]">{presentCount}</span>
                              <div className="h-[1px] w-3 bg-gray-200 my-0.5" />
                              <span className="text-red-400 font-bold text-[9px]">{absentCount}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
        </AnimatePresence>
      </main>

      {/* 2s Popup Notification */}
      <AnimatePresence>
        {popupInfo && (
          <motion.div
            key={popupInfo.id}
            initial={{ opacity: 0, scale: 0.5, y: -20, x: '-50%' }}
            animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.5, y: -20, x: '-50%' }}
            className="fixed top-1/2 left-1/2 -translate-y-1/2 z-[99999] pointer-events-none"
          >
            <div className="bg-slate-900/90 backdrop-blur-2xl text-white px-12 py-10 rounded-[3rem] shadow-[0_0_80px_rgba(0,0,0,0.6)] flex flex-col items-center gap-4 border-2 border-white/20 min-w-[380px]">
              <div className="bg-green-500 p-4 rounded-full mb-2 shadow-[0_0_30px_rgba(34,197,94,0.5)]">
                <Check size={48} strokeWidth={4} />
              </div>
              <div className="flex flex-col items-center">
                <span className="text-4xl font-black tracking-tight mb-2">{popupInfo.name}</span>
                <span className="text-xl font-bold text-white/70">출석 체크 완료!</span>
              </div>
              <div className="flex gap-8 text-xl font-black mt-4 bg-white/10 px-10 py-4 rounded-3xl w-full justify-center">
                <div className="flex flex-col items-center">
                  <span className="text-xs text-white/50 mb-1 uppercase tracking-widest">출석</span>
                  <span className="text-green-400">{popupInfo.present}회</span>
                </div>
                <div className="w-[1px] h-10 bg-white/20 self-center" />
                <div className="flex flex-col items-center">
                  <span className="text-xs text-white/50 mb-1 uppercase tracking-widest">결석</span>
                  <span className="text-red-400 text-opacity-80">{popupInfo.absent}회</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-2 right-4 text-[10px] text-gray-400 pointer-events-none">
        Sports Club Attendance Management System v1.0
      </footer>
    </div>
  );
}
