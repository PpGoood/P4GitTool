import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, Plus, Trash2, Pencil, Lightbulb, FolderOpen, Check, AlertCircle } from 'lucide-react';
import { api, TemplateKind, TemplatesData, StreamSyncStatus, SkillEntry, SyncStreamResult } from '../api/client';

const STATE_COLOR: Record<string, string> = {
  ok: '#4ec9b0',
  behind: '#cca700',
  modified: '#f48771',
  missing: '#666',
};

const STATE_LABEL: Record<string, string> = {
  ok: '已同步',
  behind: '待同步',
  modified: '被改过',
  missing: '未初始化',
};

// 把同步结果汇总成一句人话
function summarizeSync(results: SyncStreamResult[]): { ok: boolean; text: string } {
  if (results.length === 0) {
    return { ok: false, text: '没有可同步的工作区，请先在「连接配置」里添加 Stream 并 Init' };
  }
  const failed = results.filter(r => !r.ok);
  const written = results.reduce((n, r) => n + r.files.filter(f => f.action === 'written').length, 0);
  if (failed.length > 0) {
    return { ok: false, text: `${failed.length} 个工作区同步失败：${failed.map(f => f.stream).join('、')}` };
  }
  const names = results.map(r => r.stream).join('、');
  return { ok: true, text: written > 0 ? `已同步 ${results.length} 个工作区（${names}），写入 ${written} 个文件` : `已同步 ${results.length} 个工作区，无文件变化` };
}

// 顶部路径栏：显示模板目录 + 打开按钮
const PathBar: React.FC<{ dir: string }> = ({ dir }) => (
  <div className="flex items-center gap-2 px-5 py-2 bg-[#1a1a1a] border-b border-[#2d2d2d] text-[11px] text-[#888] shrink-0">
    <span className="shrink-0">模板目录：</span>
    <code className="flex-1 truncate text-[#9cdcfe] font-mono" title={dir}>{dir || '(未知)'}</code>
    <button
      onClick={() => api.openTemplatesDir()}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-[#2a2d2e] hover:bg-[#3c3c3c] border border-[#444] text-[#ccc]"
      title="在资源管理器中打开，可用外部编辑器修改模板"
    >
      <FolderOpen size={11} /> 打开目录
    </button>
  </div>
);

// 同步结果提示条
const SyncResult: React.FC<{ result: { ok: boolean; text: string } | null }> = ({ result }) => {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 px-5 py-2 text-[11px] border-t ${
      result.ok ? 'bg-[#4ec9b011] border-[#4ec9b033] text-[#4ec9b0]' : 'bg-[#f4877111] border-[#f4877133] text-[#f48771]'
    }`}>
      {result.ok ? <Check size={13} /> : <AlertCircle size={13} />}
      <span>{result.text}</span>
    </div>
  );
};

// 同步状态条 + 同步按钮（底部公用）
const SyncFooter: React.FC<{
  status: StreamSyncStatus[];
  onSync: () => void;
  onSave?: () => void;
  saving?: boolean;
  syncing?: boolean;
}> = ({ status, onSync, onSave, saving, syncing }) => (
  <div className="flex items-center justify-between px-5 py-3 border-t border-[#3e3e42] shrink-0">
    <div className="flex items-center gap-3.5 text-[11px]">
      {status.map((s) => (
        <span key={s.stream} className="flex items-center gap-1.5 text-[#999]" title={STATE_LABEL[s.state]}>
          <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: STATE_COLOR[s.state] }} />
          {s.stream}
        </span>
      ))}
    </div>
    <div className="flex gap-2">
      {onSave && (
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 text-[12px] rounded bg-[#2a2d2e] hover:bg-[#3c3c3c] disabled:opacity-50 text-[#ccc] border border-[#444] flex items-center gap-1.5"
        >
          <Save size={12} /> {saving ? '保存中' : '保存'}
        </button>
      )}
      <button
        onClick={onSync}
        disabled={syncing}
        className="px-4 py-1.5 text-[12px] rounded bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white font-semibold flex items-center gap-1.5"
      >
        <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? '同步中' : '同步到所有工作区'}
      </button>
    </div>
  </div>
);

// 文本模板编辑器（gitignore / claudemd / mcp / gitattributes）
export const TemplateEditor: React.FC<{
  data: TemplatesData;
  kind: TemplateKind;
  title: string;
  desc: string;
  reload: () => void;
}> = ({ data, kind, title, desc, reload }) => {
  const [content, setContent] = useState(data.templates[kind] ?? '');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setContent(data.templates[kind] ?? ''); setResult(null); }, [data, kind]);

  const save = async () => {
    setSaving(true);
    try { await api.saveTemplate(kind, content); reload(); } finally { setSaving(false); }
  };
  const sync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      await api.saveTemplate(kind, content);
      const res = await api.syncConfig();
      setResult(summarizeSync(res.results));
      reload();
    } catch (e: any) {
      setResult({ ok: false, text: e.message ?? '同步失败' });
    } finally { setSyncing(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 border-b border-[#2d2d2d] shrink-0">
        <h2 className="text-[14px] font-semibold text-[#eee]">{title}</h2>
        <p className="text-[11px] text-[#777] mt-1 leading-relaxed">{desc}</p>
      </div>
      <PathBar dir={data.templatesDir} />
      <div className="flex-1 p-5 overflow-hidden flex flex-col">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="flex-1 bg-[#1a1a1a] border border-[#3e3e42] rounded p-3 font-mono text-[11.5px] leading-relaxed text-[#c5c5c5] resize-none outline-none focus:border-[#007acc]"
        />
        <div className="mt-3 px-3 py-2.5 bg-[#2a2d2e] border-l-[3px] border-[#007acc] rounded text-[11px] text-[#aaa] leading-relaxed flex items-start gap-2 shrink-0">
          <Lightbulb size={14} className="text-[#4aa3df] shrink-0 mt-0.5" />
          <span>给 agent 用：不必点同步按钮，运行 workspaces 目录下的 <code className="bg-[#1a1a1a] px-1.5 py-0.5 rounded text-[#ce9178] font-mono">同步配置.bat</code> 即可把规则/技能/MCP 分发到所有工作区。</span>
        </div>
      </div>
      <SyncResult result={result} />
      <SyncFooter status={data.status} onSave={save} onSync={sync} saving={saving} syncing={syncing} />
    </div>
  );
};

// 技能列表管理
export const SkillsEditor: React.FC<{ data: TemplatesData; reload: () => void }> = ({ data, reload }) => {
  const [editing, setEditing] = useState<SkillEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await api.syncConfig();
      setResult(summarizeSync(res.results));
      reload();
    } catch (e: any) {
      setResult({ ok: false, text: e.message ?? '同步失败' });
    } finally { setSyncing(false); }
  };
  const remove = async (name: string) => {
    await api.deleteSkill(name); reload();
  };

  if (editing) {
    return <SkillEditForm skill={editing} onClose={() => { setEditing(null); reload(); }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 border-b border-[#2d2d2d] shrink-0">
        <h2 className="text-[14px] font-semibold text-[#eee]">技能 Skills</h2>
        <p className="text-[11px] text-[#777] mt-1 leading-relaxed">封装好的 agent 操作流程，同步后写入每个工作区的 .claude/skills/ 目录。</p>
      </div>
      <PathBar dir={data.templatesDir} />
      <div className="flex-1 p-5 overflow-y-auto">
        {data.skills.length === 0 && (
          <div className="text-[#666] text-[12px] mb-3">还没有技能，点下方按钮新增。</div>
        )}
        {data.skills.map((s) => (
          <div key={s.name} className="flex items-center justify-between bg-[#1a1a1a] border border-[#333] rounded px-3 py-2.5 mb-2">
            <div className="min-w-0">
              <div className="text-[12px] text-[#ddd] truncate">{s.name}</div>
              <div className="text-[10px] text-[#777] mt-0.5 truncate">{firstLine(s.content)}</div>
            </div>
            <div className="flex gap-1.5 shrink-0 ml-3">
              <button onClick={() => setEditing(s)} className="text-[10px] px-2 py-1 rounded bg-[#2a2d2e] border border-[#444] text-[#aaa] hover:text-[#ccc] flex items-center gap-1"><Pencil size={10} /> 编辑</button>
              <button onClick={() => remove(s.name)} className="text-[10px] px-2 py-1 rounded bg-[#2a2d2e] border border-[#444] text-[#aaa] hover:text-[#f48771] flex items-center gap-1"><Trash2 size={10} /> 删除</button>
            </div>
          </div>
        ))}
        <button
          onClick={() => setEditing({ name: '', content: '' })}
          className="mt-1 px-3 py-1.5 text-[12px] rounded bg-[#2a2d2e] hover:bg-[#3c3c3c] text-[#ccc] border border-[#444] flex items-center gap-1.5"
        >
          <Plus size={12} /> 新增技能
        </button>
        <div className="mt-4 px-3 py-2.5 bg-[#2a2d2e] border-l-[3px] border-[#007acc] rounded text-[11px] text-[#aaa] leading-relaxed flex items-start gap-2">
          <Lightbulb size={14} className="text-[#4aa3df] shrink-0 mt-0.5" />
          <span>给 agent 用：不必点同步按钮，运行 workspaces 目录下的 <code className="bg-[#1a1a1a] px-1.5 py-0.5 rounded text-[#ce9178] font-mono">同步配置.bat</code> 即可把规则/技能/MCP 分发到所有工作区。</span>
        </div>
      </div>
      <SyncResult result={result} />
      <SyncFooter status={data.status} onSync={sync} syncing={syncing} />
    </div>
  );
};

const SkillEditForm: React.FC<{ skill: SkillEntry; onClose: () => void }> = ({ skill, onClose }) => {
  const [name, setName] = useState(skill.name);
  const [content, setContent] = useState(skill.content || '---\nname: \ndescription: \n---\n\n');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) { setErr('请填写技能名'); return; }
    setSaving(true);
    try { await api.saveSkill(name.trim(), content); onClose(); }
    catch (e: any) { setErr(e.message ?? '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 border-b border-[#2d2d2d] shrink-0">
        <h2 className="text-[14px] font-semibold text-[#eee]">{skill.name ? '编辑技能' : '新增技能'}</h2>
      </div>
      <div className="flex-1 p-5 overflow-hidden flex flex-col gap-3">
        <div>
          <label className="block text-[11px] text-[#999] mb-1">技能名（英文，作为文件名）</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="commit-snapshot"
            disabled={!!skill.name}
            className="w-full bg-[#1a1a1a] border border-[#3e3e42] rounded px-2.5 py-1.5 text-[12px] text-[#ccc] outline-none focus:border-[#007acc] disabled:opacity-60"
          />
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="flex-1 bg-[#1a1a1a] border border-[#3e3e42] rounded p-3 font-mono text-[11.5px] leading-relaxed text-[#c5c5c5] resize-none outline-none focus:border-[#007acc]"
        />
        {err && <div className="text-[#f48771] text-[11px]">{err}</div>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#3e3e42]">
        <button onClick={onClose} className="px-4 py-1.5 text-[12px] rounded bg-[#2a2d2e] hover:bg-[#3c3c3c] text-[#ccc] border border-[#444]">取消</button>
        <button onClick={save} disabled={saving} className="px-4 py-1.5 text-[12px] rounded bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white font-semibold">{saving ? '保存中' : '保存'}</button>
      </div>
    </div>
  );
};

function firstLine(s: string): string {
  const line = s.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('---') && !l.startsWith('#'));
  return line ?? '(空)';
}
