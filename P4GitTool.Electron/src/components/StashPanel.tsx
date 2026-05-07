import { useState } from 'react';
import { Plus, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function StashPanel() {
  const stashes = useAppStore((s) => s.stashes);
  const status = useAppStore((s) => s.status);
  const runCreateStash = useAppStore((s) => s.runCreateStash);
  const runPopStash = useAppStore((s) => s.runPopStash);
  const runDropStash = useAppStore((s) => s.runDropStash);
  const appendLog = useAppStore((s) => s.appendLog);

  const [newName, setNewName] = useState('');
  const [showInput, setShowInput] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const ok = await runCreateStash(newName.trim());
    if (ok) { setNewName(''); setShowInput(false); }
    else appendLog('[ERROR] Stash 创建失败');
  };

  const handlePop = async (index: number, branch: string) => {
    const curBranch = status?.branch ?? '';
    if (branch !== curBranch) {
      const ok = window.confirm(
        `该 Stash 来自分支：${branch}\n当前分支：${curBranch}\n\n确定要恢复到当前分支吗？`
      );
      if (!ok) return;
    }
    await runPopStash(index);
  };

  const handleDrop = async (index: number, name: string) => {
    const ok = window.confirm(`确定要删除 Stash「${name}」吗？此操作不可撤销。`);
    if (!ok) return;
    await runDropStash(index);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3e3e42]">
        <div className="flex items-center gap-1.5 text-[#858585] text-[11px] uppercase tracking-wider">
          <Archive size={12} />
          <span>Stash</span>
          {stashes.length > 0 && (
            <span className="bg-[#007acc] text-white text-[10px] px-1.5 rounded-full">
              {stashes.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowInput(!showInput)}
          className="flex items-center gap-1 text-[#858585] hover:text-[#cccccc] text-[11px] transition-colors"
        >
          <Plus size={12} />
          <span>New</span>
        </button>
      </div>

      {/* 新建 Stash 输入框 */}
      {showInput && (
        <div className="px-3 py-2 border-b border-[#3e3e42] bg-[#2d2d2d]">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setShowInput(false); setNewName(''); }
            }}
            placeholder="输入暂存名称..."
            className="w-full bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1.5 rounded border border-[#555] outline-none focus:border-[#007acc] placeholder-[#555]"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreate}
              className="flex-1 bg-[#007acc] hover:bg-[#1a8ad4] text-white text-xs py-1 rounded transition-colors"
            >
              保存
            </button>
            <button
              onClick={() => { setShowInput(false); setNewName(''); }}
              className="flex-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] text-xs py-1 rounded transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Stash 列表 */}
      <div className="flex-1 overflow-y-auto">
        {stashes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#555] text-xs gap-2">
            <Archive size={24} className="opacity-30" />
            <span>暂无 Stash</span>
          </div>
        ) : (
          stashes.map((entry) => (
            <div
              key={entry.index}
              className="flex items-center justify-between px-3 py-2.5 border-b border-[#2d2d2d] hover:bg-[#2a2d2e] group"
            >
              <div className="flex-1 min-w-0 mr-2">
                <div className="text-[#cccccc] text-xs truncate">{entry.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[#858585] text-[10px]">{entry.branch}</span>
                  {entry.date && (
                    <span className="text-[#555] text-[10px]">{entry.date}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handlePop(entry.index, entry.branch)}
                  title="恢复"
                  className="p-1 text-[#858585] hover:text-[#4ec9b0] transition-colors"
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  onClick={() => handleDrop(entry.index, entry.name)}
                  title="删除"
                  className="p-1 text-[#858585] hover:text-[#f44747] transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
