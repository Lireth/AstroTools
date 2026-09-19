import { type ChildProcess, spawn } from 'node:child_process'
import type { DevServerState, ProjectInfo } from '../../shared/types'

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?/
const LOG_LIMIT = 4000

export type StateListener = (state: DevServerState) => void

/**
 * Astro dev server 子进程管理器（每应用一个实例，切换项目时先停止旧进程）。
 * 通过解析 stdout 中的 Local 地址得到预览 URL；状态变化经监听器推送给渲染进程。
 */
export class DevServerManager {
  private proc: ChildProcess | null = null
  private state: DevServerState = { status: 'idle' }
  private stoppedByUs = false

  constructor(private readonly listener: StateListener) {}

  getState(): DevServerState {
    return this.state
  }

  private emit(partial: Partial<DevServerState>): void {
    this.state = { ...this.state, ...partial }
    this.listener(this.state)
  }

  async start(root: string, packageManager: ProjectInfo['packageManager']): Promise<void> {
    if (this.state.status === 'starting' || this.state.status === 'running') return

    this.stoppedByUs = false
    this.emit({ status: 'starting', url: undefined, message: '正在启动 Astro 开发服务器…' })

    const cmd = packageManager === 'unknown' ? 'npm' : packageManager
    try {
      this.proc = spawn(cmd, ['run', 'dev'], {
        cwd: root,
        shell: true,
        // Windows 上 detached 会让子进程脱离父进程的 stdio 管道，导致收不到输出；
        // 进程树终止用 taskkill /T 即可，POSIX 才需要 detached 进程组
        detached: process.platform !== 'win32',
        env: { ...process.env, FORCE_COLOR: '0' }
      })
    } catch (err) {
      this.emit({ status: 'error', message: `启动失败: ${String(err)}` })
      return
    }

    const pid = this.proc.pid
    this.emit({ status: 'starting', pid, message: `进程 ${pid ?? '?'} 已启动，等待 Astro 就绪…` })

    let log = ''
    const onChunk = (chunk: Buffer | string): void => {
      const text = String(chunk)
      log = (log + text).slice(-LOG_LIMIT)
      if (this.state.status === 'starting') {
        const found = log.match(URL_RE)
        if (found) {
          this.emit({
            status: 'running',
            url: found[0],
            message: `开发服务器已就绪：${found[0]}`
          })
        }
      }
    }
    this.proc.stdout?.on('data', onChunk)
    this.proc.stderr?.on('data', onChunk)

    // 启动期间周期性把日志尾部推给界面，用户能看到启动进展
    const startLogTimer = setInterval(() => {
      if (this.state.status !== 'starting') {
        clearInterval(startLogTimer)
        return
      }
      const tail = log.trim().slice(-500)
      this.emit({
        status: 'starting',
        message: tail ? `等待 Astro 就绪…\n${tail}` : `进程 ${pid ?? '?'} 已启动，等待 Astro 就绪…`
      })
    }, 1500)

    this.proc.on('error', (err) => {
      if (!this.stoppedByUs) this.emit({ status: 'error', message: `进程错误: ${err.message}` })
    })
    this.proc.on('exit', (code) => {
      this.proc = null
      if (this.stoppedByUs) {
        this.emit({ status: 'idle', pid: undefined, url: undefined, message: '开发服务器已停止' })
      } else {
        this.emit({
          status: code === 0 ? 'idle' : 'error',
          pid: undefined,
          url: undefined,
          message: code === 0 ? '开发服务器已退出' : `开发服务器异常退出（退出码 ${code}）\n${log.slice(-800)}`
        })
      }
    })
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc || proc.pid === undefined) {
      this.emit({ status: 'idle' })
      return
    }
    this.stoppedByUs = true
    this.emit({ status: 'stopping', message: '正在停止开发服务器…' })
    await killTree(proc.pid)
  }
}

/** 跨平台结束整个进程树（Windows 上 shell:true 产生 cmd → node 链） */
function killTree(pid: number): Promise<void> {
  return new Promise((resolveP) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false })
      killer.on('close', () => resolveP())
      killer.on('error', () => resolveP())
      // 兜底：即便 taskkill 失败也继续
      setTimeout(() => resolveP(), 5000).unref()
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // 进程可能已退出
        }
      }
      resolveP()
    }
  })
}
