import appConfig from './appConfig.js'
import {setLeaderUrl} from './appState.js'
import {broadcastNewLeader} from './socket/captainSocketServerManager.js'

/**
 *
 * Simple console logger with sentry integration for errors alone
 *
 * @class Logger
 */
class Logger {
  /**
   * Logs message with priority 'debug' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  debug(message: any, ...params: any[]) {
    if (appConfig.DEBUG) {
      console.log(message, ...params)
    }
  }

  /**
   * Logs message with priority 'info' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  info(message: any, ...params: any[]) {
    console.log(message, ...params)
  }

  /**
   * Logs message with priority 'warn' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  warn(message: any, ...params: any[]) {
    console.warn(message, ...params)
  }

  /**
   * Logs message with priority 'error' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  error(message: any, ...params: any[]) {
    console.error(message, ...params)
  }
}

export const logger = new Logger()

export function checkAndPromoteToLeader() {
  if (appConfig.MEMBER_URLS[0] === appConfig.SELF_URL) {
    logger.info('checkAndPromoteToLeader', 'I AM LEADER')
    setLeaderUrl(appConfig.SELF_URL)
    broadcastNewLeader(appConfig.SELF_URL)
  }
}

/*
 * Helps avoid race-condition.
 * Uses 100ms intervals to check for released lock
 */
export class CustomRaceConditionLock {
  lockedKeys: any

  // Max wait time before error out, obtaining lock
  static lockWaitTimeoutDuration = 30000 // 30 seconds

  // min-lock-hold-guarantee after which, any cleanup task may release the lock.
  static minLockHoldGuarantee = 1000 * 60 * 15 // 15 minute

  // Cleanup timer
  static cleanUpHandlerInterval = 1000 * 60 * 15 // 15 minute

  static failedToObtainLockErrMsg = 'Failed to obtain lock within the timeout period.'

  constructor() {
    // Using hash of lock-key vs grant-time to facilitate cleanup
    this.lockedKeys = {}

    // Clean up long locks.
    // Honors only min-lock-hold-guarantee.
    // Doesn't offer any other guarantees. Keeping it simple.
    setInterval(async () => {
      logger.info(`CustomRaceConditionLock: Cleanup locks`)
      for (const eachKey of Object.keys(this.lockedKeys)) {
        const lockHoldTime = Date.now() - this.lockedKeys[eachKey]
        if (lockHoldTime > CustomRaceConditionLock.minLockHoldGuarantee) {
          logger.warn(`CustomRaceConditionLock: Lock cleaned up for key: ${eachKey}`)
          delete this.lockedKeys[eachKey]
        }
      }
    }, CustomRaceConditionLock.cleanUpHandlerInterval)
  }

  async getLock(key: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      const checkLock = () => {
        if (!this.lockedKeys[key]) {
          this.lockedKeys[key] = Date.now()
          const lockInstance = [key, this.lockedKeys[key]]
          logger.debug(`CustomRaceConditionLock: Lock obtained for key: ${key}`)
          resolve(lockInstance) // return tuple of key and lock-obtained-time
        } else {
          const elapsedTime = Date.now() - startTime
          if (elapsedTime < CustomRaceConditionLock.lockWaitTimeoutDuration) {
            setTimeout(checkLock, 100)
          } else {
            reject(new Error(CustomRaceConditionLock.failedToObtainLockErrMsg))
          }
        }
      }
      checkLock()
    })
  }

  releaseLock(lockInstance: any[] | undefined) {
    logger.debug('releaseLock', lockInstance)
    if (lockInstance) {
      const [key, lockTime] = lockInstance
      if (this.lockedKeys[key] === lockTime) {
        delete this.lockedKeys[key]
        logger.debug(`CustomRaceConditionLock: Lock released for key: ${key}`)
      } else {
        logger.warn(`CustomRaceConditionLock: Trying to release a lock that is not held: [${lockInstance}]`)
      }
    }
  }
}

export const raceConditionHandler = new CustomRaceConditionLock()
