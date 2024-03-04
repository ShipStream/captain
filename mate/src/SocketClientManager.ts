/**
 * Socket client code that manages connection and communication with other captain servers
 */
import jwt from 'jsonwebtoken'
import { io } from 'socket.io-client'
import { nanoid } from 'nanoid'
import type { Socket as ClientSocket } from 'socket.io-client'
import appConfig from './appConfig.js'
import { logger } from './coreUtils.js'
import { WebServiceManager, typeWebServiceConf } from './webServiceManager.js'
import appState from './appState.js'

export const MATE_EVENT_NAMES = {
  NEW_REMOTE_SERVICES: 'new-remote-services',
  SERVICE_STATE_CHANGE: 'service-state-change'
}

export const SOCKET_CLIENT_LOG_ID = 'CAPTAIN-SOCKET-CLIENT'

export function getToken() {
  const currentDate = new Date()
  const payLoad = {
    sub: appConfig.MATE_ID,
    iat: currentDate.getTime(),
    type: 'ACCESS_TOKEN',
  }
  return jwt.sign(payLoad, appConfig.CAPTAIN_SECRET_KEY, {
    expiresIn: 120
  })
}

/**
 * Some extra listeners to log debugging messages about communication
 */
export async function registerClientDebugListeners(clientSocket: ClientSocket, serverUrl: string) {
  const logID = `${SOCKET_CLIENT_LOG_ID}(Server ${serverUrl})`
  clientSocket.io.on('reconnect_attempt', () => {
    logger.info(`${logID}: reconnect_attempt`)
  })
  clientSocket.on('connect_error', (err: Error) => {
    logger.info(`${logID}: connect_error`, err?.message)
  })
  clientSocket.on('disconnect', (reason) => {
    logger.info(`${logID}: disconnect`, {reason})
    if (reason === 'io server disconnect') {
      logger.info(`${logID}: the disconnection was initiated by the server, you need to reconnect manually`)
      clientSocket.connect()
    }
    // else the socket will automatically try to reconnect
  })
  clientSocket.onAnyOutgoing((event, args) => {
    logger.debug(`${logID}: outgoingMessage`, event, JSON.stringify(args))
  })
  clientSocket.onAny((event, args) => {
    logger.debug(`${logID}: incomingMessage`, event, JSON.stringify(args))
  })
}

/**
 * Register listener for listening to 'gossip' from other captain 'peers'
 * Maintain 'state' using class variables eg: captainUrl
 *
 * @export
 */
export class SocketClientManager {
  logID: string
  clientSocket: ClientSocket
  remoteCaptainUrl: string

  onConnect() {
    this.sendNewRemoteServices()
  }

  onReconnect() {
    this.sendNewRemoteServices()
  }

  private async setupConnectionAndListeners() {
    this.clientSocket.on('connect', () => {
      logger.info(`${this.logID}: connect`)
      this.onConnect()
    })
    // 'connect' called on reconnect too, so 'reconnect' event not needed,
    // to invoke the 'sendNewRemoteServices' logic
    this.clientSocket.io.on('reconnect', () => {
      logger.info(`${this.logID}: reconnect`)
    })
  }

  constructor(remoteCaptainUrl: string) {
    try {
      this.remoteCaptainUrl = remoteCaptainUrl
      this.clientSocket = io(this.remoteCaptainUrl, { query: { token: getToken(), clientOrigin: appConfig.MATE_ID } })
      this.logID = `${SOCKET_CLIENT_LOG_ID}(To ${this.remoteCaptainUrl})`  
    } catch(e) {
      logger.error(`Error:${SOCKET_CLIENT_LOG_ID}(To ${remoteCaptainUrl})`)
      throw e
    }
  }

  cleanUpForDeletion() {
    try {
      this.clientSocket.close()
    } catch(e) {
      logger.error('cleanUpForDeletion', e)
    }
  }

  // Factory to create captain socket server
  public static async createCaptainSocketClient(remoteCaptainUrl: string) {
    const captainSocketServer = new SocketClientManager(remoteCaptainUrl)
    await captainSocketServer.setupConnectionAndListeners()
    await registerClientDebugListeners(captainSocketServer.clientSocket, remoteCaptainUrl)
    return captainSocketServer
  }

  sendServiceStateChangeMessage(webServiceManager: WebServiceManager, healthy: number) {
    logger.warn(this.logID, 'sendServiceStateChangeMessage')
    this.clientSocket.emit(MATE_EVENT_NAMES.SERVICE_STATE_CHANGE, {
      mate_id: appConfig.MATE_ID,
      service: webServiceManager.serviceKey,
      upstreams: webServiceManager.serviceConf.mate.addresses.length,
      healthy
    })
  }

  sendNewRemoteServices() {
    logger.info(this.logID, 'sendNewRemoteServices:begin')
    const servicesPayload = Object.values(appState.getWebServices()).map((eachService) => {
      const serviceConf: Partial<typeWebServiceConf> = { ...eachService.serviceConf }
      // Send everything except 'mate' property from yaml data
      delete serviceConf.mate;
      return serviceConf
    })
    logger.info(this.logID, 'sendNewRemoteServices:processing', servicesPayload.map((eachService) => eachService.name))
    this.clientSocket.emit(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES, {
      message_id:  appState.generateMessageID(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES),
      mate_id: appConfig.MATE_ID,
      services: servicesPayload
    })
    logger.info(this.logID, 'sendNewRemoteServices:complete')
  }

}
