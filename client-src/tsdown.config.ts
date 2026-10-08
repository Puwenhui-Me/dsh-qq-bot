/**
 * 浏览器半边构建配置：产出宿主 client-modules 契约要求的 CJS 工厂格式。
 * 复刻 dshmarket 的 tsdown 配置骨架（banner/footer/intro 三件套 + 基线外部化），
 * 差异：无 CSS Modules 插件（本插件样式全部内联），产物直出 ../dsh-email-plugin/lib/。
 * 构建后须运行 scripts/normalize-banner.mjs 折叠 banner 为单行前缀。
 */
import { defineConfig } from 'tsdown'

const id = '@puwenhui/dsh-qq-bot'
/** 模块表基线里允许值导入的包（其余全部内联进 bundle） */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  entry: { client: './index.tsx' },
  outDir: '../lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.MODE': '"production"',
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
