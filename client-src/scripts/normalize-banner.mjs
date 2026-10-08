/**
 * 把 tsdown/rolldown 美化成多行的 banner 折叠回宿主契约要求的单行前缀：
 *   window.__ModuleLoader__.load({ id: "@puwenhui/dsh-qq-bot", factory: (require) => {
 * 折叠掉的换行用空行补回，保持总行数不变以维持 sourcemap 对齐。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(new URL('../../lib/client.js', import.meta.url))
const src = readFileSync(target, 'utf8')

const loadMark = 'window.__ModuleLoader__.load({'
const factoryMark = 'factory: (require) => {'
const idx = src.indexOf(loadMark)
if (idx < 0) throw new Error('normalize-banner: 未找到 load 标记（构建配置的 banner 被改动？）')
const fIdx = src.indexOf(factoryMark, idx)
if (fIdx < 0 || fIdx - idx > 300) throw new Error('normalize-banner: factory 标记缺失或异常')

const segment = src.slice(idx, fIdx + factoryMark.length)
const collapsed = segment.replace(/\s+/g, ' ')
if (!collapsed.includes('"@puwenhui/dsh-qq-bot"')) {
  throw new Error(`normalize-banner: 折叠后前缀缺少包名 id：${collapsed}`)
}
const newlines = (segment.match(/\n/g) ?? []).length
const out = src.slice(0, idx) + collapsed + '\n'.repeat(newlines) + src.slice(fIdx + factoryMark.length)

if (out !== src) {
  writeFileSync(target, out)
  console.log(`normalize-banner: 已折叠（补偿 ${String(newlines)} 个换行保 sourcemap）`)
} else {
  console.log('normalize-banner: 前缀已是单行，无需处理')
}
