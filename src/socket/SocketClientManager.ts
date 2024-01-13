/**
 * Socket client code that manages connection and communication with other captain servers
 */
// import io from 'socket.io-client'
import { io } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { EVENT_NAMES, SOCKET_CLIENT_LOG_ID, getToken, registerClientDebugListeners } from './captainSocketHelper.js'
import appState from '../appState.js'
import appConfig from '../appConfig.js'
import webServiceHelper, {
  HEALTH_CHECK_REQUEST_VERIFY_STATE,
  CHANGE_POLLING_FREQ_POLLING_TYPE,
} from '../web-service/webServiceHelper.js'
import { logger } from '../coreUtils.js'

/**
 * Register listener for listening to 'gossip' from other captain 'peers'
 * Maintain 'state' using class variables eg: captainUrl
 *
 * @export
 * @param {string} captainUrl
 */
export class SocketClientManager {
  logID: string
  clientSocket: ClientSocket
  remoteCaptainUrl: string

  private newLeader(payLoad: any) {
    try {
      appState.setLeaderUrl(payLoad.new)
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: newLeader: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private activeAddresses(payLoad: any) {
    try {
      const webServiceManager = appState.webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        webServiceManager.setActiveAddresses(payLoad.addresses)
      } else {
        logger.warn(`${this.logID}: activeAddresses: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      console.error(e)
      logger.error(
        new Error(`${this.logID}: activeAddresses: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private bulkActiveAddresses(payLoadArray: any) {
    try {
      // Array of active address payload
      for (const eachPayLoad of payLoadArray) {
        this.activeAddresses(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkActiveAddresses: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  private healthCheckRequest(payLoad: any) {
    try {
      logger.info('healthCheckRequest', payLoad)
      const webServiceManager = appState.webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.PASSING) {
          webServiceManager.resetHealthCheckByIPToVerifyPassing(payLoad.address)
        } else if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.FAILING) {
          webServiceManager.resetHealthCheckByIPToVerifyFailing(payLoad.address)
        } else {
          webServiceManager.resetHealthCheckByIP(payLoad.address)
        }
      } else {
        logger.warn(`${this.logID}: healthCheckRequest: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckRequest: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private changePollingFrequency(payLoad: any) {
    try {
      logger.info('changePollingFrequency', payLoad)
      const webServiceManager = appState.webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.HEALTHY) {
          webServiceManager.markHealthy()
        } else if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.UN_HEALTHY) {
          webServiceManager.markUnHealthy()
        } else {
          logger.warn(`${this.logID}: changePollingFrequency: Unknown polling type`)
        }
      } else {
        logger.warn(`${this.logID}: changePollingFrequency: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: changePollingFrequency: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private healthCheckUpdate(payLoad: any) {
    try {
      // logger.info(`${logID}: healthCheckUpdate`, payLoad)
      const webServiceManager = appState.webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        // Skip own data from 'other' memebers, usually in case of bulkHealthCheckUpdate
        if (payLoad.member !== appConfig.SELF_URL) {
          const checks = webServiceManager.serviceState.checks!
          const existingData = checks[payLoad.member]?.[payLoad.address]
          const existingLastUpdate = existingData?.last_update
          if (!existingLastUpdate || new Date(existingLastUpdate).getTime() < new Date(payLoad.last_update).getTime()) {
            logger.debug(`${this.logID}: healthCheckUpdate: new data updated into system`, JSON.stringify(payLoad))
            checks[payLoad.member] = {
              ...(checks[payLoad.member] || {}),
              [payLoad.address]: {
                failing: payLoad.failing,
                passing: payLoad.passing,
                last_update: payLoad.last_update,
              },
            }
          } else {
            logger.info(`${this.logID}: healthCheckUpdate: already have the latest data. Ignoring`, {
              existingData: JSON.stringify(payLoad),
              incomingData: JSON.stringify(payLoad),
            })
          }
          // If 'leader', recheck potential 'failover' and 'addBack Active Address' agreement,
          // by checking 'state' of all peers
          // since we have received new 'checks' state data
          if (appState.isLeader()) {
            if (payLoad.passing === webServiceManager.rise) {
              webServiceHelper.checkCombinedPeerStateAndInitiateAddActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            } else if (payLoad.failing === webServiceManager.fall) {
              webServiceHelper.checkCombinedPeerStateAndInitiateRemoveActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            }
          }
          // logger.info(`${logID}: healthCheckUpdate:after`, checks);
        }
      } else {
        logger.warn(`${this.logID}: healthCheckUpdate: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckUpdate: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  public bulkHealthCheckUpdate(payLoadArray: any) {
    try {
      for (const eachPayLoad of payLoadArray) {
        this.healthCheckUpdate(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  private async setupConnectionAndListeners() {
    this.clientSocket.on(EVENT_NAMES.NEW_LEADER, (payLoad) => this.newLeader(payLoad))
    this.clientSocket.on(EVENT_NAMES.ACTIVE_ADDRESSES, (payLoad) => this.activeAddresses(payLoad))
    this.clientSocket.on(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, (payLoad) => this.bulkActiveAddresses(payLoad))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, (payLoad) => this.healthCheckRequest(payLoad))
    this.clientSocket.on(EVENT_NAMES.REQUEST_CHANGE_POLLING_FREQ, (payLoad) => this.changePollingFrequency(payLoad))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, (payLoad) => this.healthCheckUpdate(payLoad))
    this.clientSocket.on(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, (payLoad) => this.bulkHealthCheckUpdate(payLoad))
  }

  constructor(remoteCaptainUrl: string) {
    // const socket = io(captainUrl, {query: { SELF_URL: appConfig.SELF_URL }});
    this.remoteCaptainUrl = remoteCaptainUrl
    this.clientSocket = io(this.remoteCaptainUrl, { query: { token: getToken(), clientOrigin: appConfig.SELF_URL } })
    this.logID = `${SOCKET_CLIENT_LOG_ID}(To ${this.remoteCaptainUrl})`
  }

  cleanUpForDeletion() {
    try {
      this.clientSocket.close()
    } catch(e) {
      logger.error(e)
    }
  }

  // Factory to create captain socket server
  public static async createCaptainSocketClient(remoteCaptainUrl: string) {
    const captainSocketServer = new SocketClientManager(remoteCaptainUrl)
    await captainSocketServer.setupConnectionAndListeners()
    await registerClientDebugListeners(captainSocketServer.clientSocket, appConfig.SELF_URL, remoteCaptainUrl)
    return captainSocketServer
  }
}
