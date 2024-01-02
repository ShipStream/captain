/**
 * Socket server that handles communication from other captains
 */

import type {Socket, Server as SocketServer} from 'socket.io'
import jwt from 'jsonwebtoken'
import {EVENT_NAMES, SOCKET_SERVER_LOG_ID} from './captainSocketHelper.js'
import {WebServiceManager} from '../web-service/webServiceManager.js'
import appConfig from '../appConfig.js'
import {getLeaderUrl, isLeader, webServices} from '../appState.js'
import {logger} from './../coreUtils.js'

let io: SocketServer

/**
 * Setup connection from clients ('peers')
 *
 * @export
 * @param {SocketServer} inputIO
 */
export function setupSocketConnectionAndListeners(inputIO: SocketServer) {
  io = inputIO
  // jwt based authentication for socket connections between captain members
  io.use(function (socket, next) {
    // const logID = `${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address})`
    const token = `${socket.handshake.query?.token}`
    if (token) {
      jwt.verify(
        token,
        appConfig.CAPTAIN_SECRET_KEY,
        function (err: jwt.VerifyErrors | null, _data: string | jwt.JwtPayload | undefined) {
          if (err) {
            return next(new Error(`Socket authentication failed: reason: ${err?.message}`))
          }
          return next()
        }
      )
    } else {
      return next(new Error(`Socket authentication 'token' not set`))
    }
  })
  io.on('connection', async (socket) => {
    registerDebugListeners(socket)
    transferCurrentState(socket)
  })
  // io.engine.on('initial_headers', (headers, _req) => {
  //   logger.info(`${SOCKET_SERVER_LOG_ID}: initial_headers:`, headers)
  // })
  // io.engine.on('headers', (headers, _req) => {
  //   logger.info(`${SOCKET_SERVER_LOG_ID}: headers:`, headers)
  // })
  io.engine.on('connection_error', (err) => {
    logger.info(`${SOCKET_SERVER_LOG_ID}: connection_error: details`, {
      'err.code': err.code,
      'err.message': err.message,
      'err.context': err.context,
    })
    logger.debug(`${SOCKET_SERVER_LOG_ID}: connection_error`, err)
  })
}

/**
 * Transfer complete set of data, tracked by current 'captain' instance to the connecting 'peer'. Help nodes that could potentially join later
 *
 * @param {Socket} socket
 */
function transferCurrentState(socket: Socket) {
  // If leader, also transfer 'newLeader' and 'activeAddress'es data
  if (isLeader()) {
    sendNewLeaderToSocket(socket, getLeaderUrl())
    sendBulkActiveAddressesToSocket(socket)
  }
  sendMyBulkHealthCheckUpdateToSocket(socket)
}

/**
 * Some basic listeners to log debugging messages about communication from this server
 *
 * @param {Socket} socket
 */
async function registerDebugListeners(socket: Socket) {
  const logID = `${SOCKET_SERVER_LOG_ID}(From:${socket.handshake.address})`
  logger.info(`${logID}: New connection: registerListeners`, {
    new: [socket.id, socket.handshake.address],
    all: (await io.fetchSockets()).map((eachSocket) => [eachSocket.id, eachSocket.handshake.address]),
  })
  socket.onAnyOutgoing((event, args) => {
    logger.debug(`${logID}: onAnyOutgoing(${socket.handshake.address})`, event, JSON.stringify(args))
  })
  socket.onAny((event, args) => {
    logger.debug(`${logID}: onAny(${socket.handshake.address})`, event, JSON.stringify(args))
  })
}

/**
 * Broadcast request to 'reset' health check to re-confirm given 'verifyState'
 *
 * @export
 * @param {WebServiceManager} webService
 * @param {string} verifyState
 * @param {string} ipAddress
 */
export function broadcastRequestForHealthCheck(webService: WebServiceManager, verifyState: string, ipAddress: string) {
  // logger.info('broadcastRequestForHealthCheck', ipAddress)
  io.emit(EVENT_NAMES.HEALTH_CHECK_REQUEST, {
    member: appConfig.SELF_URL,
    serviceKey: webService.serviceKey,
    service: webService.serviceConf.name,
    address: ipAddress,
    verifyState,
  })
}

/**
 * Only leader maintains the web service 'status' ('healthy' OR 'unhealthy').
 * Since the polling need to use 'healthy_interval' or 'unhealthy_interval' based on health 'status',
 * leader communicates the polling frequency required via this 'broadcast' to non-leader members
 *
 * @export
 * @param {WebServiceManager} webService
 * @param {string} pollingType
 */
export function broadcastResetPolling(webService: WebServiceManager, pollingType: string) {
  io.emit(EVENT_NAMES.RESET_POLLING_REQUEST, {
    member: appConfig.SELF_URL,
    serviceKey: webService.serviceKey,
    service: webService.serviceConf.name,
    pollingType,
  })
}

/**
 * Broadcast individual failing/passing health check per 'web service' per 'ip address'
 *
 * @export
 * @param {WebServiceManager} webService
 * @param {string} ipAddress
 */
export function broadcastHealthCheckUpdate(webService: WebServiceManager, ipAddress: string) {
  io.emit(EVENT_NAMES.HEALTH_CHECK_UPDATE, {
    member: appConfig.SELF_URL,
    serviceKey: webService.serviceKey,
    service: webService.serviceConf.name,
    address: ipAddress,
    failing: webService.getChecksDataByCurrentCaptainInstance()[ipAddress]!.failing,
    passing: webService.getChecksDataByCurrentCaptainInstance()[ipAddress]!.passing,
    last_update: webService.getChecksDataByCurrentCaptainInstance()[ipAddress]!.last_update,
  })
}

/**
 * Broadcast new leader to 'peers'
 *
 * @export
 * @param {string} leaderURL
 */
export function broadcastNewLeader(leaderURL: string) {
  io.emit(EVENT_NAMES.NEW_LEADER, {
    new: leaderURL,
  })
}

/**
 * Broadcast 'active' addresses of a web service to 'peers'
 * Called only by 'leader'
 *
 * @export
 * @param {WebServiceManager} webService
 */
export function broadcastActiveAddresses(webService: WebServiceManager) {
  io.emit(EVENT_NAMES.ACTIVE_ADDRESSES, {
    serviceKey: webService.serviceKey,
    service: webService.serviceConf.name,
    addresses: webService.serviceState.active,
  })
}

/**
 * Send 'active_addresses' of all web service to newly discovered 'captain'
 * Called only by 'leader'
 *
 */
export function sendBulkActiveAddressesToSocket(socket: Socket) {
  const completeActiveAddresses = Object.keys(webServices).map((eachServiceKey) => {
    const webService = webServices[eachServiceKey]!
    return {
      serviceKey: webService.serviceKey,
      service: webService.serviceConf.name,
      addresses: webService.serviceState.active,
    }
  })
  socket.emit(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, completeActiveAddresses)
}

/**
 * Send complete checks 'state' tracked by 'current' captain instance to newly discovered captain 'peer'
 *
 * @export
 * @param {Socket} socket
 */
export function sendMyBulkHealthCheckUpdateToSocket(socket: Socket) {
  const bulkHealthCheckUpdates = []
  for (const eachServiceKey of Object.keys(webServices)) {
    const webService = webServices[eachServiceKey]!
    const checksByEachCaptainMembers = webService.serviceState.checks[appConfig.SELF_URL]
    if (checksByEachCaptainMembers) {
      for (const eachIpAddress of Object.keys(checksByEachCaptainMembers)) {
        bulkHealthCheckUpdates.push({
          member: appConfig.SELF_URL,
          serviceKey: webService.serviceKey,
          service: webService.serviceConf.name,
          address: eachIpAddress,
          failing: checksByEachCaptainMembers[eachIpAddress]!.failing,
          passing: checksByEachCaptainMembers[eachIpAddress]!.passing,
          last_update: checksByEachCaptainMembers[eachIpAddress]!.last_update,
        })
      }
    }
  }
  // console.log('bulkHealthCheckUpdates', bulkHealthCheckUpdates)
  socket.emit(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, bulkHealthCheckUpdates)
}

/**
 * Send complete checks 'state' tracked by 'all' captain instances to newly discovered captain 'peer'
 *
 * @export
 * @param {Socket} socket
 */
export function sendCompleteBulkHealthCheckUpdateToSocket(socket: Socket) {
  const bulkHealthCheckUpdates = []
  for (const eachServiceKey of Object.keys(webServices)) {
    const webService = webServices[eachServiceKey]!
    for (const eachCaptainMemberUrl of Object.keys(webService.serviceState.checks)) {
      const checksByEachCaptainMembers = webService.serviceState.checks[eachCaptainMemberUrl]
      if (checksByEachCaptainMembers) {
        for (const eachIpAddress of Object.keys(checksByEachCaptainMembers)) {
          bulkHealthCheckUpdates.push({
            member: eachCaptainMemberUrl,
            serviceKey: webService.serviceKey,
            service: webService.serviceConf.name,
            address: eachIpAddress,
            failing: checksByEachCaptainMembers[eachIpAddress]!.failing,
            passing: checksByEachCaptainMembers[eachIpAddress]!.passing,
            last_update: checksByEachCaptainMembers[eachIpAddress]!.last_update,
          })
        }
      }
    }
  }
  socket.emit(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, bulkHealthCheckUpdates)
}

/**
 * Send leader data to newly discovered captain
 *
 * @export
 * @param {Socket} socket
 * @param {string} leaderURL
 */
export function sendNewLeaderToSocket(socket: Socket, leaderURL: string) {
  socket.emit(EVENT_NAMES.NEW_LEADER, {
    new: leaderURL,
  })
}