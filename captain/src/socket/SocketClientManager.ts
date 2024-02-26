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

  /**
   * Process new leader message received from the 'captain' leader
   *
   * @private
   * @memberof SocketClientManager
   */
  private receiveNewLeader(payLoad: any, ackCallback?: Function) {
    try {
      appState.setLeaderUrl(payLoad.new)
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveNewLeader',
          status: 'ok',
        })  
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: newLeader: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveNewLeader',          
          status: 'error',
        })
      }
    }
  }

  private async receiveActiveAddresses(payLoad: any, ackCallback?: Function) {
    try {
      logger.info(`${this.logID}: receiveActiveAddresses: Details: ${payLoad}`)      
      const webServiceManager = appState.getWebService(payLoad.service)!
      if (webServiceManager) {
        await webServiceManager.setActiveAddresses(payLoad.addresses)
      } else {
        logger.warn(`${this.logID}: activeAddresses: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveActiveAddresses',
          status: 'ok',
        })  
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: activeAddresses: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveActiveAddresses',
          status: 'error',
        })
      }
    }
  }

  private async receiveBulkActiveAddresses(payLoadArray: any, ackCallback?: Function) {
    try {
      logger.info(`${this.logID}: receiveBulkActiveAddresses: Details: ${payLoadArray}`)      
      // Array of active address payload
      for (const eachPayLoad of payLoadArray) {
        await this.receiveActiveAddresses(eachPayLoad)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveBulkActiveAddresses',
          status: 'ok',
        })  
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkActiveAddresses: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveBulkActiveAddresses',
          status: 'error',
        })
      }
    }
  }

  private receiveHealthCheckRequest(payLoad: any, ackCallback?: Function) {
    try {
      logger.info('healthCheckRequest', payLoad)
      const webServiceManager = appState.getWebService(payLoad.service)!
      if (webServiceManager) {
        if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.PASSING) {
          webServiceManager.resetHealthCheckByIPToVerifyPassing(payLoad.address)
        } else if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.FAILING) {
          webServiceManager.resetHealthCheckByIPToVerifyFailing(payLoad.address)
        } else {
          webServiceManager.resetHealthCheckByIP(payLoad.address)
        }
      } else {
        logger.warn(`${this.logID}: healthCheckRequest: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveHealthCheckRequest',
          status: 'ok',
        })  
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckRequest: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveHealthCheckRequest',
          status: 'error',
        })
      }
    }
  }

  private receiveChangePollingFrequency(payLoad: any, ackCallback?: Function) {
    try {
      logger.info('changePollingFrequency', payLoad)
      const webServiceManager = appState.getWebService(payLoad.service)!
      if (webServiceManager) {
        if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.HEALTHY) {
          webServiceManager.markHealthy(true)
        } else if (payLoad.pollingType === CHANGE_POLLING_FREQ_POLLING_TYPE.UN_HEALTHY) {
          webServiceManager.markUnHealthy(true)
        } else {
          logger.warn(`${this.logID}: changePollingFrequency: Unknown polling type`)
        }
      } else {
        logger.warn(`${this.logID}: changePollingFrequency: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveChangePollingFrequency',
          status: 'ok',
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: changePollingFrequency: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveChangePollingFrequency',
          status: 'error',
        })
      }
    }
  }

  private async receiveHealthCheckUpdate(payLoad: any, ackCallback?: Function) {
    try {
      // logger.info(`${logID}: healthCheckUpdate`, payLoad)
      const webServiceManager = appState.getWebService(payLoad.service)!
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
              await webServiceHelper.checkCombinedPeerStateAndInitiateAddActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            } else if (payLoad.failing === webServiceManager.fall) {
              await webServiceHelper.checkCombinedPeerStateAndInitiateRemoveActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            }
          }
          // logger.info(`${logID}: healthCheckUpdate:after`, checks);
        }
      } else {
        logger.warn(`${this.logID}: healthCheckUpdate: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveHealthCheckUpdate',
          status: 'ok',
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckUpdate: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveHealthCheckUpdate',
          status: 'error',
        })
      }
    }
  }

  private async receiveBulkHealthCheckUpdate(payLoadArray: any, ackCallback?: Function) {
    try {
      logger.info(`${this.logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`)
      for (const eachPayLoad of payLoadArray) {
        await this.receiveHealthCheckUpdate(eachPayLoad, undefined)
      }
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveBulkHealthCheckUpdate',
          status: 'ok',
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveBulkHealthCheckUpdate',
          status: 'error',
        })
      }
    }
  }

  /**
   * Receive re-broadcast/re-sending of 'new-remote-services' from fellow 'captain' ( received originally from a 'mate' )
   *
   * @private
   * @param {*} payLoad
   * @memberof SocketClientManager
   */
  private async receiveNewRemoteServices(payLoad: any, ackCallback?: Function) {
    try {
      logger.info(this.logID, 'receiveNewRemoteServices')
      logger.debug(this.logID, 'receiveNewRemoteServices: payLoad', payLoad)
      // Step 1
      if (appState.isLeader()) {
        // Case 'leader', copy of mate payload received from a captain 'peer' directly to leader.
        // The 'leader' needs to broadcast to all captain 'peers'
        appState.getSocketManager().broadcastNewRemoteServices(payLoad)
      }
      // Step2, because the service needs to be in other peers when this is leader and sends active addresses on registration.
      // So, broadcast first and register later
      await appState.registerRemoteMateWebServices(payLoad.message_id, payLoad.mate_id, payLoad.services).catch((e) => {
        logger.error(
          new Error(`${this.logID}: receiveNewRemoteServices: registerGivenMateWebServices: Details: ${payLoad}`, {
            cause: e,
          })
        )  
      })

      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveNewRemoteServices',
          status: 'ok',
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: receiveNewRemoteServices: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveNewRemoteServices',
          status: 'error',
        })
      }
    }
  }

  /**
   * Receive re-broadcast/re-sending of 'mate-disconnected' from fellow 'captain'
   *
   * @private
   * @param {*} payLoad
   * @memberof SocketClientManager
   */
  private async receiveMateDisconnected(payLoad: any, ackCallback?: Function) {
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
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveMateDisconnected',
          status: 'ok'
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: receiveMateDisconnected: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      if (ackCallback) {
        ackCallback({
          acknowledgedBy: 'receiveMateDisconnected',
          status: 'error',
        })
      }
    }
  }

  private async setupConnectionAndListeners() {
    this.clientSocket.on(EVENT_NAMES.NEW_LEADER, (payLoad, callback) => this.receiveNewLeader(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.ACTIVE_ADDRESSES, (payLoad, callback) => this.receiveActiveAddresses(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, (payLoad, callback) => this.receiveBulkActiveAddresses(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, (payLoad, callback) => this.receiveHealthCheckRequest(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.REQUEST_CHANGE_POLLING_FREQ, (payLoad, callback) => this.receiveChangePollingFrequency(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, (payLoad, callback) => this.receiveHealthCheckUpdate(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, (payLoad, callback) => this.receiveBulkHealthCheckUpdate(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.NEW_REMOTE_SERVICES, (payLoad, callback) => this.receiveNewRemoteServices(payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.MATE_DISCONNECTED, (payLoad, callback) => this.receiveMateDisconnected(payLoad, callback))
  }

  constructor(remoteCaptainUrl: string) {
    // const socket = io(captainUrl, {query: { SELF_URL: appConfig.SELF_URL }});
    this.remoteCaptainUrl = remoteCaptainUrl
    this.clientSocket = io(this.remoteCaptainUrl, { 
        query: { token: getToken(),
        clientOrigin: appConfig.SELF_URL,
        'reconnection': true,
        'reconnectionDelay': 300,
        'reconnectionDelayMax' : 500,
        'randomizationFactor': 0,
      } })
    this.logID = `${SOCKET_CLIENT_LOG_ID}(From ${this.remoteCaptainUrl})`
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
