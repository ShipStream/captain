import jwt from 'jsonwebtoken'
import {Server as IOServer} from 'socket.io'
import type {Socket as ClientSocket} from 'socket.io-client'
import appConfig from './../appConfig.js'
import {logger} from './../coreUtils.js'

export const EVENT_NAMES = {
  NEW_LEADER: 'new-leader',
  ACTIVE_ADDRESSES: 'active-addresses',
  BULK_ACTIVE_ADDRESSES: 'complete-active-addresses', //  array of 'ACTIVE_ADDRESSES' as payLoad
  HEALTH_CHECK_REQUEST: 'health-check-request',
  REQUEST_CHANGE_POLLING_FREQ: 'request-change-polling-freq',
  HEALTH_CHECK_UPDATE: 'health-check-update',
  BULK_HEALTH_CHECK_UPDATE: 'complete-health-check-update', // array of 'HEALTH_CHECK_UPDATE' as payLoad
  NEW_REMOTE_SERVICES: 'new-remote-services', // re-broadcast of mate message to captain 'peers' or 'leader'
  MATE_DISCONNECTED: 'mate-disconnected', // re-broadcast of mate message to captain 'peers' or 'leader'
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
        logger.debug('Error closing connections', err)
        return reject(err)
      }
      logger.debug('All connections closed')
      return resolve()
    })
  })
}

export function getToken() {
  const currentDate = new Date()
  const expiryDate = new Date()
  expiryDate.setHours(expiryDate.getMinutes() + 2)
  const payLoad = {
    sub: appConfig.SELF_URL,
    iat: currentDate.getTime(),
    type: 'ACCESS_TOKEN',
    exp: expiryDate.getTime(),
  }
  return jwt.sign(payLoad, appConfig.CAPTAIN_SECRET_KEY)
}

/**
 * Some extra listeners to log debugging messages about communication
 */
export async function registerClientDebugListeners(clientSocket: ClientSocket, serverUrl: string) {
  const logID = `${SOCKET_CLIENT_LOG_ID}(Remote Server: ${serverUrl})`
  clientSocket.on('connect', () => {
    logger.debug(`${logID}: connect`)
  })
  clientSocket.io.on('reconnect_attempt', () => {
    logger.debug(`${logID}: reconnect_attempt`)
  })
  clientSocket.io.on('reconnect', () => {
    logger.debug(`${logID}: reconnect`)
  })
  clientSocket.on('connect_error', (err: Error) => {
    logger.debug(`${logID}: connect_error`, err?.message)
  })
  clientSocket.on('disconnect', (reason) => {
    logger.debug(`${logID}: disconnect`, {reason})
    if (reason === 'io server disconnect') {
      logger.debug(`${logID}: the disconnection was initiated by the server, you need to reconnect manually`)
      clientSocket.connect()
    }
    // else the socket will automatically try to reconnect
  })
  clientSocket.onAnyOutgoing((event, args) => {
    logger.info(`${logID}: outgoingMessage`, event, JSON.stringify(args))
  })
  clientSocket.onAny((event, args) => {
    logger.info(`${logID}: incomingMessage`, event, JSON.stringify(args))
  })
}
