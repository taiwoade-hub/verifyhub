// VerifyHub — .verifyhub.yml configuration parsing and merging.

import YAML from 'yaml'
import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_CONFIG, type VerifyHubConfig } from './types'

export function parseConfig(raw: string | null | undefined): VerifyHubConfig {
  if (!raw || !raw.trim()) return structuredClone(DEFAULT_CONFIG)
  try {
    const parsed = YAML.parse(raw)
    if (!parsed || typeof parsed !== 'object') return structuredClone(DEFAULT_CONFIG)
    return mergeConfig(DEFAULT_CONFIG, parsed as Partial<VerifyHubConfig>)
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

export function mergeConfig(base: VerifyHubConfig, override: Partial<VerifyHubConfig>): VerifyHubConfig {
  return {
    name: override.name ?? base.name,
    runtime: { ...base.runtime, ...override.runtime },
    verification: {
      ...base.verification,
      ...override.verification,
      instructions: override.verification?.instructions ?? base.verification?.instructions,
    },
    notifications: { ...base.notifications, ...override.notifications },
    schedule: { ...base.schedule, ...override.schedule },
  }
}

export function readConfigFromDisk(projectRoot: string): { raw: string | null; config: VerifyHubConfig; path: string } {
  const p = path.join(projectRoot, '.verifyhub.yml')
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      return { raw, config: parseConfig(raw), path: '.verifyhub.yml' }
    }
  } catch {
    /* ignore */
  }
  return { raw: null, config: structuredClone(DEFAULT_CONFIG), path: '.verifyhub.yml' }
}

export function serializeConfig(config: VerifyHubConfig): string {
  return YAML.stringify(config)
}

export const SAMPLE_CONFIG_YML = `name: my-project

runtime:
  type: auto

verification:
  engine: kane
  url: auto
  instructions:
    - Open homepage
    - Test navigation
    - Test login
    - Test logout

notifications:
  telegram: false

schedule:
  enabled: false
`
