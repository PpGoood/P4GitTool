import React, { useState, useEffect, useCallback } from 'react';
import { Settings, X, Plus, Trash2, Activity, Ban, ClipboardList, Zap, Link2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { api, P4GitConfig, TemplatesData } from '../api/client';
import { TemplateEditor, SkillsEditor } from './ConfigTemplates';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Category = 'conn' | 'gitignore' | 'claudemd' | 'skills' | 'mcp';

const NAV: { key: Category; label: string; icon: React.ReactNode; group: string }[] = [
  { key: 'conn', label: '连接配置', icon: <Activity size={15} />, group: '连接' },
  { key: 'gitignore', label: 'Git 忽略规则', icon: <Ban size={15} />, group: 'Agent 配置' },
  { key: 'claudemd', label: 'Agent 规则', icon: <ClipboardList size={15} />, group: '' },
  { key: 'skills', label: '技能 Skills', icon: <Zap size={15} />, group: '' },
  { key: 'mcp', label: 'MCP 服务', icon: <Link2 size={15} />, group: '' },
];

export const ConfigDialog: React.FC<Props> = ({ open, onClose }) => {
  const [cat, setCat] = useState<Category>('conn');
  const [templates, setTemplates] = useState<TemplatesData | null>(null);

  const reloadTemplates = useCallback(() => {
    api.getTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) { setCat('conn'); reloadTemplates(); }
  }, [open, reloadTemplates]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#252526] border border-[#3e3e42] rounded-lg w-[840px] h-[580px] flex flex-col shadow-2xl overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-[#3e3e42] shrink-0">
          <div className="flex items-center gap-2 text-[#cccccc] text-sm font-medium">
            <Settings size={14} className="text-[#888]" />
            <span>设置</span>
          </div>
          <button onClick={onClose} className="text-[#858585] hover:text-[#cccccc] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 左侧导航 */}
          <div className="w-[176px] bg-[#1e1e1e] border-r border-[#3e3e42] py-2 shrink-0 overflow-y-auto">
            {NAV.map((n) => (
              <React.Fragment key={n.key}>
                {n.group && (
                  <div className="text-[10px] text-[#6a6a6a] uppercase tracking-wider px-4 pt-3 pb-1.5">{n.group}</div>
                )}
                <button
                  onClick={() => setCat(n.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-[12px] border-l-2 transition-colors ${
                    cat === n.key
                      ? 'bg-[#2a2d2e] text-white border-[#007acc]'
                      : 'text-[#b0b0b0] border-transparent hover:bg-[#2a2d2e]'
                  }`}
                >
                  <span className={cat === n.key ? 'opacity-100' : 'opacity-85'}>{n.icon}</span>
                  {n.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* 右侧内容 */}
          <div className="flex-1 flex flex-col min-w-0">
            {cat === 'conn' && <ConnectionConfig onClose={onClose} />}
            {cat === 'gitignore' && templates && (
              <TemplateEditor data={templates} kind="gitignore" reload={reloadTemplates}
                title="Git 忽略规则 (.gitignore)"
                desc="编辑模板后点「同步到所有工作区」分发。标记区由工具管理，工作区里手动加的内容会保留。" />
            )}
            {cat === 'claudemd' && templates && (
              <TemplateEditor data={templates} kind="claudemd" reload={reloadTemplates}
                title="Agent 规则 (CLAUDE.md)"
                desc="告诉每个工作区的 agent：被本工具管理、不要切/合分支、提交走快照、P4 提交交给 P4V。" />
            )}
            {cat === 'skills' && templates && (
              <SkillsEditor data={templates} reload={reloadTemplates} />
            )}
            {cat === 'mcp' && templates && (
              <TemplateEditor data={templates} kind="mcp" reload={reloadTemplates}
                title="MCP 服务 (.mcp.json)"
                desc="项目级 MCP 配置，同步后写入每个工作区。例如配好的 P4 MCP server。" />
            )}
            {(cat !== 'conn' && !templates) && (
              <div className="flex-1 flex items-center justify-center text-[#666] text-[12px]">加载中...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ===== 连接配置（保留原有 P4 + 工作区逻辑） =====
const ConnectionConfig: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const logCollapsed = useAppStore((s) => s.logCollapsed);
  const toggleLog = useAppStore((s) => s.toggleLog);

  const [form, setForm] = useState<P4GitConfig>(
    config ?? { p4_port: '', p4_user: '', workspaces_dir: '', streams: [] }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (config) setForm({ ...config, workspaces_dir: config.workspaces_dir ?? '' });
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveConfig(form);
      onClose();
    } catch (e: any) {
      setError(e.message ?? '保存失败，请检查日志');
      if (logCollapsed) toggleLog();
    } finally {
      setSaving(false);
    }
  };

  const addStream = () => setForm((f) => ({ ...f, streams: [...f.streams, { name: '', client: '', root: '' }] }));
  const removeStream = (i: number) => setForm((f) => ({ ...f, streams: f.streams.filter((_, idx) => idx !== i) }));
  const updateStream = (i: number, key: string, value: string) =>
    setForm((f) => ({ ...f, streams: f.streams.map((s, idx) => idx === i ? { ...s, [key]: value } : s) }));

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 border-b border-[#2d2d2d] shrink-0">
        <h2 className="text-[14px] font-semibold text-[#eee]">连接配置</h2>
        <p className="text-[11px] text-[#777] mt-1 leading-relaxed">P4 服务器连接信息和各 Stream 工作区映射。</p>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="space-y-3">
          <div className="text-[#858585] text-[11px] uppercase tracking-wider">P4 配置</div>
          <Field label="P4 Port" value={form.p4_port} onChange={(v) => setForm((f) => ({ ...f, p4_port: v }))} placeholder="ssl:server:1666" />
          <Field label="P4 User" value={form.p4_user} onChange={(v) => setForm((f) => ({ ...f, p4_user: v }))} placeholder="username" />
        </div>
        <div className="space-y-3">
          <div className="text-[#858585] text-[11px] uppercase tracking-wider">工作目录</div>
          <Field label="Git 仓库目录" value={form.workspaces_dir ?? ''} onChange={(v) => setForm((f) => ({ ...f, workspaces_dir: v }))} placeholder="留空则使用默认目录" />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[#858585] text-[11px] uppercase tracking-wider">工作区</div>
            <button onClick={addStream} className="flex items-center gap-1 text-[#858585] hover:text-[#cccccc] text-[11px] transition-colors">
              <Plus size={11} /><span>添加</span>
            </button>
          </div>
          {form.streams.map((s, i) => (
            <div key={i} className="bg-[#1e1e1e] rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#858585] text-[11px]">Stream {i + 1}</span>
                <button onClick={() => removeStream(i)} className="text-[#858585] hover:text-[#f44747] transition-colors"><Trash2 size={12} /></button>
              </div>
              <Field label="名称" value={s.name} onChange={(v) => updateStream(i, 'name', v)} placeholder="dev / main / release" />
              <Field label="Client" value={s.client} onChange={(v) => updateStream(i, 'client', v)} placeholder="p4-client-name" />
              <Field label="Root" value={s.root} onChange={(v) => updateStream(i, 'root', v)} placeholder="D:\work\code\dev_code" />
            </div>
          ))}
        </div>
        {error && (
          <div className="px-3 py-2 bg-[#f4877122] border border-[#f4877144] rounded text-[#f48771] text-[11px]">{error}</div>
        )}
      </div>
      <div className="flex gap-2 px-5 py-3 border-t border-[#3e3e42] shrink-0">
        <button onClick={handleSave} disabled={saving} className="flex-1 bg-[#007acc] hover:bg-[#1a8ad4] disabled:opacity-50 text-white text-xs py-1.5 rounded transition-colors">
          {saving ? '保存中...' : '保存'}
        </button>
        <button onClick={onClose} className="flex-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] text-xs py-1.5 rounded transition-colors">取消</button>
      </div>
    </div>
  );
};

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#858585] text-xs w-16 shrink-0">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1.5 rounded border border-[#555] outline-none focus:border-[#007acc] placeholder-[#555]"
      />
    </div>
  );
}
