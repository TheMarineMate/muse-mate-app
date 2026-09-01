import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from './env'

/**
 * Section 11 — the Anthropic key is server-side only. This module must never be
 * imported from a client component.
 */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
}

export { ANTHROPIC_MODEL }
