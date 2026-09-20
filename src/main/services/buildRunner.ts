import { type ChildProcess, spawn } from 'node:child_process'
import type { BuildState, ProjectInfo } from '../../shared/types'
import { killTree } from './proc'

const LOG_LIMIT = 8000

export type BuildStateListener = (state: BuildState) => void

/**
 * astro build 子进程管理器（同一时刻只允许一个构建）。
 * 状态变化经监听器推送给渲染进程；事件回调均以进程引用守卫，与 DevServerManager 同构。
 */
export class BuildRunner {
  private proc: ChildProcess | null = null
  private state: BuildState = { status: 'idle' }

  constructor(private readonly listener: BuildStateListener) {}

  getState(): BuildState {
    return this.state
  }

  private emit(partial: Partial<BuildState>): void {
    this.state = { ...this.state, ...partial }
    this.listener(this.state)
  }

  start(root: string, packageManager: ProjectInfo['packageManager']): void {
    if (this.state.status === 'building') return

    const cmd = packageManager === 'unknown' ? 'npm' : packageManager
    let proc: ChildProcess
    try {
      proc = spawn(cmd, ['run', 'build'], {
        cwd: root,
        shell: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, FORCE_COLOR: '0' }
      })
    } catch (err) {
      this.emit({ status: 'error', message: `构建启动失败: ${String(err)}` })
      return
    }
    this.proc = proc
    const startedAt = Date.now()
    this.emit({ status: 'building', message: '正在执行 astro build…' })

    let log = ''
    const onChunk = (chunk: Buffer | string): void => {
      if (this.proc !== proc) return
      log = (log + String(chunk)).slice(-LOG_LIMIT)
    }
    proc.stdout?.on('data', onChunk)
    proc.stderr?.on('data', onChunk)

    proc.on('error', (err) => {
      if (this.proc !== proc) return
      this.emit({ status: 'error', message: `构建进程错误: ${err.message}` })
    })
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      // 已被用户取消（stop 先置 idle）则不覆盖状态
      if (this.state.status !== 'building') return
      const durationMs = Date.now() - startedAt
      if (code === 0) {
        this.emit({
          status: 'done',
          durationMs,
          message: `构建完成（${Math.round(durationMs / 1000)} 秒）\n${log.slice(-600)}`
        })
      } else {
        this.emit({ status: 'error', message: `构建失败（退出码 ${code}）\n${log.slice(-1200)}` })
      }
    })
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc || proc.pid === undefined) {
      this.emit({ status: 'idle' })
      return
    }
    this.emit({ status: 'idle', message: '构建已取消' })
    await killTree(proc.pid)
  }
}
