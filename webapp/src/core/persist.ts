import { useEffect, useRef } from 'react'

/**
 * localStorage 的一层薄封装。
 *
 * 直接用 localStorage 有三个坑，这里一次性堵上：
 *
 *  1. **它会抛异常**。隐私模式、禁用 Cookie、iframe 的第三方存储限制下，
 *     连 `localStorage` 这个属性本身都可能抛。所以先探一次可用性。
 *  2. **写入是同步的**。拖动边界时 model 每一帧都是新对象，逐帧序列化十万字符
 *     会把拖拽拖成幻灯片。所以写入统一走防抖。
 *  3. **存进去的东西会过时**。上一版程序留下的结构，这一版未必认得。
 *     所以读出来一律当作不可信输入，交给调用方校验。
 */

const available = (() => {
  try {
    const probe = '__fct_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
})()

/** 本地存储是否可用。不可用时所有读写都是空操作，功能照常，只是不留痕 */
export const storageAvailable = available

/** 读一条。取不到、坏掉、解析失败一律返回 null——调用方自己兜底 */
export function readStore<T = unknown>(key: string): T | null {
  if (!available) return null
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

/**
 * 写一条。`null` / `undefined` 表示删除这一条。
 * 返回是否写成功——超配额时返回 false，调用方可以据此降级提示。
 */
export function writeStore(key: string, value: unknown): boolean {
  if (!available) return false
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // 多半是 QuotaExceededError
    return false
  }
}

/**
 * 把 value 防抖写进 localStorage。
 *
 * value 每次渲染都是新对象也没关系：防抖窗口会一路顺延，等它稳定下来才落盘。
 * 另外在页面隐藏（切标签页、关页、刷新）时补一次立即写入——
 * 否则「改完马上按 F5」正好落在防抖窗口里，改动就白做了。
 */
export function usePersist(key: string, value: unknown, delay = 400): void {
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    const timer = setTimeout(() => writeStore(key, latest.current), delay)
    return () => clearTimeout(timer)
  }, [key, value, delay])

  useEffect(() => {
    const flush = () => writeStore(key, latest.current)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [key])
}
