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
    // What is considered a normal log for development/production can be little too much for testing,
    // due to constant tear down and initialization and the related logs.
    // So, in case of testing 'DEBUG' needs to be enabled even to see 'info' messages,
    // only 'warn'/'error' will be displayed by default when NODE_ENV is 'test'        
    if (appConfig.NODE_ENV === 'test') {
      this.debug(message, ...params)
    } else {
      console.log(message, ...params)
    }
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
export const logger = new Logger()

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
  logger.info('promoteThisCaptainToLeader', '###############################')
  logger.info('promoteThisCaptainToLeader', 'I AM LEADER', appConfig.SELF_URL)
  logger.info('promoteThisCaptainToLeader', '###############################')
  appState.setLeaderUrl(appConfig.SELF_URL)
  // a). Leader needs to handle dns queries, so initialize the system if leader.
  logger.info('promoteThisCaptainToLeader', 'initializeDnsManager')
  await initializeDnsManager()
  logger.info('promoteThisCaptainToLeader', 'broadcastNewLeader')
  appState.getSocketManager().broadcastNewLeader(appConfig.SELF_URL)
  // b). Leader needs to do ensure initial zone records are set for the service
  logger.info('promoteThisCaptainToLeader', 'syncResolvedAddresses')
  const syncResolvedAddressesPromises: Promise<any>[] = []
  const webServiceKeys = Object.keys(appState.getWebServices())
  for (const webServiceKey of webServiceKeys) {
    // health and failover stats are maintained only by the leader
    //TODO verify that things can be initialized on every leader elected
    // (OR) needs to broadcast these stats too and mintain it on all peers so that need not be initialized on being elected
    // Potentially, could retrigger failover and notification again in the new leader too.
    appState.getWebService(webServiceKey)!.initializeHealthAndFailoverStats()
    syncResolvedAddressesPromises.push(appState.getWebService(webServiceKey)!.initialResolvedAndActiveAddressSync())
  }
  await Promise.all(syncResolvedAddressesPromises)
  // Already done inside 'handleActiveAddressChange' for each webservice !!
  // c). Depends on completion of point b) above Leader only manages active addresses and hence it needs to communicate that
  // appState.getSocketManager().broadcastBulkActiveAddresses()

  // d).If the leader election were delayed, some of the rise/fall could have been missed ( as only leader process them ).
  // So re-process every rise and falls now
  logger.info('promoteThisCaptainToLeader', 'reprocessRiseAndFalls')
  const reprocessRiseAndFallPromises: Promise<any>[] = []
  for (const webServiceKey of Object.keys(appState.getWebServices())) {
    reprocessRiseAndFallPromises.push(appState.getWebService(webServiceKey)!.reprocessAllRiseAndFallsForIPs())
  }
  await Promise.all(reprocessRiseAndFallPromises)
}

export async function markGivenRemoteCaptainAsLeader(remoteLeaderURL: string) {
  logger.info('markGivenRemoteCaptainAsLeader', {
    'appConfig.MEMBER_URLS': appConfig.MEMBER_URLS,
    remoteLeaderURL: remoteLeaderURL,
  })
  logger.info('markGivenRemoteCaptainAsLeader', 'I AM FOLLOWER')
  appState.setLeaderUrl(remoteLeaderURL)
}

export async function initializeAppModules() {
  await initializeDnsManager()
  await appState.registerRaceHandler()
  await appState.registerNotificationService()
  await appState.registerCaptainSocketServer(appConfig.CAPTAIN_PORT, {
    /* options */
  })
  // if HA mode, then consul agent running along-side each captain will decide the leader.
  if (isHAMode()) {
    await appState.registerConsulService()
  } else {
    // alternate leader election ( first URL is the captain )
    await checkAndPromoteToLeader()
  }
  // Initialize static services
  // Needs to be done before 'connectWithOtherCaptains', because, other captains will send 'updates' for these services,
  // and we need it registered before that.
  await webServiceHelper.processWebServiceFileYAML()
  await appState.connectWithOtherCaptains(
    appConfig.MEMBER_URLS.filter((eachMember: string) => eachMember !== appConfig.SELF_URL)
  )
  // The establish mate socket to receive and initialize dynamic services
  // Mate operations is dependent on leadership, so initialize after leader selection code above.
  await appState.registerMateSocketServer(appConfig.MATE_PORT, {
    /* options */
  })
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
  static lockWaitTimeoutDuration = 30 * 1000 // 30 seconds

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
      logger.debug(`CustomRaceConditionLock: Cleanup locks`)
      for (const eachKey of Object.keys(this.lockedKeys)) {
        const lockHoldTime = Date.now() - this.lockedKeys[eachKey]
        if (lockHoldTime > CustomRaceConditionLock.minLockHoldGuarantee) {
          logger.warn(`CustomRaceConditionLock: Lock cleaned up for key: ${eachKey}`)
          delete this.lockedKeys[eachKey]
        }
      }
    }, CustomRaceConditionLock.cleanUpHandlerInterval)
  }

  async getLock(key: string, lockWaitTimeoutDuration: number = CustomRaceConditionLock.lockWaitTimeoutDuration): Promise<any[]> {
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
          if (elapsedTime < lockWaitTimeoutDuration) {
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

export const MAX_ALLOWED_RETRIES = 10
export function isNetworkError(e: any) {
  if (
    `${e?.cause?.code}` === 'ENOTFOUND' ||
    `${e?.cause?.code}` === 'UND_ERR_CONNECT_TIMEOUT' ||
    `${e?.cause?.code}` === 'UND_ERR_SOCKET' ||
    `${e?.cause?.code}` === 'ECONNRESET' ||
    `${e?.cause?.code}` === 'EAI_AGAIN'
  ) {
    return true
  }
  return false
}

export type RETRY_OPTIONS = {
  currentRetryAttempt: number;
  maxAllowedRetries: number;
}

export function initRetryOptions(inputRetryOptions: any) {
  const retryOptions: RETRY_OPTIONS = inputRetryOptions || {} as any
  return Object.assign(retryOptions, {
    currentRetryAttempt: inputRetryOptions?.currentRetryAttempt ?? 0,
    maxAllowedRetries: inputRetryOptions?.maxAllowedRetries ?? MAX_ALLOWED_RETRIES,
  }) as RETRY_OPTIONS
}


/**
 *  Increments the retry count and calculate the wait time and wait it before the next retry 
 *
 */
export async function incrementCountAndWaitBeforeRetry(logID: string, retryOptions: RETRY_OPTIONS, debugData?: any) {
  retryOptions.currentRetryAttempt += 1
  const waitTime = 5000 + 1500 * retryOptions.currentRetryAttempt
  logger.warn(`${logID}: currentRetryAttempt`, {
    attempt: retryOptions.currentRetryAttempt,
    waitTime,
    ...debugData || {}
  })
  await new Promise((resolve) => setTimeout(resolve, waitTime))
}

/**
 * Wrapper over node 'fetch' with retry handler
 */
export async function customFetch(
  logID: string,
  url: string,
  init?: RequestInit,
  retryOptions: RETRY_OPTIONS = {} as any
): Promise<any> {
  retryOptions = initRetryOptions(retryOptions)
  try {
    const response = await fetch(url, init)
    if (response.ok) {
      const jsonResponse: any = await response.json()
      return jsonResponse
    }
    const responseText = await response.text()
    throw new Error(`${logID}: ${response.statusText}: ${responseText}`)
  } catch (e: any) {
    if (isNetworkError(e)) {
      // wait and retry network errors
      if (retryOptions.currentRetryAttempt < MAX_ALLOWED_RETRIES) {
        await incrementCountAndWaitBeforeRetry(logID, retryOptions, {
          url,
          reason: e?.cause?.code,
        })
        return customFetch(logID, url, init, retryOptions)
      }
    }
    throw e
  }
}
