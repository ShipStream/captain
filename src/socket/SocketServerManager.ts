/**
 * Socket server that handles communication from other captains
 */

import {type ServerOptions, type Socket as ServerSocket, Server as IOServer} from 'socket.io'
import jwt from 'jsonwebtoken'
import {EVENT_NAMES, SOCKET_SERVER_LOG_ID, closeGivenServer} from './captainSocketHelper.js'
import {WebServiceManager} from '../web-service/webServiceManager.js'
import appConfig from '../appConfig.js'
import appState from '../appState.js'
import {logger} from '../coreUtils.js'

/**
 * Transfer complete set of data, tracked by current 'captain' instance to the connecting 'peer'. Help nodes that could potentially join later
 *
 * @param {ServerSocket} socket
 */
function transferCurrentState(socket: ServerSocket) {
  // If leader, also transfer 'newLeader' and 'activeAddress'es data
  if (appState.isLeader()) {
    sendNewLeaderToSocket(socket, appState.getLeaderUrl()!)
    sendBulkActiveAddressesToSocket(socket)
  }
  sendMyBulkHealthCheckUpdateToSocket(socket)
}

function constructBulkActiveAddressesMessage() {
  const completeActiveAddresses = Object.keys(appState.webServices).map((eachServiceKey) => {
    const webService = appState.webServices[eachServiceKey]!
    return {
      serviceKey: webService.serviceKey,
      service: webService.serviceConf.name,
      addresses: webService.serviceState.active,
    }
  })
  return completeActiveAddresses
}

/**
 * Send 'active_addresses' of all web service to newly discovered 'captain'
 * Called only by 'leader'
 *
 */
function sendBulkActiveAddressesToSocket(socket: ServerSocket) {
  socket.emit(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, constructBulkActiveAddressesMessage())
}

/**
 * Send complete checks 'state' tracked by 'current' captain instance to newly discovered captain 'peer'
 *
 * @export
 * @param {ServerSocket} socket
 */
function sendMyBulkHealthCheckUpdateToSocket(socket: ServerSocket) {
  const bulkHealthCheckUpdates = []
  for (const eachServiceKey of Object.keys(appState.webServices)) {
    const webService = appState.webServices[eachServiceKey]!
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
 * @param {ServerSocket} socket
 */
function sendCompleteBulkHealthCheckUpdateToSocket(socket: ServerSocket) {
  const bulkHealthCheckUpdates = []
  for (const eachServiceKey of Object.keys(appState.webServices)) {
    const webService = appState.webServices[eachServiceKey]!
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
 * @param {ServerSocket} socket
 * @param {string} leaderURL
 */
function sendNewLeaderToSocket(socket: ServerSocket, leaderURL: string) {
  socket.emit(EVENT_NAMES.NEW_LEADER, {
    new: leaderURL,
  })
}

export class CaptainSocketServerManager {
  io!: IOServer

  /**
   * Some basic listeners to log debugging messages about communication from this server
   *
   * @param {ServerSocket} socket
   */
  private async registerDebugListeners(socket: ServerSocket) {
    const from = socket.handshake.query?.clientOrigin
    const logID = `${SOCKET_SERVER_LOG_ID}(From:${from})`
    logger.info(`${logID}: New connection: registerListeners`, {
      new: [socket.id, from],
      all: (await this.io.fetchSockets()).map((eachSocket) => [
        eachSocket.id,
        eachSocket.handshake.query?.clientOrigin,
      ]),
    })
    socket.onAnyOutgoing((event, args) => {
      logger.debug(`${logID}: onAnyOutgoing(${socket.handshake.address})`, event, JSON.stringify(args))
    })
    socket.onAny((event, args) => {
      logger.debug(`${logID}: onAny(${socket.handshake.address})`, event, JSON.stringify(args))
    })
  }

  /**
   * Setup connection from clients ('peers')
   *
   * @export
   */
  private setupConnectionAndListeners() {
    // jwt based authentication for socket connections between captain members
    this.io.use(function (socket, next) {
      // const logID = `${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address})`
      const token = `${socket.handshake.query?.token}`
      const clientOrigin = `${socket.handshake.query?.clientOrigin}`
      if (clientOrigin) {
        if (!appConfig.MEMBER_URLS.includes(clientOrigin)) {
          return next(new Error(`Unknown clientOrigin: ${clientOrigin}`))
        }
      } else {
        return next(new Error(`'clientOrigin' not set`))
      }
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
    this.io.on('connection', async (socket) => {
      this.registerDebugListeners(socket)
      transferCurrentState(socket)
    })
    // this.io.engine.on('initial_headers', (headers, _req) => {
    //   logger.info(`${SOCKET_SERVER_LOG_ID}: initial_headers:`, headers)
    // })
    // this.io.engine.on('headers', (headers, _req) => {
    //   logger.info(`${SOCKET_SERVER_LOG_ID}: headers:`, headers)
    // })
    this.io.engine.on('connection_error', (err) => {
      logger.info(`${SOCKET_SERVER_LOG_ID}: connection_error: details`, {
        'err.code': err.code,
        'err.message': err.message,
        'err.context': err.context,
      })
      logger.debug(`${SOCKET_SERVER_LOG_ID}: connection_error`, err)
    })
  }

  private constructor(port: number, options?: Partial<ServerOptions>) {
    this.io = new IOServer(port, options)
  }

  public async cleanUpForDeletion() {
    try {
      await closeGivenServer(this.io)
    } catch (e) {
      logger.error(e)
    }
  }

  // Factory to create captain socket server
  public static async createCaptainSocketServer(port: number, options?: Partial<ServerOptions>) {
    const captainSocketServer = new CaptainSocketServerManager(port, options)
    captainSocketServer.setupConnectionAndListeners()
    return captainSocketServer
  }

  /**
   * Broadcast request to 'reset' health check to re-confirm given 'verifyState'
   *
   * @export
   * @param {WebServiceManager} webService
   * @param {string} verifyState
   * @param {string} ipAddress
   */
  public broadcastRequestForHealthCheck(webService: WebServiceManager, verifyState: string, ipAddress: string) {
    // logger.info('broadcastRequestForHealthCheck', ipAddress)
    this.io.emit(EVENT_NAMES.HEALTH_CHECK_REQUEST, {
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
  public broadcastChangePollingFreq(webService: WebServiceManager, pollingType: string) {
    this.io.emit(EVENT_NAMES.REQUEST_CHANGE_POLLING_FREQ, {
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
  public broadcastHealthCheckUpdate(webService: WebServiceManager, ipAddress: string) {
    this.io.emit(EVENT_NAMES.HEALTH_CHECK_UPDATE, {
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
  public broadcastNewLeader(leaderURL: string) {
    this.io.emit(EVENT_NAMES.NEW_LEADER, {
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
  public broadcastActiveAddresses(webService: WebServiceManager) {
    this.io.emit(EVENT_NAMES.ACTIVE_ADDRESSES, {
      serviceKey: webService.serviceKey,
      service: webService.serviceConf.name,
      addresses: webService.serviceState.active,
    })
  }

  /**
   * Send 'active_addresses' of all web service to all connected 'captain' peers
   * Called only by 'leader'
   *
   */
  public broadcastBulkActiveAddresses() {
    this.io.emit(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, constructBulkActiveAddressesMessage())
  }
}
