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
import { logger, processMateDisconnection } from '../coreUtils.js'

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

  private receiveNewLeader(payLoad: any) {
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

  private receiveActiveAddresses(payLoad: any) {
    try {
      const webServiceManager = appState.getWebService(payLoad.serviceKey)!
      if (webServiceManager) {
        webServiceManager.setActiveAddresses(payLoad.addresses)
      } else {
        logger.warn(`${this.logID}: activeAddresses: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: activeAddresses: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private receiveBulkActiveAddresses(payLoadArray: any) {
    try {
      // Array of active address payload
      for (const eachPayLoad of payLoadArray) {
        this.receiveActiveAddresses(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkActiveAddresses: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  private receiveHealthCheckRequest(payLoad: any) {
    try {
      logger.info('healthCheckRequest', payLoad)
      const webServiceManager = appState.getWebService(payLoad.serviceKey)!
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

  private receiveChangePollingFrequency(payLoad: any) {
    try {
      logger.info('changePollingFrequency', payLoad)
      const webServiceManager = appState.getWebService(payLoad.serviceKey)!
      if (webServiceManager) {
        if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.HEALTHY) {
          webServiceManager.markHealthy(true)
        } else if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.UN_HEALTHY) {
          webServiceManager.markUnHealthy(true)
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

  private receiveHealthCheckUpdate(payLoad: any) {
    try {
      // logger.info(`${logID}: healthCheckUpdate`, payLoad)
      const webServiceManager = appState.getWebService(payLoad.serviceKey)!
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

  private receiveBulkHealthCheckUpdate(payLoadArray: any) {
    try {
      for (const eachPayLoad of payLoadArray) {
        this.receiveHealthCheckUpdate(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  /**
   * Receive re-broadcast/re-sending of 'new-remote-services' from fellow 'captain' ( received originally from a 'mate' )
   *
   * @private
   * @param {*} payLoad
   * @memberof SocketClientManager
   */
  private receiveNewRemoteServices(payLoad: any) {
    try {
      logger.info(this.logID, 'receiveNewRemoteServices')
      appState.registerRemoteMateWebServices(payLoad.message_id, payLoad.mate_id, payLoad.services).catch((e) => {
        logger.error(
          new Error(`${this.logID}: receiveNewRemoteServices: registerGivenMateWebServices: Details: ${payLoad}`, {
            cause: e,
          })
        )  
      })
      if (appState.isLeader()) {
        // Case 'leader', copy of mate payload received from a captain 'peer' directly to leader.
        // The 'leader' needs to broadcast to all captain 'peers'
        appState.getSocketManager().broadcastNewRemoteServices(payLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: receiveNewRemoteServices: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  /**
   * Receive re-broadcast/re-sending of 'mate-disconnected' from fellow 'captain'
   *
   * @private
   * @param {*} payLoad
   * @memberof SocketClientManager
   */
  private async receiveMateDisconnected(payLoad: any) {
    try {
      const mateID = payLoad.mate_id
      logger.info(this.logID, mateID, 'receiveMateDisconnected')
      await processMateDisconnection(mateID)      
      if (appState.isLeader() || !appState.getLeaderUrl()) { 
        // Case a). 'leader', re-broadcast to captain 'peers'
        // case b). 'no leader elected', re-broadcast to captain 'peers'
        appState.getSocketManager().broadcastMateDisconnected({
          mate_id: mateID
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: receiveMateDisconnected: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  private async setupConnectionAndListeners() {
    this.clientSocket.on(EVENT_NAMES.NEW_LEADER, (payLoad) => this.receiveNewLeader(payLoad))
    this.clientSocket.on(EVENT_NAMES.ACTIVE_ADDRESSES, (payLoad) => this.receiveActiveAddresses(payLoad))
    this.clientSocket.on(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, (payLoad) => this.receiveBulkActiveAddresses(payLoad))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, (payLoad) => this.receiveHealthCheckRequest(payLoad))
    this.clientSocket.on(EVENT_NAMES.REQUEST_CHANGE_POLLING_FREQ, (payLoad) => this.receiveChangePollingFrequency(payLoad))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, (payLoad) => this.receiveHealthCheckUpdate(payLoad))
    this.clientSocket.on(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, (payLoad) => this.receiveBulkHealthCheckUpdate(payLoad))
    this.clientSocket.on(EVENT_NAMES.NEW_REMOTE_SERVICES, (payLoad) => this.receiveNewRemoteServices(payLoad))
    this.clientSocket.on(EVENT_NAMES.MATE_DISCONNECTED, (payLoad) => this.receiveMateDisconnected(payLoad))
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
    await registerClientDebugListeners(captainSocketServer.clientSocket, remoteCaptainUrl)
    return captainSocketServer
  }
}
