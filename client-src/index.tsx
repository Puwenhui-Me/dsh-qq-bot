/**
 * 浏览器半边：设置 → 插件 →「QQ 机器人」标签页（settings.plugins.tab 槽）。
 * 读写经 remote.settings——写入落 profile patch 的 qq-bot entry config，
 * 宿主自动按新配置重挂载插件，保存即生效。
 */
import { createElement as h } from 'react'
import { QqSettingsTab } from './settings-tab.tsx'

export const name = 'dsh-qq-bot'
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

const NS = 'dsh-qq-bot'
const zh = { tab: 'QQ 机器人' }
const en = { tab: 'QQ Bot' }

export interface SettingsFace {
  describe(): Promise<{ namespaces: unknown[] } | { error: string }>
  mutate(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, revision?: number): Promise<{ ok: boolean; error?: string }>
}

export function apply(ctx: {
  slots: {
    inject: (slot: string, register: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: (props?: unknown) => unknown) => () => void
  }
  locale: { register(ns: string, dict: Record<string, Record<string, string>>): unknown }
  remote: { settings: SettingsFace }
  effect: (fn: () => unknown, label?: string) => () => void
}): void {
  ctx.effect(() => {
    try { ctx.locale.register(NS, { zh, en }) } catch { /* 已注册 */ }
    const t = (key: keyof typeof zh) => zh[key] ?? String(key)
    const face: SettingsFace = {
      describe: async () => {
        const response = await ctx.remote.settings.describe()
        return response.ok && response.value !== undefined
          ? { namespaces: response.value.namespaces }
          : { error: response.error?.message ?? 'settings.describe failed' }
      },
      mutate: async (ns, ops, revision) => {
        const response = await ctx.remote.settings.mutate(ns, ops, revision)
        return response.ok ? { ok: true } : { ok: false, error: response.error?.message ?? 'settings.mutate failed' }
      },
    }
    const offTab = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'qq-bot',
      order: 40,
      label: () => t('tab'),
      locale: NS,
      inject: () => ({ face }),
    }, QqSettingsTab))
    return () => { offTab() }
  }, 'dsh-qq-bot: settings tab')
}
