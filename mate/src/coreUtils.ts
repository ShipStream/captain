import fs from 'fs/promises'
import http from 'http'
import YAML from 'yaml'
import { existsSync } from 'fs'
import appConfig from "./appConfig.js"
import appState from "./appState.js"

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


/**
 * Discover 'static' services to be directly managed by the 'captain' by reading the 'services.yaml'.
 * Called on 'startup' and also using 'SIGHUP' signal
 *
 */
async function processWebServiceFileYAML() {
  logger.info('processServiceFileYAML')
  if (existsSync(appConfig.WEBSERVICE_YAML_LOCATION)) {
    const servicesFile = await fs.readFile(appConfig.WEBSERVICE_YAML_LOCATION, 'utf8')
    const loadedYaml = YAML.parse(servicesFile)
    logger.debug('processServiceFileYAML', {
      loadedYaml: JSON.stringify(loadedYaml, undefined, 2)
    });
    await appState.registerWebServices(loadedYaml?.services)
  } else {
    throw new Error(`WebService YAML file location invalid: ${appConfig.WEBSERVICE_YAML_LOCATION}`)
  }
}

/**
 * Utility method to read response body from https.get or http.get
 *
 * @export
 * @param {http.IncomingMessage} res
 * @return {*}  {Promise<string>}
 */
export function readResponseBodyFromHealthCheck(res: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const chunks: any[] = []
      res.on('data', (chunk) => {
        logger.debug('readResponseBodyFromHealthCheck:data')
        chunks.push(chunk)
      })
      res.on('end', () => {
        logger.debug('readResponseBodyFromHealthCheck:end')
        const body = Buffer.concat(chunks)
        resolve(body.toString('utf-8'))
      })
    } catch (e) {
      reject(e)
    }
  })
}

export async function initializeAppModules() {
  logger.info('initializeAppModules:started')
  await appState.registerRaceHandler()  
  await processWebServiceFileYAML()
  // Connect if there is no connection already (since this method is used for 'softReload' too)
  if (!appState.getSocketManager()?.clientSocket?.connected) {
    await appState.establishConnectionWithCaptain()
  }
  logger.info('initializeAppModules:finished')
}

/**
 * Reload app on sighup. Also used for reload app between tests
 *
 */
export async function softReloadApp() {
  await appState.resetAppState({resetSockets: false, resetWebApps: true})
  await initializeAppModules()
  appState.getSocketManager().sendNewRemoteServices()
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
  static lockWaitTimeoutDuration = 90 * 1000 // 90 seconds

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
