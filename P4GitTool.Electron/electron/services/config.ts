import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface StreamConfig {
  name: string;
  client: string;
  root: string;
}

export interface P4GitConfig {
  p4_port: string;
  p4_user: string;
  workspaces_dir: string;  // Git 仓库存放目录，agent 在这里工作
  streams: StreamConfig[];
}

const DEFAULT_CONFIG: P4GitConfig = {
  p4_port: '',
  p4_user: '',
  workspaces_dir: '',
  streams: [],
};

let configPath = '';

export function setConfigPath(p: string) {
  configPath = p;
}

export function loadConfig(): P4GitConfig {
  if (!configPath || !fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return (yaml.load(raw) as P4GitConfig) ?? { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: P4GitConfig) {
  fs.writeFileSync(configPath, yaml.dump(cfg), 'utf-8');
}

export function getStream(cfg: P4GitConfig, name: string): StreamConfig | undefined {
  return cfg.streams.find((s) => s.name === name);
}

export function repoPath(rootDir: string, stream: string) {
  return path.join(rootDir, `ProjectX_${stream}_git`);
}

export function p4Root(cfg: P4GitConfig, stream: string) {
  const sc = getStream(cfg, stream);
  if (!sc) throw new Error(`Stream '${stream}' not found`);
  return path.join(sc.root, 'ProjectX');
}
