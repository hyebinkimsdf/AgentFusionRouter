// `agent-fusion-router codex`: a Codex thread whose turns go through the
// router. It starts `codex app-server` and speaks to it directly, so only the
// turns typed here are routed, never the Codex app's own.

import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import type { CodexSession, ServerRequest, SessionEvent, SessionInfo, TurnResult } from '@agent-fusion-router/codex-adapter'
import { RUNNER_POLICY, defaultRunLogDir, findCodexBin, openSession, runLog, spawnAppServer } from '@agent-fusion-router/codex-adapter'
import type { RoutePolicy } from '@agent-fusion-router/core'

export const CODEX_USAGE = `Codex through the router
  codex [prompt]        A Codex thread whose turns go through the router: the same rules as the
                        Claude Code plugin choose each turn's effort or model. Only turns typed
                        here are routed, never the Codex app's own. Type /exit to leave.
    --mode <m>            observe (default: record the choice, change nothing) or route
    --strategy <s>        effort (default: keep your model, change effort) or model
    --standard-model <m>  With --strategy model: send ordinary work to this model (default: yours)
    --model <id>          Your model for this thread (default: Codex's configured one)
    --effort <level>      Your effort for this thread (default: Codex's configured one)
    --cwd <dir>           The workspace (default: the current folder)
    --once                Run the prompt given, then exit
    --codex <path>        The codex executable (default CODEX_BIN, codex, or the VS Code extension's)
    --log-dir <dir>       Where the router's records go (default ~/.agent-fusion-router/codex-logs)`

const compact = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`)

const setting = (s: { model: string; effort?: string }): string => `${s.model}${s.effort === undefined ? '' : ` ${s.effort}`}`

export const describeSession = (info: SessionInfo, policy: RoutePolicy, logDir: string): string[] => {
  const account =
    info.account?.type === 'chatgpt'
      ? `Signed in with ChatGPT${info.account.planType ? ` (${info.account.planType})` : ''}: turns draw on the plan's limits, not per-token billing.`
      : info.account?.type === 'apiKey'
        ? 'Signed in with an API key: every turn is billed per token.'
        : `Signed in as ${info.account?.type ?? 'unknown'}.`
  const window = (w: { usedPercent: number; windowDurationMins?: number } | undefined, name: string) => (w === undefined ? [] : [`${w.usedPercent}% of the ${name}`])
  const used = [...window(info.limits?.primary, '5-hour window'), ...window(info.limits?.secondary, 'week')]
  const full = [info.limits?.primary, info.limits?.secondary].some(w => (w?.usedPercent ?? 0) >= 90)

  return [
    `Codex thread ${info.threadId} · yours: ${setting(info.baseline)} · router: ${policy.mode}, ${policy.strategy}`,
    account,
    ...(used.length === 0 ? [] : [`Plan limits used: ${used.join(', ')}.${full ? ' Close to a limit: turns may stop.' : ''}`]),
    `Records: ${logDir}`,
  ]
}

export const describeTurn = (result: TurnResult, policy: RoutePolicy): string => {
  const { plan, ran, requests } = result
  const input = requests.reduce((n, r) => n + r.input, 0)
  const cached = requests.reduce((n, r) => n + r.cachedInput, 0)
  const output = requests.reduce((n, r) => n + r.output, 0)
  const how =
    policy.mode === 'route'
      ? `ran ${setting(ran)}${plan.send.model === undefined && plan.send.effort === undefined ? '' : ' (set this turn)'}`
      : `would use ${setting(plan.target)}, ran ${setting(ran)}`

  return `[${plan.tier} · ${how} · ${requests.length} request${requests.length === 1 ? '' : 's'} · ${compact(input)} input (${compact(cached)} cached) · ${compact(output)} output · ${result.status}]`
}

export const codexRun = async (args: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mode: { type: 'string', default: 'observe' },
      strategy: { type: 'string', default: 'effort' },
      'standard-model': { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      cwd: { type: 'string' },
      once: { type: 'boolean' },
      codex: { type: 'string' },
      'log-dir': { type: 'string' },
    },
  })
  if (values.mode !== 'observe' && values.mode !== 'route') throw new Error('--mode is observe or route')
  if (values.strategy !== 'effort' && values.strategy !== 'model') throw new Error('--strategy is effort or model')
  const bin = values.codex ?? findCodexBin()
  if (bin === undefined) throw new Error('No codex executable found: install Codex, set CODEX_BIN, or pass --codex <path>.')

  const policy: RoutePolicy = {
    ...RUNNER_POLICY,
    mode: values.mode,
    strategy: values.strategy,
    ...(values['standard-model'] === undefined ? {} : { tiers: { ...RUNNER_POLICY.tiers, standard: { model: values['standard-model'] } } }),
  }
  const logDir = values['log-dir'] === undefined ? defaultRunLogDir() : resolve(values['log-dir'])
  const interactive = process.stdin.isTTY === true

  // One reader for prompts and approval answers, so an answer never becomes the next prompt.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive })
  const queued: string[] = []
  let question: ((line: string) => void) | undefined
  let wake: (() => void) | undefined
  let ended = false
  rl.on('line', line => {
    if (question !== undefined) {
      const answer = question
      question = undefined
      answer(line.trim())
      return
    }
    queued.push(line)
    wake?.()
  })
  rl.on('close', () => {
    ended = true
    question?.('')
    wake?.()
  })
  const nextLine = async (): Promise<string | undefined> => {
    while (queued.length === 0 && !ended) await new Promise<void>(r => (wake = r))
    wake = undefined
    return queued.shift()
  }
  const ask = (text: string): Promise<string> =>
    new Promise(r => {
      process.stdout.write(text)
      question = r
    })

  const answer = async (r: ServerRequest): Promise<unknown> => {
    const p = r.params ?? {}
    const what =
      r.method === 'item/commandExecution/requestApproval'
        ? `Run \`${typeof p.command === 'string' ? p.command : 'a command'}\``
        : r.method === 'item/fileChange/requestApproval'
          ? `Apply file changes${typeof p.reason === 'string' ? ` (${p.reason})` : ''}`
          : undefined
    if (what === undefined) throw new Error(`${r.method} is not handled by this runner`)
    if (!interactive) {
      console.log(`\n${what}? Declined: no terminal to ask.`)
      return { decision: 'decline' }
    }
    const reply = (await ask(`\n${what}? [y]es, [a]lways this session, [N]o: `)).toLowerCase()
    return { decision: reply === 'y' || reply === 'yes' ? 'accept' : reply === 'a' ? 'acceptForSession' : 'decline' }
  }

  const { server, stop, stderr } = spawnAppServer(bin, answer)
  const onEvent = (e: SessionEvent): void => {
    if (e.type === 'text') process.stdout.write(e.delta)
    else if (e.type === 'command') console.log(`\n$ ${e.command} → exit ${e.exitCode ?? '?'}${e.verification ? ' (verification)' : ''}`)
    else console.log(`\nCodex rerouted ${e.from} to ${e.to}.`)
  }

  let session: CodexSession
  try {
    session = await openSession(server, {
      cwd: values.cwd === undefined ? process.cwd() : resolve(values.cwd),
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.effort === undefined ? {} : { effort: values.effort }),
      policy,
      log: runLog(logDir),
      onEvent,
    })
  } catch (error) {
    rl.close()
    stop()
    throw new Error(`Codex app-server did not start a thread: ${error instanceof Error ? error.message : String(error)}\n${stderr()}`)
  }
  for (const line of describeSession(session.info, policy, logDir)) console.log(line)

  // Ctrl+C stops the running turn; with none running, it leaves.
  let running = false
  rl.on('SIGINT', () => {
    if (running) void session.interrupt()
    else rl.close()
  })

  const turn = async (prompt: string): Promise<void> => {
    running = true
    try {
      const result = await session.runTurn(prompt)
      console.log(`\n${describeTurn(result, policy)}`)
    } catch (error) {
      console.log(`\nThe turn failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
    }
  }

  try {
    if (positionals.length > 0) await turn(positionals.join(' '))
    while (!values.once) {
      if (interactive) process.stdout.write('\ncodex> ')
      const line = await nextLine()
      if (line === undefined || line.trim() === '/exit') break
      if (line.trim() !== '') await turn(line.trim())
    }
  } finally {
    rl.close()
    stop()
  }
}
