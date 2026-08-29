import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Trash2, RefreshCw, Activity, UserX, Crosshair, GripVertical, Users, X } from 'lucide-react';

const API_KEY = import.meta.env.VITE_PUBG_API_KEY;

interface PlayerData {
  id: string;
  accountId: string;
  isBanned: boolean;
  banType: string;
  survivalLevel: number;
  survivalTier: number;
  duoTppMatches?: number;
  duoTppKills?: number;
  duoTppKd?: number;
  squadTppMatches?: number;
  squadTppKills?: number;
  squadTppKd?: number;
  lastMatchAt?: string;
  note?: string;
  lastChecked: string;
  isUpdating?: boolean;
}

const formatTime = (date: Date) => {
  const pad = (n: number) => n < 10 ? '0' + n : n.toString();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${month}-${day} ${hours}:${minutes}`;
};

const formatMatchTime = (value?: string) => value ? formatTime(new Date(value)) : '--';

const getTierStyle = () => {
  return 'text-slate-300';
};

const getTierIcon = (tier: number) => tier >= 1 && tier <= 5 ? `/tier-icons/tier${tier}.png` : null;

export default function PubgBanChecker() {
  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [savedPlayers, setSavedPlayers] = useState<PlayerData[]>(() => {
    const saved = localStorage.getItem('pubg_tracker_app_data_v9');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchStatus, setBatchStatus] = useState({ isRunning: false, current: 0, total: 0, errors: 0, statusText: '' });
  const batchCancelRef = useRef(false);

  // 拖拽核心状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragSnapshotTaken, setDragSnapshotTaken] = useState(false);
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);

  // 专为移动端定制的触摸状态
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const [touchInitialY, setTouchInitialY] = useState(0);
  const [touchCurrentY, setTouchCurrentY] = useState(0);

  const [nextRefreshTime, setNextRefreshTime] = useState<Date | null>(null);
  const [nextPlayerToUpdate, setNextPlayerToUpdate] = useState<string | null>(null);
  const [countdownStr, setCountdownStr] = useState('');

  const playersRef = useRef(savedPlayers);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    playersRef.current = savedPlayers;
    localStorage.setItem('pubg_tracker_app_data_v9', JSON.stringify(savedPlayers));
  }, [savedPlayers]);

  const fetchPlayerData = async (name: string): Promise<PlayerData> => {
    const response = await fetch(`https://api.pubg.com/shards/steam/players?filter[playerNames]=${name}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/vnd.api+json'
      }
    });

    if (response.status === 404) throw new Error(`未找到玩家: ${name}`);
    if (response.status === 429) throw new Error('请求过于频繁');
    if (!response.ok) throw new Error(`请求失败: ${response.status}`);

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const player = data.data[0];
      const banType = player.attributes.banType;
      const accountId = player.id;
      
      let survivalLevel = 0;
      let survivalTier = 0;
      let duoTppMatches: number | undefined;
      let duoTppKills: number | undefined;
      let duoTppKd: number | undefined;
      let squadTppMatches: number | undefined;
      let squadTppKills: number | undefined;
      let squadTppKd: number | undefined;
      let lastMatchAt: string | undefined;
      try {
        const masteryRes = await fetch(`https://api.pubg.com/shards/steam/players/${accountId}/survival_mastery`, {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/vnd.api+json'
          }
        });
        if (masteryRes.status === 429) throw new Error('请求过于频繁');
        if (masteryRes.ok) {
          const masteryData = await masteryRes.json();
          survivalLevel = masteryData.data.attributes.level;
          survivalTier = masteryData.data.attributes.tier || 0;
        }
      } catch (err: any) {
        if (err.message === '请求过于频繁') throw err; 
        console.warn("获取生存等级失败", err);
      }

      try {
        const statsRes = await fetch(`https://api.pubg.com/shards/steam/players/${accountId}/seasons/lifetime`, {
          headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
        });
        if (statsRes.ok) {
          const stats = (await statsRes.json()).data?.attributes?.gameModeStats || {};
          const kd = (mode: any) => mode?.roundsPlayed > 0 ? Number((mode.kills / mode.roundsPlayed).toFixed(2)) : undefined;
          const duo = stats.duo;
          const squad = stats.squad;
          duoTppMatches = duo?.roundsPlayed;
          duoTppKills = duo?.kills;
          duoTppKd = kd(duo);
          squadTppMatches = squad?.roundsPlayed;
          squadTppKills = squad?.kills;
          squadTppKd = kd(squad);
        }

        const matchId = player.relationships?.matches?.data?.[0]?.id;
        if (matchId) {
          const matchRes = await fetch(`https://api.pubg.com/shards/steam/matches/${matchId}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
          });
          if (matchRes.ok) lastMatchAt = (await matchRes.json()).data?.attributes?.createdAt;
        }
      } catch (err) {
        console.warn('获取模式数据失败', err);
      }

      return {
        id: player.attributes.name,
        accountId: accountId,
        isBanned: banType !== 'Innocent',
        banType: banType,
        survivalLevel: survivalLevel,
        survivalTier: survivalTier,
        duoTppMatches,
        duoTppKills,
        duoTppKd,
        squadTppMatches,
        squadTppKills,
        squadTppKd,
        lastMatchAt,
        lastChecked: formatTime(new Date())
      };
    }
    throw new Error('未找到该玩家的数据');
  };

  const handleSearch = async () => {
    if (!playerId.trim()) return;
    setError('');
    setLoading(true);

    try {
      const playerData = await fetchPlayerData(playerId.trim());
      setSavedPlayers(prev => {
        const exists = prev.findIndex(p => p.accountId === playerData.accountId);
        if (exists >= 0) {
          const newList = [...prev];
          newList[exists] = playerData;
          return newList;
        }
        return [playerData, ...prev];
      });
      setPlayerId('');
    } catch (err: any) {
      setError(err.message || '查询发生错误');
    } finally {
      setLoading(false);
    }
  };

  const startBatchImport = async () => {
    const names = batchInput.split(/[\n,，\s]+/).map(n => n.trim()).filter(n => n);
    const uniqueNames = names.filter((item, pos) => names.indexOf(item) === pos);
    
    const newNames = uniqueNames;
    const importOrder = new Map(newNames.map((name, index) => [name.toLowerCase(), index]));

    if (newNames.length === 0) {
      alert("没有找到有效ID。");
      return;
    }

    setBatchStatus({ isRunning: true, current: 0, total: newNames.length, errors: 0, statusText: '准备开始...' });
    batchCancelRef.current = false;

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < newNames.length; i++) {
      if (batchCancelRef.current) break;
      
      const currentName = newNames[i];
      setBatchStatus(prev => ({ ...prev, current: i + 1, statusText: `正在查询: ${currentName}` }));

      let retries = 3; 
      let success = false;

      while (retries > 0 && !success && !batchCancelRef.current) {
        try {
          const playerData = await fetchPlayerData(currentName);
          setSavedPlayers(prev => {
            const index = prev.findIndex(p => p.accountId === playerData.accountId);
            const next = index < 0 ? [...prev, playerData] : prev.map((player, playerIndex) => playerIndex === index ? playerData : player);
            return next.sort((a, b) => (importOrder.get(a.id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) - (importOrder.get(b.id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER));
          });
          success = true;
          successCount++;
        } catch (err: any) {
          if (err.message === '请求过于频繁' || err.message.includes('429')) {
            setBatchStatus(prev => ({ ...prev, statusText: `接口限制，冷却 10 秒... (剩余重试:${retries})` }));
            await new Promise(res => setTimeout(res, 10000)); 
            retries--;
          } else {
            console.error(err);
            errorCount++;
            break; 
          }
        }
      }

      if (i < newNames.length - 1 && !batchCancelRef.current) {
        setBatchStatus(prev => ({ ...prev, statusText: `等待下一条...` }));
        await new Promise(res => setTimeout(res, 3000));
      }
    }

    if (!batchCancelRef.current) {
      setSavedPlayers(prev => prev
        .filter(player => importOrder.has(player.id.toLowerCase()))
        .sort((a, b) => (importOrder.get(a.id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) - (importOrder.get(b.id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER))
      );
    }

    setBatchStatus({ isRunning: false, current: 0, total: 0, errors: 0, statusText: '' });
    setShowBatchModal(false);
    setBatchInput('');
    
    if (errorCount > 0 || successCount > 0) {
      alert(`导入结束！\n成功: ${successCount} 个\n失败: ${errorCount} 个 (查无此人或持续受限)`);
    }
  };

  const hasPlayers = savedPlayers.length > 0;
  
  useEffect(() => {
    if (!autoRefresh || isEditing || !hasPlayers || batchStatus.isRunning) {
      setNextRefreshTime(null);
      setNextPlayerToUpdate(null);
      return;
    }

    const intervalTime = 5 * 60 * 1000; 
    
    const checkNextPlayer = async () => {
      const currentPlayers = playersRef.current;
      if (currentPlayers.length === 0) return;

      if (currentIndexRef.current >= currentPlayers.length) {
        currentIndexRef.current = 0;
      }

      const playerToUpdate = currentPlayers[currentIndexRef.current];
      
      setSavedPlayers(prev => prev.map(p => 
        p.accountId === playerToUpdate.accountId ? { ...p, isUpdating: true } : p
      ));

      try {
        const updatedData = await fetchPlayerData(playerToUpdate.id);
        setSavedPlayers(prev => prev.map(p => 
          p.accountId === playerToUpdate.accountId ? { ...updatedData, isUpdating: false } : p
        ));
      } catch (err) {
        setSavedPlayers(prev => prev.map(p => 
          p.accountId === playerToUpdate.accountId ? { ...p, isUpdating: false } : p
        ));
      }

      currentIndexRef.current = (currentIndexRef.current + 1) % currentPlayers.length;
      setNextRefreshTime(new Date(Date.now() + intervalTime));
      setNextPlayerToUpdate(currentPlayers[currentIndexRef.current]?.id || null);
    };

    setNextRefreshTime(new Date(Date.now() + intervalTime));
    const initialNextIndex = currentIndexRef.current >= playersRef.current.length ? 0 : currentIndexRef.current;
    setNextPlayerToUpdate(playersRef.current[initialNextIndex]?.id || null);

    const timer = setInterval(checkNextPlayer, intervalTime);
    return () => clearInterval(timer);
  }, [autoRefresh, isEditing, hasPlayers, batchStatus.isRunning]);

  useEffect(() => {
    if (!autoRefresh || !nextRefreshTime || isEditing || batchStatus.isRunning) {
      setCountdownStr('');
      return;
    }
    
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const target = nextRefreshTime.getTime();
      const diff = target - now;
      
      if (diff <= 0) {
        setCountdownStr('即将更新...');
      } else {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdownStr(`${m}:${s < 10 ? '0' + s : s}`);
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [autoRefresh, nextRefreshTime, isEditing, batchStatus.isRunning]);

  // ================= 桌面端鼠标拖拽逻辑 =================
  const handleDragStart = (index: number) => {
    if (isTouchDragging) return;
    setDraggedIndex(index);
    setDragOverIndex(index);
    setTimeout(() => setDragSnapshotTaken(true), 0);
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const copyListItems = [...savedPlayers];
      const dragItemContent = copyListItems[draggedIndex];
      copyListItems.splice(draggedIndex, 1);
      copyListItems.splice(dragOverIndex, 0, dragItemContent);
      
      setSavedPlayers(copyListItems);
      currentIndexRef.current = 0; 
      
      setJustDroppedId(dragItemContent.accountId);
      setTimeout(() => setJustDroppedId(null), 500);
    }
    
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragSnapshotTaken(false);
    setIsTouchDragging(false);
  };

  // ================= 移动端触摸拖拽逻辑 =================
  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    setDraggedIndex(index);
    setDragOverIndex(index);
    setIsTouchDragging(true);
    setTouchInitialY(e.touches[0].clientY);
    setTouchCurrentY(e.touches[0].clientY);
    document.body.style.overflow = 'hidden';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchDragging || draggedIndex === null) return;
    const touch = e.touches[0];
    setTouchCurrentY(touch.clientY);
    
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (element) {
      const listItem = element.closest('[data-index]');
      if (listItem) {
        const hoverIndex = parseInt(listItem.getAttribute('data-index') || '-1', 10);
        if (hoverIndex >= 0 && hoverIndex !== dragOverIndex) {
          setDragOverIndex(hoverIndex);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (!isTouchDragging) return;
    document.body.style.overflow = ''; 
    handleDragEnd(); 
  };

  const getTransform = (index: number) => {
    if (draggedIndex === null || dragOverIndex === null) return 'translateY(0)';
    const gap = 12; 
    
    if (index === draggedIndex) {
      if (isTouchDragging) {
        return `translateY(${touchCurrentY - touchInitialY}px)`;
      }
      const diff = dragOverIndex - draggedIndex;
      return `translateY(calc(${diff} * (100% + ${gap}px)))`;
    }
    
    if (draggedIndex < dragOverIndex && index > draggedIndex && index <= dragOverIndex) {
      return `translateY(calc(-100% - ${gap}px))`;
    }
    if (draggedIndex > dragOverIndex && index >= dragOverIndex && index < draggedIndex) {
      return `translateY(calc(100% + ${gap}px))`;
    }
    return 'translateY(0)';
  };

  const removePlayer = (accountId: string) => {
    setSavedPlayers(prev => prev.filter(p => p.accountId !== accountId));
    currentIndexRef.current = 0;
  };

  const savePlayerId = async (player: PlayerData) => {
    if (editingAccountId !== player.accountId) return;
    const nextId = editingValue.trim();
    setEditingAccountId(null);
    if (!nextId || nextId.toLowerCase() === player.id.toLowerCase()) return;
    try {
      const updatedData = await fetchPlayerData(nextId);
      setSavedPlayers(prev => prev.map(item => item.accountId === player.accountId ? updatedData : item));
    } catch (err: any) {
      setError(err.message || '更新玩家 ID 失败');
    }
  };

  const forceRefreshSingle = async (player: PlayerData) => {
    setSavedPlayers(prev => prev.map(p => p.accountId === player.accountId ? { ...p, isUpdating: true } : p));
    try {
      const updatedData = await fetchPlayerData(player.id);
      setSavedPlayers(prev => prev.map(p => p.accountId === player.accountId ? { ...updatedData, isUpdating: false } : p));
    } catch (err) {
      setSavedPlayers(prev => prev.map(p => p.accountId === player.accountId ? { ...p, isUpdating: false } : p));
    }
  };

  const bannedCount = savedPlayers.filter(p => p.isBanned).length;

  return (
    <div className="ibm-shell min-h-screen bg-[#0B0F19] text-slate-100 font-sans selection:bg-blue-500/30 pb-safe relative">
      <div className="max-w-md mx-auto min-h-screen flex flex-col relative shadow-2xl bg-[#0B0F19]">
        
        <div className="px-6 pt-12 pb-4 sticky top-0 z-30 bg-[#0B0F19]/80 backdrop-blur-xl border-b border-slate-800/50">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <Crosshair className="w-6 h-6 text-blue-500" />
                Ban Tracker
              </h1>
              <p className="text-xs text-slate-400 font-medium mt-1 uppercase tracking-wider">PUBG Player Monitor</p>
            </div>
            
            <div className="flex flex-col items-end">
              <button 
                onClick={() => setAutoRefresh(!autoRefresh)}
                disabled={isEditing || batchStatus.isRunning}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  autoRefresh && !isEditing && !batchStatus.isRunning
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {autoRefresh && !isEditing && !batchStatus.isRunning ? (
                  <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE</>
                ) : (
                  <><span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> PAUSED</>
                )}
              </button>
              
              <div className="h-4 mt-1 text-right">
                {autoRefresh && !isEditing && !batchStatus.isRunning && nextPlayerToUpdate && countdownStr && (
                  <span className="text-[10px] text-slate-600 font-mono tracking-tight">
                    Next: {nextPlayerToUpdate} ({countdownStr})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-2">
            <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Activity className="w-4 h-4" />
                <span className="text-xs font-semibold">监控总数</span>
              </div>
              <div className="text-2xl font-black text-white">{savedPlayers.length}</div>
            </div>
            <div className="bg-red-500/10 rounded-2xl p-4 border border-red-500/20">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <UserX className="w-4 h-4" />
                <span className="text-xs font-semibold">已封禁</span>
              </div>
              <div className="text-2xl font-black text-red-400">{bannedCount}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-6 py-4 overflow-y-auto pb-24">
          
          <div className="relative mb-8 group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="w-5 h-5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input 
              type="text"
              placeholder="输入玩家昵称添加监控..."
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              disabled={isEditing || batchStatus.isRunning}
              className="w-full bg-slate-900 border border-slate-800 text-white text-sm rounded-2xl pl-12 pr-14 py-4 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600 shadow-inner"
            />
            <div className="absolute inset-y-0 right-2 flex items-center">
              {loading ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin mr-2" />
              ) : (
                <button 
                  onClick={handleSearch}
                  disabled={!playerId.trim() || isEditing || batchStatus.isRunning}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-3 py-2 text-xs font-bold transition-colors"
                >
                  添加
                </button>
              )}
            </div>
            {error && <p className="absolute -bottom-6 left-2 text-red-400 text-xs">{error}</p>}
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">玩家列表</h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowBatchModal(true)}
                disabled={isEditing || batchStatus.isRunning}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                批量导入
              </button>
              {savedPlayers.length > 0 && (
                <button 
                  onClick={() => setIsEditing(!isEditing)}
                  disabled={batchStatus.isRunning}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${isEditing ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  {isEditing ? '完成编辑' : '管理'}
                </button>
              )}
            </div>
          </div>

          {savedPlayers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center opacity-50">
              <Crosshair className="w-16 h-16 text-slate-600 mb-4" />
              <p className="text-slate-400 font-medium">暂无监控数据</p>
              <p className="text-slate-500 text-xs mt-1">在上方输入玩家昵称开始追踪</p>
            </div>
          ) : (
            <div className="space-y-3 relative">
              {savedPlayers.map((player, index) => {
                const isBanned = player.isBanned;
                const isPermanent = player.banType === 'PermanentBan';
                
                const isDraggingThis = draggedIndex === index;
                const isJustDropped = justDroppedId === player.accountId;
                const isDraggingAny = draggedIndex !== null;

                let cardBgClass = 'bg-slate-900 border border-slate-800 hover:border-slate-700';
                if (isBanned && !isDraggingThis) {
                  if (isPermanent) {
                    cardBgClass = 'bg-gradient-to-r from-red-500/15 to-slate-900 border border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]';
                  } else {
                    cardBgClass = 'bg-gradient-to-r from-orange-500/15 to-slate-900 border border-orange-500/40 shadow-[0_0_15px_rgba(249,115,22,0.15)]';
                  }
                }

                return (
                  <div 
                    key={player.accountId}
                    data-index={index}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (!isTouchDragging && draggedIndex !== null && draggedIndex !== index) {
                        setDragOverIndex(index);
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    className="relative z-0" 
                  >
                    <div 
                      draggable={isEditing && !isTouchDragging}
                      onDragStart={() => handleDragStart(index)}
                      onDragEnd={handleDragEnd}
                      style={{
                        transform: getTransform(index),
                        transition: isDraggingThis ? (isTouchDragging ? 'none' : 'none') : 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
                        zIndex: isDraggingThis ? 50 : isJustDropped ? 20 : 10
                      }}
                      className={`relative overflow-hidden rounded-2xl flex items-stretch
                        ${isEditing && !isTouchDragging ? 'cursor-move' : ''}
                        ${isDraggingAny && !isDraggingThis ? 'pointer-events-none' : ''} 
                        ${isDraggingThis && dragSnapshotTaken && !isTouchDragging ? 'opacity-40 border-2 border-dashed border-slate-500 bg-slate-900/50 shadow-none' : ''}
                        ${isDraggingThis && isTouchDragging ? 'shadow-[0_15px_30px_rgba(0,0,0,0.6)] border border-blue-500/50 opacity-95 pointer-events-none' : ''}
                        ${!isDraggingThis ? cardBgClass : ''}
                        ${isJustDropped ? 'animate-drop-bounce ring-2 ring-blue-500/50 bg-slate-800 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : ''}
                      `}
                    >
                      <div className={`flex items-stretch w-full ${isDraggingThis && dragSnapshotTaken && !isTouchDragging ? 'invisible' : 'visible'}`}>
                        
                        {isEditing && (
                          <button 
                            onClick={() => removePlayer(player.accountId)}
                            className="w-14 flex items-center justify-center bg-red-500/10 border-r border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-colors shrink-0"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}

                        <div className="flex-1 p-4 flex flex-col justify-center min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            {isEditing && editingAccountId === player.accountId ? (
                              <input
                                autoFocus
                                value={editingValue}
                                onChange={e => setEditingValue(e.target.value)}
                                onBlur={() => savePlayerId(player)}
                                onKeyDown={e => e.key === 'Enter' && savePlayerId(player)}
                                className="text-base font-bold truncate pr-2 px-2 py-1 w-full max-w-xs"
                              />
                            ) : (
                              <h3
                                onClick={() => { if (isEditing) { setEditingAccountId(player.accountId); setEditingValue(player.id); } }}
                                className={`text-base font-bold text-white truncate pr-2 ${isEditing ? 'cursor-text' : ''}`}
                              >{player.id} <span className="ml-2 text-xs font-mono font-normal text-slate-500">{player.accountId.split('.')[1]?.substring(0, 8)}</span></h3>
                            )}
                            
                            <div className="shrink-0">
                              {isBanned ? (
                                <span className={`px-2 py-1 rounded-md text-[10px] font-black tracking-wider flex items-center gap-1
                                  ${isPermanent ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.4)]' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}
                                `}>
                                  {isPermanent ? '永久封禁' : '临时封禁'}
                                </span>
                              ) : (
                                <span className="px-2 py-1 rounded-md text-[10px] font-bold tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  正常
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between text-xs mt-1 gap-3">
                            <div className="flex flex-col items-start gap-1">
                              {isEditing ? (
                                <input
                                  value={player.note || ''}
                                  onChange={e => setSavedPlayers(prev => prev.map(item => item.accountId === player.accountId ? { ...item, note: e.target.value } : item))}
                                  placeholder="添加备注..."
                                  className="w-full max-w-sm text-xs px-2 py-1"
                                />
                              ) : player.note ? <span className="text-xs text-slate-400">{player.note}</span> : null}
                              <div className="flex items-center gap-2 flex-wrap">
                                {player.survivalLevel > 0 && (
                                  <span className={`shrink-0 flex items-center gap-1 text-xs font-medium ${getTierStyle()}`}>
                                    {getTierIcon(player.survivalTier) && <img src={getTierIcon(player.survivalTier)!} alt={`${player.survivalTier}阶`} className="w-4 h-4 object-contain" />}
                                    <span>{player.survivalTier > 0 ? `${player.survivalTier}阶 ` : ''}Lv.{player.survivalLevel}</span>
                                  </span>
                                )}
                                {player.duoTppKd !== undefined && <span className="text-xs text-slate-300">双排 {player.duoTppKd.toFixed(2)}</span>}
                                {player.squadTppKd !== undefined && <span className="text-xs text-slate-300">四排 {player.squadTppKd.toFixed(2)}</span>}
                              </div>
                            </div>
                            
                            <span className="text-slate-500 flex items-center shrink-0 ml-2">
                              {player.isUpdating ? (
                                <span className="text-blue-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> 更新中</span>
                              ) : (
                                <span className="flex flex-col items-end gap-0.5"><span>最近游戏 {formatMatchTime(player.lastMatchAt)}</span><span>{player.lastChecked}</span></span>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* 移动端触摸拖拽把手 */}
                        {isEditing ? (
                          <div 
                            className="px-4 flex items-center justify-center border-l border-slate-800 text-slate-600 cursor-grab active:cursor-grabbing shrink-0 touch-none"
                            onTouchStart={(e) => handleTouchStart(e, index)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            onTouchCancel={handleTouchEnd}
                          >
                            <GripVertical className="w-5 h-5 pointer-events-none" />
                          </div>
                        ) : (
                          <button 
                            onClick={() => forceRefreshSingle(player)}
                            disabled={player.isUpdating}
                            className="px-4 flex items-center justify-center border-l border-slate-800 text-slate-500 hover:text-blue-400 hover:bg-slate-800/50 transition-colors shrink-0"
                          >
                            <RefreshCw className={`w-4 h-4 ${player.isUpdating ? 'animate-spin text-blue-400' : ''}`} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 批量导入弹窗 */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                批量导入 ID
              </h3>
              {!batchStatus.isRunning && (
                <button onClick={() => setShowBatchModal(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            
            <div className="p-4">
              <textarea
                value={batchInput}
                onChange={e => setBatchInput(e.target.value)}
                disabled={batchStatus.isRunning}
                placeholder="在此粘贴玩家名称...&#10;支持回车换行、空格或逗号分隔。&#10;例如：&#10;Player1&#10;Player2&#10;Player3"
                className="w-full h-40 bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder:text-slate-500 resize-none"
              />
              
              {batchStatus.isRunning && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs font-bold text-slate-300">
                    <span>{batchStatus.statusText}</span>
                    <span className="text-blue-400">{Math.round((batchStatus.current / batchStatus.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ease-out ${batchStatus.statusText.includes('冷却') ? 'bg-orange-500' : 'bg-blue-500'}`}
                      style={{ width: `${(batchStatus.current / batchStatus.total) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-800 flex gap-3">
              {batchStatus.isRunning ? (
                <button
                  onClick={() => { batchCancelRef.current = true; }}
                  className="flex-1 bg-red-500/10 border border-red-500/20 text-red-500 font-bold py-3 rounded-xl hover:bg-red-500 hover:text-white transition-colors"
                >
                  停止导入
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowBatchModal(false)}
                    className="flex-1 bg-slate-800 text-slate-300 font-bold py-3 rounded-xl hover:bg-slate-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={startBatchImport}
                    disabled={!batchInput.trim()}
                    className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-colors"
                  >
                    开始导入
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
