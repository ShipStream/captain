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
}

export const SOCKET_SERVER_LOG_ID = 'CAPTAIN-SOCKET-SERVER'

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
export async function registerClientDebugListeners(clientSocket: ClientSocket, serverUrl: string, clientUrl: string) {
  const logID = `${SOCKET_CLIENT_LOG_ID}(Server ${serverUrl})(Client ${clientUrl})`
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
    logger.debug(`${logID}: onAnyOutgoing`, event, JSON.stringify(args))
  })
  clientSocket.onAny((event, args) => {
    logger.debug(`${logID}: onAny`, event, JSON.stringify(args))
  })
}
