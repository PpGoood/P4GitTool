import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, buildHunkReversePatch, buildLineReversePatch } from './diff';

const SAMPLE_DIFF = `diff --git a/Source/Weapon.cpp b/Source/Weapon.cpp
index 1111111..2222222 100644
--- a/Source/Weapon.cpp
+++ b/Source/Weapon.cpp
@@ -38,6 +38,8 @@ float AWeapon::CalculateDamage()
   float base = GetBaseDamage();
   float damage = base;

-  damage *= 1.0f;
+  damage *= multiplier;
+  multiplier = GetWeaponMultiplier();

   return damage;
 }
@@ -61,5 +63,6 @@ void AWeapon::OnFire()
   PlayFireAnimation();
   SpawnProjectile();
+  ApplyRecoil();
   ConsumeAmmo();
 }
`;

describe('parseUnifiedDiff', () => {
  it('解析单文件两个 hunk', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);

    const f = files[0];
    expect(f.oldPath).toBe('Source/Weapon.cpp');
    expect(f.newPath).toBe('Source/Weapon.cpp');
    expect(f.hunks).toHaveLength(2);

    expect(f.hunks[0].oldStart).toBe(38);
    expect(f.hunks[0].oldLines).toBe(6);
    expect(f.hunks[0].newStart).toBe(38);
    expect(f.hunks[0].newLines).toBe(8);

    expect(f.hunks[1].oldStart).toBe(61);
    expect(f.hunks[1].newStart).toBe(63);
  });

  it('hunk 包含每行的类型', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const lines = files[0].hunks[0].lines;
    // 注意：parseUnifiedDiff 只剥掉 diff 前缀字符（+/-/空格），
    // 保留代码本身的缩进，这样才能原样还原 patch。
    expect(lines.some(l => l.type === 'del' && l.content === '  damage *= 1.0f;')).toBe(true);
    expect(lines.some(l => l.type === 'add' && l.content === '  damage *= multiplier;')).toBe(true);
    expect(lines.some(l => l.type === 'ctx' && l.content === '  float damage = base;')).toBe(true);
  });

  it('空 diff 返回空数组', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('buildHunkReversePatch', () => {
  it('构造单 hunk 反向 patch', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);

    expect(patch).toContain('--- a/Source/Weapon.cpp');
    expect(patch).toContain('+++ b/Source/Weapon.cpp');
    expect(patch).toContain('@@ -38,');
    expect(patch).not.toContain('@@ -61,'); // 只包含第一个 hunk
  });

  it('patch 以换行结尾', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);
    expect(patch.endsWith('\n')).toBe(true);
  });
});

describe('buildLineReversePatch', () => {
  it('撤销单个新增行，只保留该行作为 - 和上下文', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const hunk = files[0].hunks[0];
    // 第二个 hunk 里的新增行 "+  ApplyRecoil();"
    const hunk2 = files[0].hunks[1];
    const addIdx = hunk2.lines.findIndex(l => l.type === 'add');
    const patch = buildLineReversePatch(files[0], hunk2, addIdx);

    expect(patch).toContain('--- a/Source/Weapon.cpp');
    expect(patch).toContain('+++ b/Source/Weapon.cpp');
    // 反向：原本是 add，反向后应作为 - 出现
    expect(patch).toMatch(/^-\s*ApplyRecoil\(\);$/m);
  });
});
