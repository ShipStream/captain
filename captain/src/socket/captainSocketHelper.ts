import jwt from 'jsonwebtoken'
import {Server as IOServer} from 'socket.io'
import type {Socket as ClientSocket} from 'socket.io-client'
import appState from '../appState.js'
import appConfig from './../appConfig.js'
import {logger} from './../coreUtils.js'

export const enum EVENT_NAMES {
  NEW_LEADER = 'new-leader',
  ACTIVE_ADDRESSES = 'active-addresses',
  BULK_ACTIVE_ADDRESSES = 'complete-active-addresses', //  array of 'ACTIVE_ADDRESSES' as payLoad
  HEALTH_CHECK_REQUEST = 'health-check-request',
  REQUEST_CHANGE_POLLING_FREQ = 'request-change-polling-freq',
  HEALTH_CHECK_UPDATE = 'health-check-update',
  BULK_HEALTH_CHECK_UPDATE = 'complete-health-check-update', // array of 'HEALTH_CHECK_UPDATE' as payLoad
  NEW_REMOTE_SERVICES = 'new-remote-services', // re-broadcast of mate message to captain 'peers' or 'leader'
  MATE_DISCONNECTED = 'mate-disconnected', // re-broadcast of mate disconnection information to captain 'peers' or 'leader'
}

export const MATE_EVENT_NAMES = {
  NEW_REMOTE_SERVICES: 'new-remote-services',
  SERVICE_STATE_CHANGE: 'service-state-change',
}

export const SOCKET_SERVER_LOG_ID = 'CAPTAIN-SOCKET-SERVER'
export const MATE_SOCKET_SERVER_LOG_ID = 'MATE-SOCKET-SERVER'

export const SOCKET_CLIENT_LOG_ID = 'CAPTAIN-SOCKET-CLIENT'

export function closeGivenServer(server: IOServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.debug('Error closing connections', err?.message || err)
        return reject(err)
      }
      logger.debug('All connections closed')
      return resolve()
    })
  })
}

export function getToken() {
  const currentDate = new Date()
  const payLoad = {
    sub: appConfig.SELF_URL,
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
  const logID = `${SOCKET_CLIENT_LOG_ID}(Remote Server: ${serverUrl})`
  clientSocket.on('connect', () => {
    logger.info(`${logID}: connect`)
  })
  clientSocket.io.on('reconnect_attempt', () => {
    logger.info(`${logID}: reconnect_attempt`)
  })
  clientSocket.io.on('reconnect', () => {
    logger.info(`${logID}: reconnect`)
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

export function acknowledge(ackCallback: Function | undefined, status: boolean, acknowledgedBy: string) {
  if (ackCallback) {
    ackCallback({
      acknowledgedBy: acknowledgedBy,
      status: status ? 'ok' : 'error',
    })  
  }  
}

/**
 * Receive re-broadcast/re-sending of 'new-remote-services' from fellow 'captain' ( received originally from a 'mate' )
 * This event could be received through both 'server' and 'client' sockets
 *
 * @private
 * @param {*} payLoad
 * @memberof SocketClientManager
 */
export async function receiveNewRemoteServices(logID: string, payLoad: any, ackCallback?: Function) {
  try {
    logger.info(logID, `receiveNewRemoteServices:${payLoad.mate_id}:${payLoad.message_id}`)
    if (!appState.isRemoteMessageAlreadyProcessed(payLoad.message_id)) {
      logger.debug(logID, 'receiveNewRemoteServices: payLoad', JSON.stringify(payLoad))
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
          new Error(`${logID}: receiveNewRemoteServices: registerGivenMateWebServices: Details: ${payLoad}`, {
            cause: e,
          })
        )  
      })  
    } else {
      logger.info(logID, `receiveNewRemoteServices:already-processed:${payLoad.mate_id}:${payLoad.message_id}`)      
    }
    // optional socket 'acknowledgement' handling
    acknowledge(ackCallback, true, 'receiveNewRemoteServices')
  } catch (e) {
    logger.error(
      new Error(`${logID}: receiveNewRemoteServices: Details: ${payLoad}`, {
        cause: e,
      })
    )
    // optional socket 'acknowledgement' handling
    acknowledge(ackCallback, false, 'receiveNewRemoteServices')
  }
}


/**
 * Receive re-broadcast/re-sending of 'mate-disconnected' from fellow 'captain'
 * This event could be received through both 'server' and 'client' sockets
 * @private
 * @param {*} payLoad
 * @memberof SocketClientManager
 */
export async function receiveMateDisconnected(logID: string, payLoad: any, ackCallback?: Function) {
  try {
    logger.info(logID, `receiveMateDisconnected:${payLoad.mate_id}:${payLoad.message_id}`)
    if (!appState.isRemoteMessageAlreadyProcessed(payLoad.message_id)) {
      if (appState.isLeader() || !appState.getLeaderUrl()) { 
        // Case a). 'leader', re-broadcast to captain 'peers'
        // case b). 'no leader elected', re-broadcast to captain 'peers'
        appState.getSocketManager().broadcastMateDisconnected(payLoad)
      }
      await appState.processMateDisconnection(payLoad.message_id, payLoad.mate_id).catch((e) => {
        logger.error(
          new Error(`${logID}: receiveMateDisconnected: processMateDisconnection: Details: ${payLoad}`, {
            cause: e,
          })
        )  
      })  
    } else {
      logger.info(logID, `receiveMateDisconnected:already-processed:${payLoad.mate_id}:${payLoad.message_id}`)      
    }
    // optional socket 'acknowledgement' handling
    acknowledge(ackCallback, true, 'receiveMateDisconnected')
  } catch (e) {
    logger.error(
      new Error(`${logID}: receiveMateDisconnected: Details: ${payLoad}`, {
        cause: e,
      })
    )
    // optional socket 'acknowledgement' handling
    acknowledge(ackCallback, false, 'receiveMateDisconnected')
  }
}
