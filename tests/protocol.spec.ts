import { describe, expect, it } from 'vitest'
import { LineDecoder } from '../src/protocol.ts'
import { isConfigured, normalizeMediaType, resolveConfig, type Config } from '../src/config.ts'

const base: Config = {
  appid: 'app',
  secret: 's3cret',
  secretEnv: '',
  pythonPath: 'python3',
  botScript: '/bot.py',
  stateDir: '/tmp/state',
  mediaDir: '/tmp/media',
  cwdRoot: '/tmp/ws',
  provider: 'p',
  model: 'm',
  maxTokens: 0,
  markdown: true,
  ack: '',
}

describe('LineDecoder', () => {
  it('splits partial chunks into complete lines', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('{"a":1}\n{"b":')).toEqual(['{"a":1}'])
    expect(decoder.push('2}\n')).toEqual(['{"b":2}'])
  })

  it('ignores blank lines', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('\n\n{"x":1}\n\n')).toEqual(['{"x":1}'])
  })
})

describe('normalizeMediaType', () => {
  it('normalizes jpg to jpeg and rejects non-images', () => {
    expect(normalizeMediaType('image/jpg')).toBe('image/jpeg')
    expect(normalizeMediaType('image/png')).toBe('image/png')
    expect(normalizeMediaType('text/plain')).toBeUndefined()
  })
})

describe('resolveConfig', () => {
  it('keeps an inline secret and an explicit botScript', () => {
    const resolved = resolveConfig(base)
    expect(resolved.secret).toBe('s3cret')
    expect(resolved.botScript).toBe('/bot.py')
    expect(isConfigured(resolved)).toBe(true)
  })

  it('reads the secret from the environment when secretEnv is set', () => {
    const previous = process.env.MY_SECRET
    process.env.MY_SECRET = 'env-secret'
    try {
      const resolved = resolveConfig({ ...base, secret: '', secretEnv: 'MY_SECRET' })
      expect(resolved.secret).toBe('env-secret')
    } finally {
      if (previous === undefined) delete process.env.MY_SECRET
      else process.env.MY_SECRET = previous
    }
  })

  it('is unconfigured without an appid or a resolvable secret', () => {
    expect(isConfigured(resolveConfig({ ...base, secret: '', secretEnv: '' }))).toBe(false)
  })
})
