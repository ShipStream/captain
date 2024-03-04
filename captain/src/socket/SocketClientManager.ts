/**
 * Socket client code that manages connection and communication with other captain servers
 */
// import io from 'socket.io-client'
import { io } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { EVENT_NAMES, SOCKET_CLIENT_LOG_ID, acknowledge, getToken, receiveMateDisconnected, receiveNewRemoteServices, registerClientDebugListeners } from './captainSocketHelper.js'
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

  /**
   * Send 'new-remote-services' message to the given captain by url
   * 
   * This is a send/emit method, all most other methods are receivers of events rather than senders
   * The reason, being we receive the remote leader information through the clientSocket,
   * and we use the same channel/connection to send connected mate details back to the 'leader' captain peer
   */
  public sendNewRemoteServices(payLoad: any) {
    logger.info('sendNewRemoteServices', {
      remoteCaptainUrl: this.remoteCaptainUrl,
      payLoad,
    })
    this.clientSocket!.emit(EVENT_NAMES.NEW_REMOTE_SERVICES, payLoad)
  }

  /**
   * Send 'mate-disconnected' message to the given captain by url
   *
   * This is a send/emit method, all most other methods are receivers of events rather than senders
   * The reason, being we receive the remote leader information through the clientSocket,
   * and we use the same channel/connection to send connected mate details back to the 'leader' captain peer 
   */
  public sendMateDisconnected(payLoad: any) {
    this.clientSocket!.emit(EVENT_NAMES.MATE_DISCONNECTED, payLoad)
  }

  /**
   * Process new leader message received from the 'captain' leader
   *
   * @private
   * @memberof SocketClientManager
   */
  private receiveNewLeader(payLoad: any, ackCallback?: Function) {
    try {
      logger.info(`${this.logID}: receiveNewLeader: Details: ${JSON.stringify(payLoad)}`)
      appState.setLeaderUrl(payLoad.new)
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, true, 'receiveNewLeader')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: newLeader: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveNewLeader')
    }
  }

  private async receiveActiveAddresses(payLoad: any, ackCallback?: Function) {
    try {
      const webServiceManager = appState.getWebService(payLoad.service)!
      if (webServiceManager) {
        await webServiceManager.setActiveAddresses(payLoad.addresses)
      } else {
        logger.warn(`${this.logID}: activeAddresses: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, true, 'receiveActiveAddresses')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: activeAddresses: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveActiveAddresses')
    }
  }

  private async receiveBulkActiveAddresses(payLoadArray: any, ackCallback?: Function) {
    try {
      // Array of active address payload
      for (const eachPayLoad of payLoadArray) {
        await this.receiveActiveAddresses(eachPayLoad)
      }
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, true, 'receiveBulkActiveAddresses')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkActiveAddresses: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveBulkActiveAddresses')
    }
  }

  private receiveHealthCheckRequest(payLoad: any, ackCallback?: Function) {
    try {
      const webServiceManager = appState.getWebService(payLoad.service)!
      if (webServiceManager) {
        if (webServiceManager.serviceConf.addresses.includes(payLoad.address)) {
          if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.PASSING) {
            webServiceManager.resetHealthCheckByIPToVerifyPassing(payLoad.address)
          } else if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.FAILING) {
            webServiceManager.resetHealthCheckByIPToVerifyFailing(payLoad.address)
          } else {
            webServiceManager.resetHealthCheckByIP(payLoad.address)
          }  
        } else {
          logger.warn(`${this.logID}: healthCheckRequest: Unknown IpAddress: ${payLoad.address} for known service: ${payLoad.service}`)  
        }
      } else {
        logger.warn(`${this.logID}: healthCheckRequest: Unknown Service: ${payLoad.service}`)
      }
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, true, 'receiveHealthCheckRequest')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckRequest: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveHealthCheckRequest')
    }
  }

  private receiveChangePollingFrequency(payLoad: any, ackCallback?: Function) {
    try {
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
      acknowledge(ackCallback, true, 'receiveChangePollingFrequency')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: changePollingFrequency: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveChangePollingFrequency')
    }
  }

  private async receiveHealthCheckUpdate(payLoad: any, ackCallback?: Function) {
    try {
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
      acknowledge(ackCallback, true, 'receiveHealthCheckUpdate')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: healthCheckUpdate: Details: ${payLoad}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveHealthCheckUpdate')
    }
  }

  private async receiveBulkHealthCheckUpdate(payLoadArray: any, ackCallback?: Function) {
    try {
      for (const eachPayLoad of payLoadArray) {
        await this.receiveHealthCheckUpdate(eachPayLoad, undefined)
      }
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, true, 'receiveBulkHealthCheckUpdate')
    } catch (e) {
      logger.error(
        new Error(`${this.logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
      // optional socket 'acknowledgement' handling
      acknowledge(ackCallback, false, 'receiveBulkHealthCheckUpdate')
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
    this.clientSocket.on(EVENT_NAMES.NEW_REMOTE_SERVICES, (payLoad, callback) => receiveNewRemoteServices(this.logID, payLoad, callback))
    this.clientSocket.on(EVENT_NAMES.MATE_DISCONNECTED, (payLoad, callback) => receiveMateDisconnected(this.logID, payLoad, callback))
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
    } catch(e: any) {
      logger.error('SocketClientManager:cleanUpForDeletion', e?.message || e)
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
