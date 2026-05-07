import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { run } from './runner';

// 说明：Windows 下 spawn('node', [...], {shell:true}) 会走 cmd.exe，cmd 对 -e 参数里
// 的 `>` `;` 空格等有特殊含义。最稳的办法是把 JS 写到临时文件，参数里不再有特殊字符。

describe('run', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('执行简单命令并返回 stdout', async () => {
    const script = path.join(tmpDir, 'hello.js');
    fs.writeFileSync(script, `process.stdout.write('hello');`);
    const result = await run('node', [script]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('支持 stdin 输入', async () => {
    const script = path.join(tmpDir, 'echo.js');
    fs.writeFileSync(
      script,
      `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(s));`
    );
    const result = await run('node', [script], undefined, true, 'hello from stdin');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello from stdin');
  });

  it('stdin 为空字符串时不挂起', async () => {
    const script = path.join(tmpDir, 'ok.js');
    fs.writeFileSync(script, `process.stdout.write('ok');`);
    const result = await run('node', [script], undefined, true, '');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ok');
  });
});
