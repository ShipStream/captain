import console from 'console'
import appConfig from './appConfig.js'
import { initializeDnsManager } from './dns/dnsManager.js'
import appState from './appState.js'
import webServiceHelper from './web-service/webServiceHelper.js'

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
    // if (appConfig.DEBUG) {
    console.log(message, ...params)
    // }
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

console.log('appConfig.NODE_ENV:', appConfig.NODE_ENV)
export const logger = appConfig.NODE_ENV === 'test' ? console : new Logger()

export function checkAndPromoteToLeader() {
  console.info('checkAndPromoteToLeader', {
    'appConfig.MEMBER_URLS[0]': appConfig.MEMBER_URLS[0],
    'appConfig.SELF_URL': appConfig.SELF_URL,
  })
  if (appConfig.MEMBER_URLS[0] === appConfig.SELF_URL) {
    logger.info('checkAndPromoteToLeader', 'I AM LEADER')
    appState.setLeaderUrl(appConfig.SELF_URL)
    appState.getSocketManager().broadcastNewLeader(appConfig.SELF_URL)
  }
}

export async function initializeAppModules() {
  await appState.registerRaceHandler()
  await appState.registerCaptainSocketServer(appConfig.CAPTAIN_PORT, {
    /* options */
  })  
  checkAndPromoteToLeader()
  await initializeDnsManager() // Depends on 'checkAndPromoteToLeader'
  await webServiceHelper.processWebServiceFileYAML()
  await appState.connectWithOtherCaptains(
    appConfig.MEMBER_URLS.filter((eachMember: string) => eachMember !== appConfig.SELF_URL)
  )
}


/**
 * Reload app on sighup. Also used for reload app between tests
 *
 */
export async function softReloadApp() {
  // processWebServiceFileYAML()
  await appState.resetAppState({ resetSockets: true, resetWebApps: true, resetLockHandlers: true })
  await initializeAppModules()
}

/*
 * Helps avoid race-condition.
 * Uses 100ms intervals to check for released lock
 */
export class CustomRaceConditionLock {
  _deleted = false
  _cleanLocksReference?: any
  lockedKeys: any

  // Max wait time before error out, obtaining lock
  static lockWaitTimeoutDuration = 30000 // 30 seconds

  // min-lock-hold-guarantee after which, any cleanup task may release the lock.
  static minLockHoldGuarantee = 1000 * 60 * 15 // 15 minute

  // Cleanup timer
  static cleanUpHandlerInterval = 1000 * 60 * 15 // 15 minute

  static failedToObtainLockErrMsg = 'Failed to obtain lock within the timeout period.'
  static lockObsolete = 'Failed to obtain lock as lock obsolete due to soft reload of the app.'

  constructor() {
    // Using hash of lock-key vs grant-time to facilitate cleanup
    this.lockedKeys = {}

    // Clean up long locks.
    // Honors only min-lock-hold-guarantee.
    // Doesn't offer any other guarantees. Keeping it simple.
    this._cleanLocksReference = setInterval(async () => {
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
        if (this._deleted) {
          return reject(new Error(CustomRaceConditionLock.lockObsolete))
        }
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

  cleanUpForDeletion() {
    this._deleted = true
    if (this._cleanLocksReference) {
      clearInterval(this._cleanLocksReference)
    }
  }
}
