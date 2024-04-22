/**
 * Socket server that handles communication from other captains
 */

import {type ServerOptions, type Socket as ServerSocket, Server as IOServer} from 'socket.io'
import jwt from 'jsonwebtoken'
import { EVENT_NAMES, SOCKET_SERVER_LOG_ID, closeGivenServer, receiveMateDisconnected, receiveNewRemoteServices, registerServerDebugListeners, retrieveClientOrigin} from './captainSocketHelper.js'
import {WebServiceManager} from '../web-service/webServiceManager.js'
import appConfig from '../appConfig.js'
import appState from '../appState.js'
import {logger} from '../coreUtils.js'
import { HEALTH_CHECK_REQUEST_VERIFY_STATE, typeWebServiceConf } from './../web-service/webServiceHelper.js'

function retrieveToken(socket: ServerSocket) {
  return `${socket.handshake.query?.token}`
}

/**
 * Transfer complete set of data, tracked by current 'captain' instance to the connecting 'peer'. Help nodes that could potentially join later
 *
 * @param {ServerSocket} socket
 */
async function transferCurrentState(socket: ServerSocket) {
  const clientOrigin = retrieveClientOrigin(socket)
  logger.debug(`transferCurrentState:To:${clientOrigin}:begin`)
  // If leader, also transfer 'newLeader'
  if (appState.isLeader()) {
    logger.debug(`transferCurrentState:To:${clientOrigin}:sendNewLeaderToSocket`)
    sendNewLeaderToSocket(socket, appState.getLeaderUrl()!)
  }
  logger.debug(`transferCurrentState:To:${clientOrigin}:sendAllRemoteServicesStateToSocket`)
  // Dynamic services needs to be transferred before health check and active addresses
  await sendAllRemoteServicesStateToSocket(socket)
  logger.debug(`transferCurrentState:To:${clientOrigin}:sendMyBulkHealthCheckUpdateToSocket`)
  sendMyBulkHealthCheckUpdateToSocket(socket)
  // If leader, also transfer 'activeAddresses'
  if (appState.isLeader()) {
    logger.debug(`transferCurrentState:To:${clientOrigin}:sendBulkActiveAddressesToSocket`)    
    sendBulkActiveAddressesToSocket(socket)
  }
  logger.debug(`transferCurrentState:To:${clientOrigin}:end`)
}

function constructBulkActiveAddressesMessage() {
  const completeActiveAddresses = Object.keys(appState.getWebServices()).map((eachServiceKey) => {
    const webService = appState.getWebService(eachServiceKey)!
    return {
      service: webService.serviceKey,
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

let reSentRemoteServicesIDGenerator = 1
/**
 * Send complete remote services data reported by mates previously to the newly discovered 'captain peer'
 *
 * @param {ServerSocket} socket
 */
async function sendAllRemoteServicesStateToSocket(socket: ServerSocket) {
  // Filter out only remote services
  const remoteServices = Object.values(appState.getWebServices()).filter((eachWebService) => {
    return eachWebService.serviceConf.is_remote
  })

  // A). Construct and send multiple 'new-remote-services' messages from existing state and send it to the newly connected captain
  // Construct a map of mate id vs list of services reported by it by looking through services data
  const mateVsServices:{
    [mateID: string]: typeWebServiceConf []
  } = {}
  for(const eachWebService of remoteServices) {
    const mates = Object.keys(eachWebService.serviceState.mates || {})
    for (const eachMateID of mates) {
      const serviceConf = { ...eachWebService.serviceConf }
      serviceConf.addresses = eachWebService.serviceState.mates?.[eachMateID]?.addressses || []
      mateVsServices[eachMateID] = mateVsServices[eachMateID] || []
      mateVsServices[eachMateID]!.push(serviceConf)
    }
  }
  const newRemoteServicePromises = []
  // Send one message per mate
  for(const eachMateID of Object.keys(mateVsServices)) {
    const eachMessage = {
      message_id: appState.generateMessageID(EVENT_NAMES.NEW_REMOTE_SERVICES),
      mate_id: eachMateID,
      services: mateVsServices[eachMateID]
    }
    newRemoteServicePromises.push(socket.emitWithAck(EVENT_NAMES.NEW_REMOTE_SERVICES, eachMessage).catch((e) => {
      logger.error(`sendMyBulkRemoteServicesToSocket:NEW_REMOTE_SERVICES: ${eachMateID}`, e)
    }))
    logger.debug('sendMyBulkRemoteServicesToSocket:NEW_REMOTE_SERVICES', JSON.stringify(eachMessage, undefined, 2))
  }
  const newRemoteServiceAckResponses = await Promise.all(newRemoteServicePromises)
  logger.debug('sendMyBulkRemoteServicesToSocket:newRemoteServiceAckResponses', newRemoteServiceAckResponses)

  // B). Construct and send multiple 'mate-disconnected' messages from existing state and send it to the newly connected captain
  const mateVsOrphanServices:{
    [mateID: string]: WebServiceManager []
  } = {}
  for(const eachWebService of remoteServices) {
    const mates = Object.keys(eachWebService.serviceState.mates || {})
    for (const eachMateID of mates) {
      const is_orphan = eachWebService.serviceState.mates?.[eachMateID]?.is_orphan
      if (is_orphan) {
        mateVsOrphanServices[eachMateID] = mateVsOrphanServices[eachMateID] || []
        mateVsOrphanServices[eachMateID]!.push(eachWebService)
      }
    }
  }
  const disconnectServicePromises = []
  // Send one 'disconnect' message for each orphaned mate
  for(const eachMateID of Object.keys(mateVsOrphanServices)) {
    const eachMessage = {
      message_id: appState.generateMessageID(EVENT_NAMES.MATE_DISCONNECTED),
      mate_id: eachMateID,
    }
    disconnectServicePromises.push(socket.emitWithAck(EVENT_NAMES.MATE_DISCONNECTED, eachMessage).catch((e) => {
      logger.error(`sendMyBulkRemoteServicesToSocket:MATE_DISCONNECTED: ${eachMateID}`, e)
    }))
    logger.debug('sendMyBulkRemoteServicesToSocket:MATE_DISCONNECTED', JSON.stringify(eachMessage, undefined, 2))
  }
  const disconnectServiceAckResponses = await Promise.all(disconnectServicePromises)
  logger.debug('sendMyBulkRemoteServicesToSocket:disconnectServiceAckResponses', disconnectServiceAckResponses)
}

/**
 * Send complete checks 'state' tracked by 'current' captain instance to newly discovered captain 'peer'
 *
 * @export
 * @param {ServerSocket} socket
 */
function sendMyBulkHealthCheckUpdateToSocket(socket: ServerSocket) {
  const bulkHealthCheckUpdates = []
  for (const eachServiceKey of Object.keys(appState.getWebServices())) {
    const webService = appState.getWebService(eachServiceKey)!
    const checksByEachCaptainMembers = webService.serviceState.checks[appConfig.SELF_URL]
    if (checksByEachCaptainMembers) {
      for (const eachIpAddress of Object.keys(checksByEachCaptainMembers)) {
        bulkHealthCheckUpdates.push({
          member: appConfig.SELF_URL,
          service: webService.serviceKey,
          address: eachIpAddress,
          failing: checksByEachCaptainMembers[eachIpAddress]!.failing,
          passing: checksByEachCaptainMembers[eachIpAddress]!.passing,
          last_update: checksByEachCaptainMembers[eachIpAddress]!.last_update,
        })
      }
    }
  }
  // logger.info('bulkHealthCheckUpdates', bulkHealthCheckUpdates)
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
  for (const eachServiceKey of Object.keys(appState.getWebServices())) {
    const webService = appState.getWebService(eachServiceKey)!
    for (const eachCaptainMemberUrl of Object.keys(webService.serviceState.checks)) {
      const checksByEachCaptainMembers = webService.serviceState.checks[eachCaptainMemberUrl]
      if (checksByEachCaptainMembers) {
        for (const eachIpAddress of Object.keys(checksByEachCaptainMembers)) {
          bulkHealthCheckUpdates.push({
            member: eachCaptainMemberUrl,
            service: webService.serviceKey,
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
  io: IOServer
  remoteCaptainUrlVsServerSocket: {
    [key: string]: ServerSocket
  } = {}


  /**
   * Listeners for direct communication from a client ( instead of broadcast which is always from 'server' to 'client' )
   * Direct/specific communication using a 'remote-captain-url' is done from 'client' to 'server',
   * and this method has the listeners on the server side
   *
   * @param {ServerSocket} socket
   */
  private async registerListeners(socket: ServerSocket) {
    const clientOrigin = retrieveClientOrigin(socket)
    const logID = `${SOCKET_SERVER_LOG_ID}(Remote Client(event-sender): ${clientOrigin})`
    socket.on(EVENT_NAMES.NEW_REMOTE_SERVICES, (payLoad, ackCallback) => {
      logger.info(logID, EVENT_NAMES.NEW_REMOTE_SERVICES, {
        payLoad
      })
      receiveNewRemoteServices(logID, payLoad, ackCallback)
    })
    socket.on(EVENT_NAMES.MATE_DISCONNECTED, (payLoad, ackCallback) => {
      logger.info(logID, EVENT_NAMES.MATE_DISCONNECTED, {
        payLoad
      })
      receiveMateDisconnected(logID, payLoad, ackCallback)
    })
  }

  /**
   * Setup connection from clients ('peers')
   *
   * @export
   */
  private setupConnectionAndListeners() {
    // this.io.engine.use((req: any, res: any, next: any) => {
    //   logger.info('req._query', req._query)
    //   logger.info('req.url', req.url)
    //   next()
    // })
  
    // jwt based authentication for socket connections between captain members
    this.io.use((socket, next) => {
      try {
        logger.info(`IO.USE ${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address})`)
        // const logID = `${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address})`
        const token = retrieveToken(socket)
        const clientOrigin = retrieveClientOrigin(socket)
        if (clientOrigin) {
          if (!appConfig.MEMBER_URLS.includes(clientOrigin)) {
            return next(new Error(`Unknown clientOrigin: ${clientOrigin}`))
          }
        } else {
          return next(new Error(`'clientOrigin' not set`))
        }
        this.remoteCaptainUrlVsServerSocket[clientOrigin]=socket
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
      } catch(e) {
        logger.error(`${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address}`, e)
        throw e
      }
    })
    this.io.on('connection', async (socket) => {
      registerServerDebugListeners(appConfig.SELF_URL, this.io, socket)
      this.registerListeners(socket)
      await transferCurrentState(socket)
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
    } catch (e: any) {
      if (e?.message !== 'Server is not running.') { // already cleaned up
        logger.error('CaptainSocketServerManager:cleanUpForDeletion', e?.message || e)
      }
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
  public broadcastRequestForHealthCheck(webService: WebServiceManager, ipAddress: string, verifyState?: HEALTH_CHECK_REQUEST_VERIFY_STATE) {
    logger.info('broadcastRequestForHealthCheck', ipAddress)
    this.io.emit(EVENT_NAMES.HEALTH_CHECK_REQUEST, {
      member: appConfig.SELF_URL,
      service: webService.serviceKey,
      address: ipAddress,
      verifyState,
    })
  }

  /**
   * Only the leader maintains the web service 'status' ('healthy' OR 'unhealthy').
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
      service: webService.serviceKey,
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
      service: webService.serviceKey,
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
    const addresses = webService.serviceState.active
    logger.debug(`${webService.logID}: broadcastActiveAddresses: Details: ${addresses}`)          
    this.io.emit(EVENT_NAMES.ACTIVE_ADDRESSES, {
      service: webService.serviceKey,
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

  /**
   * Re-broadcast 'new-remote-services' message from a 'mate' to to all connected 'captain' peers
   * Called only by 'leader'
   *
   */
  public broadcastNewRemoteServices(payLoad: any) {
    this.io.emit(EVENT_NAMES.NEW_REMOTE_SERVICES, payLoad)
  }

  /**
   * Re-broadcast 'mate-disconnected' message from a 'mate' to to all connected 'captain' peers
   * Called only by 'leader'
   *
   */
  public broadcastMateDisconnected(payLoad: any) {
    this.io.emit(EVENT_NAMES.MATE_DISCONNECTED, payLoad)
  }

}
