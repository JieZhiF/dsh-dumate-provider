/** Small filesystem and value helpers shared by the host half. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Read and parse a JSON file; any failure (missing, unreadable, malformed) yields `fallback`. */
export async function readJsonFile(path, fallback) {
  try {
    const text = await readFile(path, 'utf8')
    const value = JSON.parse(text)
    return value === null || typeof value !== 'object' ? fallback : value
  } catch {
    return fallback
  }
}

/**
 * Replace a JSON file atomically.
 *
 * The sibling temp file plus rename is what keeps a crash mid-write from
 * leaving a truncated state file that the next boot would read as "no
 * accounts". Mode 0600: the file carries session cookies.
 */
export async function writeJsonAtomic(path, value, { mode = 0o600 } = {}) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`
  const text = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temp, text, { mode })
  await rename(temp, path)
}

/** Clamp a number into [min, max], substituting `fallback` for a non-finite input. */
export function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** A positive integer, or `fallback`. */
export function positiveInt(value, fallback) {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** `HH:MM` in 24-hour form, or undefined. */
export function parseClock(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return { hour, minute }
}

/** `YYYY-MM-DD` for one instant in Beijing time. */
export function beijingDate(at = Date.now()) {
  const shifted = new Date(at + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

/** Minutes since Beijing midnight for one instant. */
export function beijingMinutes(at = Date.now()) {
  const shifted = new Date(at + 8 * 60 * 60 * 1000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** Keep the last `limit` entries of an array. */
export function tail(list, limit) {
  return list.length <= limit ? list : list.slice(list.length - limit)
}

/** Human-readable error text that never leaks a stack. */
export function messageOf(error) {
  if (error === null || error === undefined) return 'unknown error'
  const message = typeof error === 'string' ? error : error.message
  return typeof message === 'string' && message !== '' ? message : String(error)
}
