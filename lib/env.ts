/**
 * Central typed access to a few env values used in more than one place.
 * ANTHROPIC_MODEL default: the platform doc (Section 1) still lists a stale id;
 * this defaults to the current Sonnet and is overridable per environment.
 */
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
