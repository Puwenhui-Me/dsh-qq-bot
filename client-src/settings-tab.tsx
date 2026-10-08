/**
 * 设置 → 插件 →「QQ 机器人」标签页：连接与对话模型配置表单。
 * 数据层与交互同邮件插件（describe/mutate、覆盖标记、密码脱敏、保存即重载）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { SettingsFace } from './index.tsx'

interface NamespaceView {
  ns: string
  value?: Record<string, unknown>
  user?: Record<string, unknown>
  revision?: number
}

interface FieldDef {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'secret'
  placeholder?: string
  hint?: string
}

/** 面板字段（LLM 路由跟随 DSH 部署默认模型，不在此配置；schema 能力保留可手配 patch） */
const FIELDS: FieldDef[] = [
  { key: 'appid', label: 'QQ 开放平台 AppID', type: 'string', placeholder: '开放平台应用详情页获取' },
  { key: 'secret', label: 'AppSecret', type: 'secret', hint: '留空表示不修改；推荐改用 secretEnv 走环境变量' },
  { key: 'secretEnv', label: 'AppSecret 环境变量名', type: 'string', placeholder: 'QQBOT_SECRET' },
  { key: 'markdown', label: '回复以 QQ Markdown 发送', type: 'boolean' },
  { key: 'ack', label: '收到消息的确认语', type: 'string', placeholder: '空 = 不发确认' },
  { key: 'workspaceTitle', label: '侧边栏分组标题', type: 'string' },
  { key: 'pythonPath', label: 'Python 解释器', type: 'string', placeholder: 'python' },
  { key: 'botScript', label: 'bot.py 路径', type: 'string', placeholder: '空 = 内置脚本' },
  { key: 'stateDir', label: '状态目录', type: 'string', placeholder: '空 = $DSH_HOME/qq-bot' },
  { key: 'mediaDir', label: '媒体缓存目录', type: 'string', placeholder: '空 = 状态目录/media' },
  { key: 'cwdRoot', label: '会话工作区根目录', type: 'string', placeholder: '空 = 状态目录/workspaces' },
]

export function QqSettingsTab(props: { face: SettingsFace }): JSX.Element {
  const face = props.face
  const [ns, setNs] = useState<string | null>(null)
  const [view, setView] = useState<NamespaceView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    if (face === undefined || typeof face.describe !== 'function') {
      setError('组件未收到设置读写面（inject face 缺失）')
      return
    }
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('settings.describe 8 秒未响应')), 8000))
    let result: Awaited<ReturnType<typeof face.describe>>
    try {
      result = await Promise.race([face.describe(), timeout])
    } catch (e) {
      setError(`读取设置失败：${String((e as Error).message)}`)
      return
    }
    if ('error' in result) {
      setError(result.error)
      return
    }
    const rows = (result.namespaces ?? []) as NamespaceView[]
    const hit = rows.find(row => row.ns === 'qq-bot')
    if (hit === undefined) {
      setError(`设置视图中未找到 qq-bot 命名空间（共 ${String(rows.length)} 个）`)
      return
    }
    setNs(hit.ns)
    setView(hit)
    setDraft(null)
  }, [face])

  useEffect(() => { void reload() }, [reload])

  const current = (view?.value ?? {}) as Record<string, unknown>
  const userLayer = (view?.user ?? {}) as Record<string, unknown>
  const shown = draft ?? current

  const edit = (key: string, value: unknown): void => {
    setMessage(null)
    setFailed(false)
    setDraft(prev => ({ ...(prev ?? { ...current }), [key]: value }))
  }

  const asText = (f: FieldDef): string => String(shown[f.key] ?? '')

  const save = async (): Promise<void> => {
    if (draft === null || ns === null || view === undefined) return
    setSaving(true)
    try {
      const ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }> = []
      for (const f of FIELDS) {
        const after = draft[f.key]
        if (after === undefined) continue
        if (f.type === 'secret' && String(after) === '') continue
        const before = current[f.key]
        if (JSON.stringify(after) === JSON.stringify(before)) continue
        ops.push({ op: 'set', path: [f.key], value: after })
      }
      if (ops.length > 0) {
        const result = await face.mutate(ns, ops, view.revision)
        if (!result.ok) throw new Error(result.error ?? '写入失败')
      }
      setDraft(null)
      setFailed(false)
      setMessage(ops.length > 0 ? '已保存，插件已按新配置自动重载' : '无更改')
      await reload()
    } catch (e) {
      setFailed(true)
      setMessage(`保存失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  const resetField = async (f: FieldDef): Promise<void> => {
    if (ns === null || view === undefined) return
    setSaving(true)
    try {
      const result = await face.mutate(ns, [{ op: 'unset', path: [f.key] }], view.revision)
      if (!result.ok) throw new Error(result.error ?? '写入失败')
      if (draft !== null) {
        const next = { ...draft }
        delete next[f.key]
        setDraft(next)
      }
      setMessage(`已恢复默认：${f.label}`)
      await reload()
    } catch (e) {
      setFailed(true)
      setMessage(`恢复失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', font: 'inherit', boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
    background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
  }

  if (error !== null) {
    return (
      <div style={{ ...cardStyle, color: 'var(--dsw-alias-label-tertiary)' }}>
        QQ 机器人配置加载失败：{error}
        <button type="button" onClick={() => { void reload() }} style={{ ...btnStyle, marginLeft: '10px' }}>重试</button>
      </div>
    )
  }
  if (view === null) {
    return <div style={{ ...cardStyle, color: 'var(--dsw-alias-label-tertiary)' }}>QQ 机器人配置加载中…</div>
  }

  return (
    <div style={cardStyle}>
      <strong style={{ fontSize: '14px' }}>QQ 机器人</strong>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: '12px' }}>
        {FIELDS.map((f) => {
          const overridden = Object.hasOwn(userLayer, f.key)
          return (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                {f.label}
                {overridden && (
                  <span style={{ marginLeft: '6px', color: 'var(--dsw-alias-brand-primary)' }} title="用户已覆盖默认值">
                    {f.type === 'secret' ? '·已设置' : '·已覆盖'}
                  </span>
                )}
                {overridden && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => { void resetField(f) }}
                    style={{ marginLeft: '8px', padding: '0 6px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px', background: 'transparent', font: 'inherit', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}
                  >恢复默认</button>
                )}
              </span>
              {f.type === 'boolean'
                ? <input
                    type="checkbox"
                    checked={shown[f.key] === true}
                    onChange={(e) => { edit(f.key, e.target.checked) }}
                    style={{ width: '16px', height: '16px' }}
                  />
                : <input
                    type={f.type === 'secret' ? 'password' : 'text'}
                    value={f.type === 'secret' ? String(draft?.[f.key] ?? '') : asText(f)}
                    placeholder={f.placeholder ?? (f.type === 'secret' ? '输入新值（不回显）' : '')}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (f.type === 'number') edit(f.key, raw === '' ? 0 : Number(raw))
                      else edit(f.key, raw)
                    }}
                    style={inputStyle}
                  />}
              {f.hint !== undefined && <span style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' }}>{f.hint}</span>}
            </label>
          )
        })}
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            disabled={saving || draft === null}
            onClick={() => { void save() }}
            style={{
              padding: '6px 16px', borderRadius: '6px', font: 'inherit',
              border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)',
              color: 'var(--dsw-alias-label-primary-foreground)', cursor: draft === null ? 'default' : 'pointer',
              opacity: draft === null ? 0.6 : 1,
            }}
          >{saving ? '保存中…' : '保存'}</button>
          {draft !== null && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { setDraft(null); setMessage(null); setFailed(false) }}
              style={{ padding: '6px 16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'transparent', font: 'inherit', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}
            >放弃更改</button>
          )}
          {message !== null && <span style={{ fontSize: '12px', color: failed ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-secondary)' }}>{message}</span>}
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: '10px',
  padding: '14px 16px',
  background: 'var(--dsw-alias-bg-layer-3)',
  font: '13px/1.5 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
  color: 'var(--dsw-alias-label-primary)',
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
  background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
}
