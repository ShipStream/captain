import console from 'console'
import appConfig from './appConfig.js'
import {initializeDnsManager} from './dns/dnsManager.js'
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
    // console.log(message, ...params)
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

export function isHAMode() {
  if (appConfig.CONSUL_HTTP_ADDR) {
    logger.warn('isHAMode=true')
    return true
  }
  logger.warn('isHAMode=false')
  return false
}

export async function checkAndPromoteToLeader() {
  logger.info('checkAndPromoteToLeader', {
    'appConfig.MEMBER_URLS': appConfig.MEMBER_URLS,
    'appConfig.SELF_URL': appConfig.SELF_URL,
  })
  if (appConfig.MEMBER_URLS[0] === appConfig.SELF_URL) {
    promoteThisCaptainToLeader()
  }
}

/**
 *  Promoting to leadership needs to do a lot of checks again to avoid any loose ends like things happenning,
 *  when no there is a long delay in leadership election or delay in leader transition
 *  a). sync 'active' addresses of web-service and 'resolved' address of dns-provider
 *  b). transmit active addresses and new leader
 *  c). call checkCombinedPeerStateAndInitiateRemoveActiveIP and checkCombinedPeerStateAndInitiateAddActiveIP,
 *  which takes action on rising and falling ips again and ensures things are in order
 *
 */
export async function promoteThisCaptainToLeader() {
  logger.info('promoteThisCaptainToLeader', 'I AM LEADER', appConfig.SELF_URL)
  appState.setLeaderUrl(appConfig.SELF_URL)
  // a). Leader needs to handle dns queries, so initialize the system if leader.
  logger.info('promoteThisCaptainToLeader', 'initializeDnsManager')
  await initializeDnsManager()
  logger.info('promoteThisCaptainToLeader', 'broadcastNewLeader')
  appState.getSocketManager().broadcastNewLeader(appConfig.SELF_URL)
  // b). Leader needs to do ensure initial zone records are set for the service
  logger.info('promoteThisCaptainToLeader', 'syncResolvedAddresses')
  const syncResolvedAddressesPromises: Promise<any>[] = []
  for (const webServiceKey of Object.keys(appState.webServices)) {
    // health and failover stats are maintained only by the leader
    //TODO verify that things can be initialized on every leader elected
    // (OR) needs to broadcast these stats too and mintain it on all peers so that need not be initialized on being elected
    // Potentially, could retrigger failover and notification again in the new leader too.
    appState.webServices[webServiceKey]!.initializeHealthAndFailoverStats()
    syncResolvedAddressesPromises.push(appState.webServices[webServiceKey]!.initialResolvedAndActiveAddressSync())
  }
  await Promise.all(syncResolvedAddressesPromises)
  // Already done inside 'handleActiveAddressChange' for each webservice !!
  // c). Depends on completion of point b) above Leader only manages active addresses and hence it needs to communicate that
  // appState.getSocketManager().broadcastBulkActiveAddresses()

  // d).If the leader election were delayed, some of the rise/fall could have been missed ( as only leader process them ).
  // So re-process every rise and falls now
  logger.info('promoteThisCaptainToLeader', 'reprocessRiseAndFalls')
  const reprocessRiseAndFallPromises: Promise<any>[] = []
  for (const webServiceKey of Object.keys(appState.webServices)) {
    reprocessRiseAndFallPromises.push(appState.webServices[webServiceKey]!.reprocessAllRiseAndFallsForIPs())
  }
  await Promise.all(reprocessRiseAndFallPromises)
}

export async function markGivenRemoteCaptainAsLeader(remoteLeaderURL: string) {
  logger.info('makeThisCaptainAFollower', {
    'appConfig.MEMBER_URLS': appConfig.MEMBER_URLS,
    remoteLeaderURL: remoteLeaderURL,
  })
  logger.info('makeThisCaptainAFollower', 'I AM FOLLOWER')
  appState.setLeaderUrl(remoteLeaderURL)
}

export async function initializeAppModules() {
  await appState.registerRaceHandler()
  await appState.registerNotificationService()
  await appState.registerCaptainSocketServer(appConfig.CAPTAIN_PORT, {
    /* options */
  })
  await webServiceHelper.processWebServiceFileYAML()
  await appState.connectWithOtherCaptains(
    appConfig.MEMBER_URLS.filter((eachMember: string) => eachMember !== appConfig.SELF_URL)
  )
  // if HA mode, then consul agent running along-side each captain will decide the leader.
  if (isHAMode()) {
    await appState.registerConsulService()
  } else {
    // alternate leader election ( first URL is the captain )
    await checkAndPromoteToLeader()
  }
}

/**
 * Reload app on sighup. Also used for reload app between tests
 *
 */
export async function softReloadApp() {
  // processWebServiceFileYAML()
  await appState.resetAppState({resetSockets: false, resetWebApps: true, resetLockHandlers: false, resetLeaderShip: false})
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

const MAX_ALLOWED_RETRIES = 10
/**
 * Wrapper over node 'fetch' with retry handler
 */
export async function customFetch(
  logID: string,
  url: string,
  init?: RequestInit,
  retryOptions: {currentRetryAttempt: number; maxAllowedRetries: number} = {} as any
): Promise<any> {
  retryOptions = Object.assign(retryOptions || {}, {
    currentRetryAttempt: retryOptions?.currentRetryAttempt ?? 0,
    maxAllowedRetries: retryOptions?.maxAllowedRetries ?? MAX_ALLOWED_RETRIES,
  })
  try {
    const response = await fetch(url, init)
    if (response.ok) {
      const jsonResponse: any = await response.json()
      return jsonResponse
    }
    const responseText = await response.text()
    throw new Error(`${logID}: ${response.statusText}: ${responseText}`)
  } catch (e: any) {
    if (`${e?.cause?.code}` === 'UND_ERR_SOCKET' || `${e?.cause?.code}` === 'ECONNRESET') {
      // wait and retry network errors
      if (retryOptions.currentRetryAttempt < MAX_ALLOWED_RETRIES) {
        retryOptions.currentRetryAttempt += 1
        logger.warn(`${logID}: customFetch:currentRetryAttempt`, retryOptions.currentRetryAttempt)
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return customFetch(logID, url, init, retryOptions)
      }
    }
    throw e
  }
}
