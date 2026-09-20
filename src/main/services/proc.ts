import { spawn } from 'node:child_process'

/** 跨平台结束整个进程树（Windows 上 shell:true 产生 cmd → node 链） */
export function killTree(pid: number): Promise<void> {
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
