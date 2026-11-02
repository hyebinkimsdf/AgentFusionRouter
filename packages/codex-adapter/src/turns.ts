// The router's analysis of each turn's prompt. The prompt is read here and
// nowhere else, and only the analysis leaves: its tier, kind, confidence and
// signal names, never the text.

import type { Analysis } from '@agent-fusion-router/core'
import { analyzeTask } from '@agent-fusion-router/core'

/** The line Codex's IDE extension writes before the person's own words, after the open tabs and pasted files. */
const IDE_REQUEST = /^## My request:[^\S\n]*$/m
const IDE_CONTEXT = /^# Context from my IDE setup:/

/**
 * What the person typed, without the IDE context Codex's extension puts in
 * front of it (open tabs, pasted files). A message without that context is
 * taken whole.
 */
export const requestText = (message: string): string => {
  if (!IDE_CONTEXT.test(message)) return message

  const marker = IDE_REQUEST.exec(message)
  return marker === null ? message : message.slice(marker.index + marker[0].length).trim()
}

/** Context Codex adds as a user message of its own (`<environment_context>`, `<external_codex_apps_open_page>`): not the person's words. */
const INJECTED = /^\s*<[a-z_]+>/

/** The text of a `response_item` user message, without the context blocks Codex injects. */
const itemText = (content: unknown): string =>
  (Array.isArray(content) ? (content as { type?: unknown; text?: unknown }[]) : [])
    .filter(c => c.type === 'input_text' && typeof c.text === 'string' && !INJECTED.test(c.text))
    .map(c => c.text as string)
    .join('\n')

/**
 * Each turn's analysis, by turn id, from the first prompt the person sent in
 * it: the router decides once, as a turn starts. The prompt is the turn's
 * `user_message` event. Some turns have none (seen on Codex 0.164 and 0.165)
 * and carry the prompt only as a user `response_item`, which is used then.
 */
export const analyzeTurns = (text: string): Map<string, Analysis> => {
  const prompts = new Map<string, { event?: string; item?: string }>()
  let turnId: string | undefined

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let json: { type?: unknown; payload?: Record<string, unknown> }
    try {
      json = JSON.parse(line) as typeof json
    } catch {
      continue
    }
    const p = json.payload ?? {}

    if ((json.type === 'turn_context' || (json.type === 'event_msg' && p.type === 'task_started')) && typeof p.turn_id === 'string') {
      turnId = p.turn_id
      continue
    }
    if (turnId === undefined) continue

    const prompt = prompts.get(turnId) ?? {}
    if (json.type === 'event_msg' && p.type === 'user_message' && prompt.event === undefined) {
      prompt.event = typeof p.message === 'string' ? p.message : ''
    } else if (json.type === 'response_item' && p.type === 'message' && p.role === 'user' && prompt.item === undefined) {
      const words = itemText(p.content)
      if (words.trim() !== '') prompt.item = words
    }
    prompts.set(turnId, prompt)
  }

  const analyses = new Map<string, Analysis>()
  for (const [id, prompt] of prompts) {
    const words = prompt.event ?? prompt.item
    if (words !== undefined) analyses.set(id, analyzeTask(requestText(words)))
  }

  return analyses
}
